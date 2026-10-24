import type { AgentTask } from '@ai-dev-orchestrator/schemas';

import { labelForOutputFormat } from './output-format';

export function buildAgentTaskPrompt(task: AgentTask, taskFilePath: string): string {
  const formatLabel = labelForOutputFormat(task.constraints.outputFormat ?? 'json');

  const lines = [
    'Read the JSON task file at the path below and execute it as the authoritative task definition.',
    `Task file: ${taskFilePath}`,
    `Repository root: ${task.repoRoot}`,
    `Required output artifact path: ${task.outputArtifactPath}`,
    `Required output format: ${formatLabel}`,
    '',
    `Your role: ${task.role} — ${task.description}`,
    '',
    'MANDATORY FIRST STEP — before reading the task file or calling any tool, write ONE short greeting line (max 20 words) in your own words, in the form "Hi, I\'m the <role name> — I\'ll <what you will do in this task>." Use a readable role name derived from your role above and describe your actual task; do not reuse this template verbatim. Do this even if the role instructions below say nothing about it.',
  ];

  if (task.userPrompt) {
    lines.push(
      '',
      'User Goal (the original request that initiated this workflow):',
      task.userPrompt,
    );
  }

  if (task.rolePrompt) {
    lines.push('', '--- Role Instructions ---', '', task.rolePrompt);
  }

  const formatRules: string[] = [];
  const format = task.constraints.outputFormat ?? 'json';
  if (format === 'json') {
    formatRules.push(
      '- Write exactly one JSON value (object, or array only if the output contract requires an array).',
      '- Overwrite the output file with the final content; never append a second top-level JSON value.',
      '- The final file must be valid for JSON.parse with no trailing content after the value.',
      '- Prefer a single final write of the complete artifact.',
    );
  } else if (format === 'yaml') {
    formatRules.push(
      '- Write exactly one YAML document.',
      '- Overwrite the output file with the final content; never append a second document.',
      '- Prefer a single final write of the complete artifact.',
    );
  } else {
    formatRules.push(
      '- Overwrite the output file with the final content; do not append extra copies.',
      '- Prefer a single final write of the complete artifact.',
    );
  }

  lines.push(
    '',
    'CRITICAL — Output File Rules (violation causes validation failure):',
    `- The output artifact file must contain exactly ONE ${formatLabel} value. No more.`,
    '- NEVER append to the output file. Always overwrite it with the complete, final content in a single write.',
    '- After writing, the file must be valid for JSON.parse() with zero trailing content — no extra objects, no duplicate writes, no leftover fragments.',
    '- If you need to revise your output, overwrite the entire file. Do NOT write a second JSON object after the first.',
    ...formatRules,
    '',
    'General:',
    '- Read the task file before starting work.',
    '- Follow the role instructions above as your primary guidance.',
    `- Write the final artifact to the required output artifact path as ${formatLabel}.`,
    '',
    'Output Verbosity — IMPORTANT:',
    '- Your stdout is streamed to a human dashboard. Keep progress updates minimal and high-signal.',
    '- DO: report key decisions, findings, and the final result.',
    '- The opening greeting (see MANDATORY FIRST STEP) is required and is the only exception to the no-narration rule.',
    '- DO NOT: otherwise narrate what you are about to do ("I\'ll read the file..."), echo back the task, describe routine steps ("Let me verify..."), or explain intermediate validation results.',
    '- Aim for 3-5 progress lines per task after the greeting, not 10-20. Silence is fine while working.',
    '- If stream-json mode is enabled, emit progress and completion events on stdout while working.',
  );

  if (task.iterationCount && task.iterationCount > 1) {
    lines.push(
      '',
      `This is iteration ${String(task.iterationCount)} of this task. Address all findings above.`,
    );
  }

  return lines.join('\n');
}
