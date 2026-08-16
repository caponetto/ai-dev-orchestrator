const KNOWN_ACRONYMS = ['UX', 'UI', 'API', 'PR', 'CI', 'CD', 'QA', 'LLM', 'AI', 'SSE'];
const ACRONYM_SET = new Set(KNOWN_ACRONYMS);
const ACRONYM_PATTERN = new RegExp(String.raw`\b(${KNOWN_ACRONYMS.join('|')})\b`, 'gi');

/** Title-case an identifier (camelCase, snake_case, UPPER_CASE, or kebab-case → Title Case). */
export function humanize(str: string): string {
  return str
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]/g, ' ')
    .replaceAll(/\b[A-Z]{2,}\b/g, (w) =>
      ACRONYM_SET.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase(),
    )
    .replaceAll(/\b\w/g, (c) => c.toUpperCase())
    .replaceAll(ACRONYM_PATTERN, (w) => w.toUpperCase());
}

/** Display label matching the Artifacts panel name column, with version. */
export function formatArtifactDisplayName(ref: {
  readonly type: string;
  readonly name: string;
  readonly version: number;
}): string {
  return `${humanize(ref.type)} v${String(ref.version)}`;
}
