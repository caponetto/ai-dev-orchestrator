import { humanize } from '../../lib/humanize';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export interface StakeholderEntry {
  name?: string;
  role?: string;
  interest?: string;
}

export interface SpecAnalysisSection {
  completenessScore?: number;
  assumptions?: string[];
  requirements?: Requirement[];
  risks?: (Risk | string)[];
  ambiguities?: AmbiguityEntry[];
  scopeBoundary?: { inScope?: string[]; outOfScope?: string[] };
  technicalContext?: Record<string, JsonValue>;
}

export type AmbiguityEntry =
  string | { description?: string; question?: string; text?: string; impact?: string };

export interface SpecIdDescItem {
  id?: string;
  title?: string;
  description?: string;
  priority?: string;
}

export interface CanonicalSpecView {
  title: string;
  businessGoal?: string;
  sources?: unknown[];
  stakeholders?: StakeholderEntry[];
  assumptions?: SpecIdDescItem[];
  constraints?: SpecIdDescItem[];
  functionalRequirements?: SpecIdDescItem[];
  nonFunctionalRequirements?: SpecIdDescItem[];
  acceptanceCriteria?: SpecIdDescItem[];
  risks?: (Risk | string)[];
  definitionOfDone?: string[];
  analysis?: SpecAnalysisSection;
}

export interface JudgeDecisionView {
  verdict?: string;
  decision?: string;
  reasoning?: string;
  rationale?: string;
  scores?: Record<string, JsonValue>;
  conditions?: string[];
}

export interface ClarificationItem {
  question?: string;
  text?: string;
  answer?: string;
}

export interface ClarificationView {
  questions?: ClarificationItem[];
  answers?: ClarificationItem[];
}

export interface AgreementView {
  type?: string;
  agreementType?: string;
  status?: string;
  approvalStatus?: string;
}

export interface SourceEntry {
  type?: string;
  title?: string;
  path?: string;
  uri?: string;
  content?: string;
  relevance?: string;
  fieldsMapped?: string[];
}

export interface Requirement {
  id: string;
  priority?: string;
  category?: string;
  description?: string;
  statement?: string;
  acceptanceCriteria?: string;
  rationale?: string;
}

export interface Risk {
  id?: string;
  severity?: string;
  description?: string;
  mitigation?: string;
}

export interface ReviewFinding {
  description?: string;
  file?: string;
  suggestion?: string;
  evidence?: string;
  severity?: string;
}

export interface ACEntry {
  criterion?: string;
  evidence?: string;
  note?: string;
}

export interface UntrackedChangeEntry {
  file?: string;
  description?: string;
}

export interface ReviewReportFinding {
  id?: string;
  category?: string;
  severity?: string;
  description?: string;
  sources?: string[];
  file?: string | null;
  line?: number | null;
  suggestion?: string | null;
  evidence?: string | null;
}

export interface ReviewReportView {
  approved?: boolean;
  summary?: string;
  verdict?: string;
  findings?: ReviewReportFinding[];
  reviewSummary?: Record<string, JsonValue>;
}

export const METADATA_KEYS = new Set(['id', 'version', 'createdAt', 'updatedAt']);

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function stringifyPrimitive(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (isIsoDate(value)) {
    return formatDate(value);
  }
  return value;
}

export function renderValue(value: JsonValue, depth: number): string {
  if (value === null) {
    return '_none_';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return stringifyPrimitive(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '_none_';
    }
    if (value.every((v) => typeof v === 'string')) {
      return value.map((v) => `- ${v}`).join('\n');
    }
    if (value.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))) {
      return value.map((item) => renderObject(item as JsonObject, depth + 1)).join('\n\n');
    }
    return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
  }
  return renderObject(value, depth + 1);
}

export function isArtifactRef(obj: JsonObject): boolean {
  return (
    typeof obj['type'] === 'string' &&
    typeof obj['name'] === 'string' &&
    typeof obj['version'] === 'number' &&
    Object.keys(obj).length <= 4
  );
}

export function renderArtifactRefInline(obj: JsonObject): string {
  const type = humanize(obj['type'] as string);
  const version = obj['version'] as number;
  return `${type} v${String(version)}`;
}

export function renderObject(obj: JsonObject, depth: number): string {
  const heading = '#'.repeat(Math.min(depth + 1, 6));
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      continue;
    }

    const label = humanize(key);

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`**${label}:** ${stringifyPrimitive(value)}`);
    } else if (Array.isArray(value)) {
      lines.push(`${heading} ${label}\n`, renderValue(value, depth));
    } else if (isArtifactRef(value)) {
      lines.push(`**${label}:** ${renderArtifactRefInline(value)}`);
    } else {
      lines.push(`${heading} ${label}\n`, renderObject(value, depth + 1));
    }
  }

  return lines.join('\n\n');
}

export function renderMetadata(obj: JsonObject): string {
  const pairs: string[] = [];
  for (const key of METADATA_KEYS) {
    const value = obj[key];
    if (value === null) {
      continue;
    }
    if (typeof value === 'string') {
      pairs.push(`**${humanize(key)}:** ${isIsoDate(value) ? formatDate(value) : value}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      pairs.push(`**${humanize(key)}:** ${String(value)}`);
    }
  }
  return pairs.join(' · ');
}

export function renderRequirementsTable(requirements: Requirement[]): string {
  const lines = ['| ID | Priority | Description | Rationale |', '| --- | --- | --- | --- |'];
  for (const r of requirements) {
    const desc = r.description ?? r.statement ?? '—';
    const rationale = r.acceptanceCriteria ?? r.rationale ?? '—';
    lines.push(`| ${r.id} | ${r.priority ?? '—'} | ${desc} | ${rationale} |`);
  }
  return lines.join('\n');
}

export function renderRisks(risks: (Risk | string)[]): string {
  return risks
    .map((r) => {
      if (typeof r === 'string') {
        return `- ${r}`;
      }
      const label = r.id ?? r.severity ?? 'Risk';
      const desc = r.description ?? '';
      if (r.mitigation) {
        return `- **${label}:** ${desc}\n  - _Mitigation:_ ${r.mitigation}`;
      }
      return `- **${label}:** ${desc}`;
    })
    .join('\n');
}

export function renderScopeBoundary(scope: { inScope?: string[]; outOfScope?: string[] }): string {
  const lines: string[] = [];
  if (scope.inScope?.length) {
    lines.push('**In Scope:**', scope.inScope.map((s) => `- ${s}`).join('\n'));
  }
  if (scope.outOfScope?.length) {
    lines.push('\n**Out of Scope:**', scope.outOfScope.map((s) => `- ${s}`).join('\n'));
  }
  return lines.join('\n');
}

export function renderKeyValuePairs(obj: Record<string, JsonValue>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return `- **${humanize(k)}:** ${stringifyPrimitive(v)}`;
      }
      return `- **${humanize(k)}:** ${JSON.stringify(v)}`;
    })
    .join('\n');
}

export function omitKeys(obj: JsonObject, keys: Iterable<string>): JsonObject {
  const skip = new Set(keys);
  const result: JsonObject = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!skip.has(k)) {
      result[k] = v;
    }
  }
  return result;
}

export function renderSourceEntry(src: SourceEntry): string {
  const srcTitle = src.title ?? src.path ?? src.uri ?? src.type ?? 'Source';
  const srcContent = src.content ?? src.relevance ?? '';

  const parts: string[] = [];
  if (srcContent) {
    parts.push(`**${srcTitle}:** ${srcContent}`);
  } else {
    parts.push(`**${srcTitle}**`);
  }

  if (src.type && srcTitle !== src.type) {
    parts.push(`  _Type:_ ${src.type}`);
  }
  if (src.fieldsMapped?.length) {
    parts.push(`  _Fields:_ ${src.fieldsMapped.join(', ')}`);
  }
  return parts.join('\n');
}

export function renderIdDescriptionList(items: SpecIdDescItem[], heading: string): string {
  const rows = items.map((item) => {
    const desc = item.description ?? '';
    const label = [item.id, item.title].filter(Boolean).join(' — ') || 'Item';
    const suffix = item.priority ? ` _(${item.priority})_` : '';
    return `- **${label}**${suffix}: ${desc}`;
  });
  return `## ${heading}\n\n${rows.join('\n')}`;
}

export function toRaw(view: object): JsonObject {
  return view as unknown as JsonObject;
}
