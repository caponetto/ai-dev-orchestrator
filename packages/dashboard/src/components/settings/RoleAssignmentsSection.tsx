import type {
  ProjectSettingsView,
  SettingsPermissionPolicy,
  SettingsRoleAssignment,
} from '@ai-dev-orchestrator/schemas';
import { roleTrustLevelSchema } from '@ai-dev-orchestrator/schemas';

import { humanize } from '../../lib/humanize';

import { HelpIcon, InlineSelect } from './FormControls';

const TRUST_LEVELS = roleTrustLevelSchema.options;

const ROLE_TOOLTIPS: Record<string, string> = {
  requirements_analyst: 'Gathers and clarifies requirements from the user input',
  context_analyst: 'Analyzes codebase context and gathers relevant information',
  planner: 'Produces an implementation plan and task breakdown',
  plan_reviewer: 'Reviews the plan for feasibility and completeness',
  implementer: 'Writes the actual code based on the approved plan',
  static_reviewer: 'Checks code quality, style, and correctness',
  design_reviewer: 'Evaluates architecture, design patterns, and code structure',
  security_reviewer: 'Identifies security vulnerabilities in the implementation',
  performance_reviewer: 'Evaluates performance and resource efficiency',
  adversarial_reviewer: 'Stress-tests the implementation by finding edge cases and flaws',
  judge: 'Arbitrates when reviewers disagree after max iterations',
  verifier: 'Runs tests and validates the implementation works correctly',
  report_synthesizer: 'Aggregates review feedback into a consolidated report',
  summary_writer: 'Produces release artifacts such as changelogs and summaries',
  acceptance_validator: 'Validates that the final output meets the original acceptance criteria',
};

interface Props {
  assignments: Record<string, SettingsRoleAssignment>;
  availableRunners: readonly string[];
  modelsByRunner: Readonly<Record<string, readonly string[]>>;
  permissionPolicy: SettingsPermissionPolicy | undefined;
  onChange: (patch: Partial<ProjectSettingsView>) => void;
}

export function RoleAssignmentsSection({
  assignments,
  availableRunners,
  modelsByRunner,
  permissionPolicy,
  onChange,
}: Readonly<Props>) {
  const updateRole = (role: string, patch: Partial<SettingsRoleAssignment>) => {
    onChange({
      roles: {
        assignments: {
          ...assignments,
          [role]: { ...assignments[role], ...patch },
        },
      },
    });
  };

  const updateRoleTrust = (role: string, level: string) => {
    onChange({
      governance: {
        permissionPolicy: {
          ...(permissionPolicy ?? { defaultAction: 'ask_human' as const }),
          roleTrust: {
            ...permissionPolicy?.roleTrust,
            [role]: level as 'high' | 'medium' | 'none',
          },
        },
      },
    } as Partial<ProjectSettingsView>);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 inline-flex items-center text-sm font-semibold text-foreground/80">
        Role Assignments
        <HelpIcon text="Map each workflow role to a runner and LLM model." />
      </h3>
      <div className="overflow-x-auto overflow-y-visible rounded border border-border bg-background">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Runner</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">
                <span className="inline-flex items-center">
                  Trust Level
                  <HelpIcon text="Controls role autonomy for permission decisions. High: all actions auto-granted. Medium: only safe commands auto-granted. None: all actions follow the default permission policy." />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(assignments).map(([role, assignment]) => {
              const runner = assignment.runner ?? '';
              const models = modelsByRunner[runner] ?? [];
              return (
                <tr key={role} className="transition-colors hover:bg-card">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">
                    <span className="inline-flex items-center">
                      {humanize(role)}
                      {ROLE_TOOLTIPS[role] && <HelpIcon text={ROLE_TOOLTIPS[role]} />}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect
                      value={runner}
                      options={availableRunners}
                      onChange={(v) => {
                        const newModels = modelsByRunner[v] ?? [];
                        const modelValid = newModels.includes(assignment.model);
                        updateRole(role, {
                          runner: v,
                          model: modelValid ? assignment.model : (newModels[0] ?? ''),
                        });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect
                      value={assignment.model}
                      options={models}
                      onChange={(v) => {
                        updateRole(role, { model: v });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <InlineSelect
                      value={permissionPolicy?.roleTrust?.[role] ?? 'medium'}
                      options={TRUST_LEVELS}
                      onChange={(v) => {
                        updateRoleTrust(role, v);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
