import type { ProjectSettingsView } from '@ai-dev-orchestrator/schemas';

export interface UpdateSettingsResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** Port for reading and writing project-level settings (.ai/*.yaml). */
export interface SettingsProvider {
  getProjectSettings(): ProjectSettingsView | null;
  updateProjectSettings(patch: Partial<ProjectSettingsView>): UpdateSettingsResult;
}
