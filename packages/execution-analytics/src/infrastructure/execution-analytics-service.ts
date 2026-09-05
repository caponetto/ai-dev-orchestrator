import type { ProjectContextStore } from '@ai-dev-orchestrator/ports';
import type {
  AdaptiveConfig,
  ExecutionProfile,
  ExecutionProfileStore,
  StaticConfigBaseline,
  WorkerOutcomeRecord,
} from '@ai-dev-orchestrator/schemas';
import { executionProfileStoreSchema } from '@ai-dev-orchestrator/schemas';

import { NO_RECOMMENDATION } from '../domain';

import { AdaptiveConfigResolver } from './adaptive-config-resolver';
import { ProfileComputer } from './profile-computer';

function profileKey(roleId: string, model: string): string {
  return `${roleId}:${model}`;
}

export class ExecutionAnalyticsService {
  private readonly store: ProjectContextStore;
  private readonly computer = new ProfileComputer();
  private readonly resolver = new AdaptiveConfigResolver();

  constructor(store: ProjectContextStore) {
    this.store = store;
  }

  async recordOutcomes(outcomes: readonly WorkerOutcomeRecord[]): Promise<void> {
    if (outcomes.length === 0) {
      return;
    }

    const profileStore = await this.loadProfileStore();
    const grouped = this.groupByRoleModel(outcomes);

    for (const [key, group] of grouped) {
      const existing =
        profileStore.profiles.find((p) => profileKey(p.roleId, p.model) === key) ?? null;
      const updated = this.computer.update(existing, group);

      const idx = profileStore.profiles.findIndex((p) => profileKey(p.roleId, p.model) === key);
      if (idx >= 0) {
        profileStore.profiles[idx] = updated;
      } else {
        profileStore.profiles.push(updated);
      }
    }

    profileStore.lastUpdated = new Date().toISOString();
    await this.saveProfileStore(profileStore);
  }

  async getAdaptiveConfig(
    roleId: string,
    model: string,
    staticConfig: StaticConfigBaseline,
  ): Promise<AdaptiveConfig> {
    const profile = await this.getProfile(roleId, model);
    if (!profile) {
      return NO_RECOMMENDATION;
    }
    return this.resolver.resolve(profile, staticConfig);
  }

  async getProfile(roleId: string, model: string): Promise<ExecutionProfile | null> {
    const store = await this.loadProfileStore();
    return store.profiles.find((p) => p.roleId === roleId && p.model === model) ?? null;
  }

  private groupByRoleModel(
    outcomes: readonly WorkerOutcomeRecord[],
  ): Map<string, WorkerOutcomeRecord[]> {
    const groups = new Map<string, WorkerOutcomeRecord[]>();
    for (const outcome of outcomes) {
      const key = profileKey(outcome.roleId, outcome.model);
      const group = groups.get(key);
      if (group) {
        group.push(outcome);
      } else {
        groups.set(key, [outcome]);
      }
    }
    return groups;
  }

  private async loadProfileStore(): Promise<ExecutionProfileStore> {
    const doc = await this.store.read('analytics');
    if (!doc) {
      return { profiles: [], lastUpdated: new Date().toISOString() };
    }
    const parsed = executionProfileStoreSchema.safeParse(doc.content);
    if (!parsed.success) {
      return { profiles: [], lastUpdated: new Date().toISOString() };
    }
    return { profiles: [...parsed.data.profiles], lastUpdated: parsed.data.lastUpdated };
  }

  private async saveProfileStore(store: ExecutionProfileStore): Promise<void> {
    await this.store.write('analytics', {
      category: 'analytics',
      content: store,
      lastUpdated: store.lastUpdated,
    });
  }
}
