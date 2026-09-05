import type { ProjectSettingsView, SettingsPermissionPolicy } from '@ai-dev-orchestrator/schemas';
import { permissionActionSchema } from '@ai-dev-orchestrator/schemas';
import { useRef, useState } from 'react';

import { Input } from '@/components/ui/input';

import { HelpIcon, InlineSelect, SectionCard } from './FormControls';

const RULE_ACTIONS = permissionActionSchema.options;
const RULE_DECISIONS = ['grant', 'deny'] as const;

interface Props {
  policy: SettingsPermissionPolicy | undefined;
  onChange: (patch: Partial<ProjectSettingsView>) => void;
}

export function PermissionPolicySection({ policy, onChange }: Readonly<Props>) {
  const [newCommand, setNewCommand] = useState('');
  const ruleKeysRef = useRef<string[]>([]);

  const current: SettingsPermissionPolicy = policy ?? {
    defaultAction: 'ask_human',
  };

  const rules = current.rules ?? [];
  while (ruleKeysRef.current.length < rules.length) {
    ruleKeysRef.current.push(crypto.randomUUID());
  }
  ruleKeysRef.current.length = rules.length;

  const emitPolicy = (next: SettingsPermissionPolicy) => {
    onChange({
      governance: { permissionPolicy: next },
    } as Partial<ProjectSettingsView>);
  };

  const addSafeCommand = () => {
    const trimmed = newCommand.trim();
    if (!trimmed) {
      return;
    }
    const existing = current.safeCommands ? [...current.safeCommands] : [];
    if (existing.includes(trimmed)) {
      return;
    }
    emitPolicy({ ...current, safeCommands: [...existing, trimmed] });
    setNewCommand('');
  };

  const removeSafeCommand = (index: number) => {
    const next = [...(current.safeCommands ?? [])];
    next.splice(index, 1);
    emitPolicy({ ...current, safeCommands: next });
  };

  const addRule = () => {
    const existing = current.rules ? [...current.rules] : [];
    ruleKeysRef.current.push(crypto.randomUUID());
    emitPolicy({
      ...current,
      rules: [...existing, { action: 'file_read', decision: 'grant' as const }],
    });
  };

  const removeRule = (index: number) => {
    const next = [...(current.rules ?? [])];
    next.splice(index, 1);
    ruleKeysRef.current.splice(index, 1);
    emitPolicy({ ...current, rules: next });
  };

  const updateRule = (index: number, field: string, value: string) => {
    const next = [...(current.rules ?? [])].map((r) => ({ ...r }));
    (next[index] as Record<string, unknown>)[field] = value || undefined;
    emitPolicy({ ...current, rules: next });
  };

  return (
    <SectionCard
      title="Permission Policy"
      tooltip="Controls what actions agents are allowed to perform during workflow execution"
    >
      <div className="grid grid-cols-[1fr_2fr] gap-4">
        {/* Safe Commands */}
        <div className="self-start rounded border border-border bg-background">
          <div className="border-b border-border px-3 py-1.5">
            <span className="inline-flex items-center text-xs font-medium text-foreground/80">
              Safe Commands
              <HelpIcon text="Shell commands that are auto-granted for medium-trust roles without prompting the user." />
            </span>
          </div>
          <div className="space-y-2 px-3 py-2">
            {(current.safeCommands ?? []).map((cmd, i) => (
              <div key={cmd} className="flex items-center gap-2">
                <span className="flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground">
                  {cmd}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeSafeCommand(i);
                  }}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newCommand}
                onChange={(e) => {
                  setNewCommand(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addSafeCommand();
                  }
                }}
                placeholder="e.g. npm test"
                className="h-7 flex-1 text-xs"
              />
              <button
                type="button"
                onClick={addSafeCommand}
                className="rounded border border-border px-2 py-1 text-xs text-foreground/80 hover:bg-muted"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Rules */}
        <div className="self-start rounded border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="inline-flex items-center text-xs font-medium text-foreground/80">
              Rules
              <HelpIcon text="Custom permission rules evaluated in order. The first matching rule wins. Use scope and pattern to target specific files or commands." />
            </span>
            <button
              type="button"
              onClick={addRule}
              className="rounded border border-border px-2 py-0.5 text-xs text-foreground/80 hover:bg-muted"
            >
              Add Rule
            </button>
          </div>
          {(current.rules ?? []).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Decision</th>
                    <th className="px-3 py-2 font-medium">Scope</th>
                    <th className="px-3 py-2 font-medium">Pattern</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rules.map((rule, i) => (
                    <tr key={ruleKeysRef.current[i]} className="transition-colors hover:bg-card">
                      <td className="px-3 py-2">
                        <InlineSelect
                          value={rule.action}
                          options={RULE_ACTIONS}
                          onChange={(v) => {
                            updateRule(i, 'action', v);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <InlineSelect
                          value={rule.decision}
                          options={RULE_DECISIONS}
                          onChange={(v) => {
                            updateRule(i, 'decision', v);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="text"
                          value={rule.scope ?? ''}
                          onChange={(e) => {
                            updateRule(i, 'scope', e.target.value);
                          }}
                          placeholder="e.g. src/**"
                          className="h-7 w-full text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="text"
                          value={rule.pattern ?? ''}
                          onChange={(e) => {
                            updateRule(i, 'pattern', e.target.value);
                          }}
                          placeholder="e.g. *.ts"
                          className="h-7 w-full text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => {
                            removeRule(i);
                          }}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
