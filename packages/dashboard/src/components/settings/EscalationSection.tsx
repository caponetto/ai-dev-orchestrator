import type {
  ProjectSettingsView,
  SettingsGovernance,
  SettingsPermissionPolicy,
} from '@ai-dev-orchestrator/schemas';
import { logLevelSchema, permissionDecisionActionSchema } from '@ai-dev-orchestrator/schemas';

import { NumberInput, SectionCard, Select } from './FormControls';

const LOG_LEVELS = logLevelSchema.options;
const LOG_LEVEL_LABELS: Record<string, string> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warning',
  error: 'Error',
};

const DEFAULT_ACTIONS = permissionDecisionActionSchema.options;
const ACTION_LABELS: Record<string, string> = {
  grant: 'Grant',
  deny: 'Deny',
  ask_human: 'Ask Human',
};

interface Props {
  logLevel: string;
  budget?: SettingsGovernance['budget'];
  permissionPolicy?: SettingsPermissionPolicy;
  onChange: (patch: Partial<ProjectSettingsView>) => void;
}

export function EscalationSection({
  logLevel,
  budget,
  permissionPolicy,
  onChange,
}: Readonly<Props>) {
  return (
    <SectionCard title="Runtime">
      <div className="space-y-1 rounded border border-border bg-background px-3">
        <Select
          label="Log Level"
          tooltip="Minimum log severity recorded during workflow execution"
          value={logLevel}
          options={LOG_LEVELS}
          labelMap={LOG_LEVEL_LABELS}
          onChange={(v) => {
            onChange({ runtime: { logLevel: v } });
          }}
        />
        <NumberInput
          label="Max Tokens / Run"
          tooltip="Maximum total tokens (input + output) allowed per orchestrator run. Leave empty for unlimited."
          value={budget?.maxTokensPerRun}
          onChange={(v) => {
            onChange({
              governance: { budget: { maxTokensPerRun: v } },
            } as Partial<ProjectSettingsView>);
          }}
          min={0}
          step={1000}
          placeholder="unlimited"
        />
        <Select
          label="Default Permission"
          tooltip="Action taken when no specific permission rule matches a request"
          value={permissionPolicy?.defaultAction ?? 'ask_human'}
          options={DEFAULT_ACTIONS}
          labelMap={ACTION_LABELS}
          onChange={(v) => {
            onChange({
              governance: {
                permissionPolicy: {
                  ...(permissionPolicy ?? { defaultAction: 'ask_human' as const }),
                  defaultAction: v as SettingsPermissionPolicy['defaultAction'],
                },
              },
            } as Partial<ProjectSettingsView>);
          }}
        />
      </div>
    </SectionCard>
  );
}
