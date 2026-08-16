import type { ProjectSettingsView } from '@ai-orchestrator/schemas';

import { humanize } from '../../lib/humanize';

import { NumberInput, SectionCard, Toggle } from './FormControls';

const TOOLTIPS: Partial<Record<string, Partial<Record<string, string>>>> = {
  specificationReadiness: {
    minCompletenessScore: 'Minimum spec completeness score (0–1) before advancing to planning',
  },
  implementationReview: {
    maxHighSeverityFindings: 'Maximum high-severity issues allowed to pass review',
    maxMediumSeverityFindings: 'Maximum medium-severity issues allowed to pass review',
  },
};

const NUMBER_PROPS: Partial<
  Record<string, Partial<Record<string, { step?: number; max?: number }>>>
> = {
  specificationReadiness: {
    minCompletenessScore: { step: 0.1, max: 1 },
  },
};

interface Props {
  gates: Record<string, Record<string, unknown>>;
  onChange: (patch: Partial<ProjectSettingsView>) => void;
}

export function QualityGatesSection({ gates, onChange }: Props) {
  const updateGate = (gate: string, field: string, value: unknown) => {
    onChange({
      governance: {
        qualityGates: {
          ...gates,
          [gate]: { ...gates[gate], [field]: value },
        },
      } as ProjectSettingsView['governance'],
    });
  };

  return (
    <SectionCard title="Quality Gates">
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(gates).map(([gate, settings]) => (
          <div key={gate} className="rounded border border-border bg-background">
            <div className="border-b border-border px-3 py-1.5">
              <span className="text-xs font-medium text-foreground/80">{humanize(gate)}</span>
            </div>
            <div className="space-y-0 px-3">
              {Object.entries(settings).map(([key, val]) => {
                const tooltip = TOOLTIPS[gate]?.[key];
                if (typeof val === 'boolean') {
                  return (
                    <Toggle
                      key={key}
                      label={humanize(key)}
                      tooltip={tooltip}
                      checked={val}
                      onChange={(v) => {
                        updateGate(gate, key, v);
                      }}
                    />
                  );
                }
                if (typeof val === 'number') {
                  const extra = NUMBER_PROPS[gate]?.[key];
                  return (
                    <NumberInput
                      key={key}
                      label={humanize(key)}
                      tooltip={tooltip}
                      value={val}
                      onChange={(v) => {
                        updateGate(gate, key, v ?? 0);
                      }}
                      min={0}
                      max={extra?.max}
                      step={extra?.step}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
