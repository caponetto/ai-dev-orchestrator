import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FileSystemConfigurationLoader, parseYamlFile } from '@ai-orchestrator/core';
import type { SettingsProvider } from '@ai-orchestrator/ports';
import type {
  MergedConfiguration,
  ProjectSettingsView,
  RunnerDefinition,
  SettingsPermissionPolicy,
  SettingsRoleAssignment,
} from '@ai-orchestrator/schemas';
import { camelToSnake, camelToSnakeDeep, snakeToCamelDeep } from '@ai-orchestrator/utils';
import { stringify } from 'yaml';

import {
  type ConfigYamlShape,
  configYamlShapeSchema,
  type GovernanceYamlShape,
  governanceYamlShapeSchema,
  type RolesYamlShape,
  rolesYamlShapeSchema,
} from './yaml-shapes';

export class FilesystemSettingsProvider implements SettingsProvider {
  constructor(
    private readonly aiConfigDir: string,
    private readonly defaults: MergedConfiguration,
    private readonly runnerRegistry: readonly RunnerDefinition[] = [],
  ) {}

  getProjectSettings(): ProjectSettingsView | null {
    if (!existsSync(this.aiConfigDir)) {
      return this.projectFromConfig(this.defaults);
    }

    const rolesRaw = this.readYaml('roles.yaml');
    const qualityRaw = this.readYaml('governance.yaml');
    const configRaw = this.readYaml('config.yaml');

    const rolesResult = rolesYamlShapeSchema.safeParse(snakeToCamelDeep(rolesRaw));
    const rolesCamel: RolesYamlShape = rolesResult.success ? rolesResult.data : {};

    const govResult = governanceYamlShapeSchema.safeParse(snakeToCamelDeep(qualityRaw));
    const govCamel: GovernanceYamlShape = govResult.success ? govResult.data : {};

    const configResult = configYamlShapeSchema.safeParse(snakeToCamelDeep(configRaw));
    const configCamel: ConfigYamlShape = configResult.success ? configResult.data : {};

    // Deep-merge role assignments: start with all defaults, overlay YAML per-role.
    // The on-disk format is `roles: [{id, model, ...}]` — extract keyed assignments from array.
    const assignments: Record<string, Record<string, unknown>> = {};
    for (const [role, a] of Object.entries(this.defaults.roles.assignments)) {
      assignments[role] = { ...a };
    }
    if (rolesCamel.roles) {
      for (const entry of rolesCamel.roles) {
        const converted: Record<string, unknown> = { ...entry };
        delete converted['id'];
        assignments[entry.id] = { ...(assignments[entry.id] ?? {}), ...converted };
      }
    }

    return {
      roles: {
        assignments: this.projectAssignments(assignments),
      },
      governance: {
        iterationLimits: {
          defaults: this.projectIterationDefaults(govCamel),
        },
        qualityGates: this.projectQualityGates(govCamel),
        budget: this.projectBudget(govCamel),
        permissionPolicy: this.projectPermissionPolicy(govCamel),
      },
      runtime: {
        logLevel: configCamel.logLevel ?? this.defaults.runtime.logLevel,
      },
      availableRunners: this.collectRunners(),
      modelsByRunner: this.collectModelsByRunner(),
    };
  }

  updateProjectSettings(patch: Partial<ProjectSettingsView>): { ok: boolean; error?: string } {
    const backups = this.backupYamlFiles();
    try {
      if (patch.roles) {
        this.updateRolesYaml(patch.roles);
      }
      if (patch.governance || patch.runtime) {
        this.updateQualityYaml(patch.governance);
        if (patch.runtime) {
          this.updateConfigYaml(patch.runtime);
        }
      }

      const report = new FileSystemConfigurationLoader().validate({
        aiConfigDir: this.aiConfigDir,
        runnerRegistry: this.runnerRegistry,
      });
      if (!report.valid) {
        this.restoreYamlFiles(backups);
        const message = report.errors[0]?.message ?? 'Configuration validation failed';
        return { ok: false, error: message };
      }

      return { ok: true };
    } catch (e: unknown) {
      this.restoreYamlFiles(backups);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private backupYamlFiles(): Map<string, string | null> {
    const files = ['roles.yaml', 'governance.yaml', 'config.yaml'];
    const backups = new Map<string, string | null>();
    for (const file of files) {
      const path = join(this.aiConfigDir, file);
      try {
        backups.set(file, readFileSync(path, 'utf-8'));
      } catch {
        backups.set(file, null);
      }
    }
    return backups;
  }

  private restoreYamlFiles(backups: Map<string, string | null>): void {
    for (const [file, content] of backups) {
      if (content !== null) {
        writeFileSync(join(this.aiConfigDir, file), content, 'utf-8');
      }
    }
  }

  private updateRolesYaml(roles: ProjectSettingsView['roles']): void {
    const existing = this.readYaml('roles.yaml');
    const rolesArray = existing['roles'];
    if (!Array.isArray(rolesArray)) {
      return;
    }
    for (const role of rolesArray as Record<string, unknown>[]) {
      const id = role['id'] as string | undefined;
      if (!id || !(id in roles.assignments)) {
        continue;
      }
      const assignment = roles.assignments[id];
      role['model'] = assignment.model;
      if (assignment.runner) {
        role['runner'] = assignment.runner;
      }
    }
    this.writeYaml('roles.yaml', existing);
  }

  private updateQualityYaml(governance?: ProjectSettingsView['governance']): void {
    if (!governance) {
      return;
    }
    const existing = this.readYaml('governance.yaml');

    const limits = (existing['iteration_limits'] ?? {}) as Record<string, unknown>;
    const snakeLimits = camelToSnakeDeep(governance.iterationLimits.defaults) as Record<
      string,
      unknown
    >;
    existing['iteration_limits'] = { ...limits, ...snakeLimits };

    const gates = (existing['quality_gates'] ?? {}) as Record<string, Record<string, unknown>>;
    for (const [gateName, gateValues] of Object.entries(governance.qualityGates)) {
      const snakeGateName = camelToSnake(gateName);
      const existingGate = gates[snakeGateName] ?? {};
      const snakeGateValues = camelToSnakeDeep(gateValues) as Record<string, unknown>;
      gates[snakeGateName] = { ...existingGate, ...snakeGateValues };
    }
    existing['quality_gates'] = gates;

    if (governance.budget) {
      const budget = (existing['budget'] ?? {}) as Record<string, unknown>;
      if ('maxTokensPerRun' in governance.budget) {
        budget['max_tokens_per_run'] = governance.budget.maxTokensPerRun ?? null;
      }
      existing['budget'] = budget;
    }

    if (governance.permissionPolicy) {
      const snakePolicy = camelToSnakeDeep(governance.permissionPolicy) as Record<string, unknown>;
      const existingPolicy = (existing['permission_policy'] ?? {}) as Record<string, unknown>;
      existing['permission_policy'] = { ...existingPolicy, ...snakePolicy };
    }

    this.writeYaml('governance.yaml', existing);
  }

  private updateConfigYaml(runtime: ProjectSettingsView['runtime']): void {
    const existing = this.readYaml('config.yaml');
    const snakeRuntime = camelToSnakeDeep(runtime) as Record<string, unknown>;
    const merged = { ...existing, ...snakeRuntime };
    this.writeYaml('config.yaml', merged);
  }

  private readYaml(filename: string): Record<string, unknown> {
    const result = parseYamlFile(join(this.aiConfigDir, filename));
    return result.ok ? result.value : {};
  }

  private writeYaml(filename: string, data: Record<string, unknown>): void {
    const content = stringify(data, { indent: 2, lineWidth: 120 });
    writeFileSync(join(this.aiConfigDir, filename), content, 'utf-8');
  }

  private projectFromConfig(config: MergedConfiguration): ProjectSettingsView {
    const assignments: Record<string, SettingsRoleAssignment> = {};
    for (const [role, a] of Object.entries(config.roles.assignments)) {
      assignments[role] = {
        model: a.model,
        dispatchType: a.dispatchType,
        runner: a.runner,
      };
    }
    return {
      roles: { assignments },
      governance: {
        iterationLimits: { defaults: { ...config.governance.iterationLimits.defaults } },
        qualityGates: {
          specificationReadiness: {
            ...config.governance.qualityGates.specificationReadiness,
          },
          implementationReview: {
            ...config.governance.qualityGates.implementationReview,
          },
        },
        budget: config.governance.budget
          ? {
              maxTokensPerRun: config.governance.budget.maxTokensPerRun,
            }
          : undefined,
        permissionPolicy: this.projectPermissionPolicy({}),
      },
      runtime: { logLevel: config.runtime.logLevel },
      availableRunners: this.collectRunners(),
      modelsByRunner: this.collectModelsByRunner(),
    };
  }

  private collectRunners(): string[] {
    return this.runnerRegistry.map((r) => r.id);
  }

  private collectModelsByRunner(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const runner of this.runnerRegistry) {
      result[runner.id] = [...runner.models];
    }
    return result;
  }

  private projectAssignments(
    raw: Record<string, Record<string, unknown>>,
  ): Record<string, SettingsRoleAssignment> {
    const result: Record<string, SettingsRoleAssignment> = {};
    for (const [role, a] of Object.entries(raw)) {
      result[role] = {
        model: typeof a['model'] === 'string' ? a['model'] : '',
        dispatchType: typeof a['dispatchType'] === 'string' ? a['dispatchType'] : undefined,
        runner: typeof a['runner'] === 'string' ? a['runner'] : undefined,
      };
    }
    return result;
  }

  private projectIterationDefaults(gov: GovernanceYamlShape): Record<string, number> {
    const limits = gov.iterationLimits;
    const defaults = limits?.defaults ?? limits;
    const result: Record<string, number> = { ...this.defaults.governance.iterationLimits.defaults };
    if (!defaults) {
      return result;
    }
    for (const [k, v] of Object.entries(defaults)) {
      if (typeof v === 'number') {
        result[k] = v;
      }
    }
    return result;
  }

  private projectQualityGates(
    gov: GovernanceYamlShape,
  ): ProjectSettingsView['governance']['qualityGates'] {
    const gates = gov.qualityGates;
    const defs = this.defaults.governance.qualityGates;
    return {
      specificationReadiness: {
        minCompletenessScore:
          gates?.specificationReadiness?.minCompletenessScore ??
          defs.specificationReadiness.minCompletenessScore,
      },
      implementationReview: {
        maxHighSeverityFindings:
          gates?.implementationReview?.maxHighSeverityFindings ??
          defs.implementationReview.maxHighSeverityFindings,
        maxMediumSeverityFindings:
          gates?.implementationReview?.maxMediumSeverityFindings ??
          defs.implementationReview.maxMediumSeverityFindings,
      },
    };
  }

  private projectBudget(gov: GovernanceYamlShape): ProjectSettingsView['governance']['budget'] {
    const budget = gov.budget;
    if (!budget) {
      return undefined;
    }
    return {
      maxTokensPerRun:
        typeof budget.maxTokensPerRun === 'number' ? budget.maxTokensPerRun : undefined,
    };
  }

  private projectPermissionPolicy(gov: GovernanceYamlShape): SettingsPermissionPolicy | undefined {
    const policy = gov.permissionPolicy;
    if (!policy || typeof policy !== 'object') {
      return undefined;
    }
    const defaultAction =
      typeof policy['defaultAction'] === 'string' ? policy['defaultAction'] : undefined;
    if (!defaultAction) {
      return undefined;
    }
    return {
      defaultAction: defaultAction as SettingsPermissionPolicy['defaultAction'],
      rules: Array.isArray(policy['rules'])
        ? (policy['rules'] as SettingsPermissionPolicy['rules'])
        : undefined,
      roleTrust:
        policy['roleTrust'] && typeof policy['roleTrust'] === 'object'
          ? (policy['roleTrust'] as SettingsPermissionPolicy['roleTrust'])
          : undefined,
      safeCommands: Array.isArray(policy['safeCommands'])
        ? (policy['safeCommands'] as SettingsPermissionPolicy['safeCommands'])
        : undefined,
    };
  }
}
