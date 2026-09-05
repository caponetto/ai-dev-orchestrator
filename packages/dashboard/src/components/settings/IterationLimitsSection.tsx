import type { ProjectSettingsView } from '@ai-dev-orchestrator/schemas';

import { humanize } from '../../lib/humanize';

import { NumberInput, SectionCard } from './FormControls';

const TOOLTIPS: Record<string, string> = {
  maxReviewIterations: 'How many times reviewers can request changes before escalation',
  maxJudgeArbitrations: 'How many times the judge can arbitrate non-converging review loops',
  maxClarificationRounds: 'How many clarification rounds the analyst can request from the user',
  maxAcceptanceIterations: 'How many acceptance validation cycles before escalating to human',
};

interface Props {
  defaults: Record<string, number>;
  onChange: (patch: Partial<ProjectSettingsView>) => void;
}

export function IterationLimitsSection({ defaults, onChange }: Props) {
  const update = (key: string, value: number | undefined) => {
    if (value === undefined) {
      return;
    }
    onChange({
      governance: {
        iterationLimits: { defaults: { ...defaults, [key]: value } },
      } as ProjectSettingsView['governance'],
    });
  };

  return (
    <SectionCard title="Iteration Limits">
      <div className="divide-y divide-border rounded border border-border bg-background px-3">
        {Object.entries(defaults).map(([key, value]) => (
          <NumberInput
            key={key}
            label={humanize(key)}
            tooltip={TOOLTIPS[key]}
            value={value}
            onChange={(v) => {
              update(key, v);
            }}
            min={1}
            max={20}
          />
        ))}
      </div>
    </SectionCard>
  );
}
