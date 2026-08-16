import type { PolicyResolver as PolicyResolverPort } from '@ai-orchestrator/ports';
import type {
  MergeLogEntry,
  PolicyDefinition,
  PolicyLayer,
  PolicyScope,
  PolicySource,
  ResolvedPolicySet,
} from '@ai-orchestrator/schemas';
interface PolicyHierarchy {
  readonly organization?: readonly PolicyDefinition[];
  readonly project?: readonly PolicyDefinition[];
  readonly workflowVariant?: readonly PolicyDefinition[];
  readonly overrides?: readonly PolicyDefinition[];
}

/** Resolves applicable policies by merging all hierarchy layers. */
export class PolicyResolver implements PolicyResolverPort {
  private readonly hierarchy: PolicyHierarchy;
  private mergeLog: MergeLogEntry[] = [];
  private lastSources = new Map<string, PolicySource>();

  constructor(projectOrHierarchy?: readonly PolicyDefinition[] | PolicyHierarchy) {
    if (!projectOrHierarchy) {
      this.hierarchy = {};
    } else if (Array.isArray(projectOrHierarchy)) {
      this.hierarchy = { project: projectOrHierarchy as readonly PolicyDefinition[] };
    } else {
      this.hierarchy = projectOrHierarchy as PolicyHierarchy;
    }
  }

  /**
   * Resolve applicable policies by merging built-in defaults with all hierarchy layers.
   * @param _scope - Scope filter (reserved for future per-role/per-state filtering)
   * @returns Merged policy set with sources and merge audit log
   */
  resolve(_scope: PolicyScope): ResolvedPolicySet {
    this.mergeLog = [];
    const sources = new Map<string, PolicySource>();
    const merged = new Map<string, PolicyDefinition>();

    const layers: { name: PolicyLayer; policies: readonly PolicyDefinition[] }[] = [
      { name: 'organization', policies: this.hierarchy.organization ?? [] },
      { name: 'project', policies: this.hierarchy.project ?? [] },
      { name: 'workflow_variant', policies: this.hierarchy.workflowVariant ?? [] },
      { name: 'role', policies: this.hierarchy.overrides ?? [] },
    ];

    for (const layer of layers) {
      for (const layerPolicy of layer.policies) {
        const existing = merged.get(layerPolicy.type);
        if (existing) {
          const existingConfig = existing.config as Record<string, unknown>;
          const layerConfig = layerPolicy.config as Record<string, unknown>;

          if (existing.locked) {
            const previousSource = sources.get(existing.id);
            const fromLayer = previousSource?.layer ?? 'builtin';
            for (const key of Object.keys(layerConfig)) {
              this.mergeLog.push({
                policyId: existing.id,
                field: key,
                fromLayer,
                toLayer: layer.name,
                action: 'blocked_by_lock',
                fromValue: existingConfig[key],
                toValue: layerConfig[key],
              });
            }
            continue;
          }

          const previousSource = sources.get(existing.id);
          const fromLayer = previousSource?.layer ?? 'builtin';
          const mergedConfig = { ...existingConfig, ...layerConfig };
          const mergedPolicy = {
            ...existing,
            config: mergedConfig,
            enabled: layerPolicy.enabled,
          } as PolicyDefinition;
          merged.set(layerPolicy.type, mergedPolicy);

          for (const key of Object.keys(layerConfig)) {
            this.mergeLog.push({
              policyId: existing.id,
              field: key,
              fromLayer,
              toLayer: layer.name,
              action: 'override',
              fromValue: existingConfig[key],
              toValue: layerConfig[key],
            });
          }

          sources.set(existing.id, { layer: layer.name });
        } else {
          merged.set(layerPolicy.type, layerPolicy);
          sources.set(layerPolicy.id, { layer: layer.name });
        }
      }
    }

    const policies = [...merged.values()].filter((p) => p.enabled);
    this.lastSources = sources;

    return {
      policies,
      sources,
      mergeLog: [...this.mergeLog],
    };
  }

  /**
   * Trace which hierarchy layer provided a specific policy.
   * @param policyId - The policy identifier to trace
   * @param _field - Config field name (reserved for field-level tracing)
   * @returns The source layer, or null if the policy was not resolved
   */
  traceSource(policyId: string, _field: string): PolicySource | null {
    return this.lastSources.get(policyId) ?? null;
  }
}
