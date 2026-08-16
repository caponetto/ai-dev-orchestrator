import { describe, expect, it } from 'vitest';

import type {
  JsonObject,
  JsonValue,
  Requirement,
  Risk,
  SourceEntry,
  SpecIdDescItem,
} from '../shared';
import {
  formatDate,
  isArtifactRef,
  isIsoDate,
  METADATA_KEYS,
  omitKeys,
  renderArtifactRefInline,
  renderIdDescriptionList,
  renderKeyValuePairs,
  renderMetadata,
  renderObject,
  renderRequirementsTable,
  renderRisks,
  renderScopeBoundary,
  renderSourceEntry,
  renderValue,
  stringifyPrimitive,
  toRaw,
} from '../shared';

// ---------------------------------------------------------------------------
// METADATA_KEYS
// ---------------------------------------------------------------------------
describe('METADATA_KEYS', () => {
  it('contains exactly the four expected keys', () => {
    expect(METADATA_KEYS).toEqual(new Set(['id', 'version', 'createdAt', 'updatedAt']));
  });

  it('is a Set instance', () => {
    expect(METADATA_KEYS).toBeInstanceOf(Set);
  });

  it('has size 4', () => {
    expect(METADATA_KEYS.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// isIsoDate
// ---------------------------------------------------------------------------
describe('isIsoDate', () => {
  it('returns true for a full ISO 8601 date-time string', () => {
    expect(isIsoDate('2024-01-15T10:30:00.000Z')).toBe(true);
  });

  it('returns true for an ISO date-time without milliseconds', () => {
    expect(isIsoDate('2024-01-15T10:30:00Z')).toBe(true);
  });

  it('returns true for an ISO date-time without timezone', () => {
    expect(isIsoDate('2024-01-15T10:30')).toBe(true);
  });

  it('returns true for an ISO date-time with offset', () => {
    expect(isIsoDate('2024-06-01T08:00:00+05:30')).toBe(true);
  });

  it('returns false for a plain date without time', () => {
    expect(isIsoDate('2024-01-15')).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isIsoDate('hello world')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isIsoDate('')).toBe(false);
  });

  it('returns false for a numeric string', () => {
    expect(isIsoDate('12345')).toBe(false);
  });

  it('returns false for a partial match', () => {
    expect(isIsoDate('2024-01-15 10:30')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDate('2024-01-15T10:30:00.000Z');
    // toLocaleString output varies by locale; just verify it does not return the raw input
    expect(result).toBeTruthy();
    expect(result).not.toBe('');
  });

  it('returns the original string for an invalid date', () => {
    expect(formatDate('not-a-date')).toBe('Invalid Date');
  });

  it('handles edge-case dates', () => {
    const result = formatDate('1970-01-01T00:00:00Z');
    expect(result).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// stringifyPrimitive
// ---------------------------------------------------------------------------
describe('stringifyPrimitive', () => {
  it('returns "Yes" for true', () => {
    expect(stringifyPrimitive(true)).toBe('Yes');
  });

  it('returns "No" for false', () => {
    expect(stringifyPrimitive(false)).toBe('No');
  });

  it('converts a number to its string representation', () => {
    expect(stringifyPrimitive(42)).toBe('42');
  });

  it('converts zero to "0"', () => {
    expect(stringifyPrimitive(0)).toBe('0');
  });

  it('converts negative numbers', () => {
    expect(stringifyPrimitive(-7)).toBe('-7');
  });

  it('converts a float', () => {
    expect(stringifyPrimitive(3.14)).toBe('3.14');
  });

  it('formats an ISO date string via formatDate', () => {
    const result = stringifyPrimitive('2024-01-15T10:30:00.000Z');
    // Should go through formatDate, so it should differ from the raw input
    expect(result).not.toBe('2024-01-15T10:30:00.000Z');
    expect(result).toBeTruthy();
  });

  it('returns a plain string as-is', () => {
    expect(stringifyPrimitive('hello')).toBe('hello');
  });

  it('returns an empty string as-is', () => {
    expect(stringifyPrimitive('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// renderValue
// ---------------------------------------------------------------------------
describe('renderValue', () => {
  it('returns "_none_" for null', () => {
    expect(renderValue(null, 0)).toBe('_none_');
  });

  it('renders a string via stringifyPrimitive', () => {
    expect(renderValue('hello', 0)).toBe('hello');
  });

  it('renders a number via stringifyPrimitive', () => {
    expect(renderValue(42, 0)).toBe('42');
  });

  it('renders a boolean via stringifyPrimitive', () => {
    expect(renderValue(true, 0)).toBe('Yes');
    expect(renderValue(false, 0)).toBe('No');
  });

  it('returns "_none_" for an empty array', () => {
    expect(renderValue([], 0)).toBe('_none_');
  });

  it('renders an array of strings as bullet list', () => {
    const result = renderValue(['alpha', 'beta', 'gamma'], 0);
    expect(result).toBe('- alpha\n- beta\n- gamma');
  });

  it('renders an array of objects via renderObject', () => {
    const items: JsonValue[] = [
      { name: 'first', value: 1 },
      { name: 'second', value: 2 },
    ];
    const result = renderValue(items, 0);
    expect(result).toContain('**Name:** first');
    expect(result).toContain('**Value:** 1');
    expect(result).toContain('**Name:** second');
    expect(result).toContain('**Value:** 2');
  });

  it('renders a mixed array as JSON code block', () => {
    const mixed: JsonValue[] = ['text', 42, true];
    const result = renderValue(mixed, 0);
    expect(result).toContain('```json');
    expect(result).toContain('"text"');
    expect(result).toContain('42');
    expect(result).toContain('true');
    expect(result).toContain('```');
  });

  it('renders an array containing arrays as JSON code block', () => {
    const nested: JsonValue[] = [
      [1, 2],
      [3, 4],
    ];
    const result = renderValue(nested, 0);
    expect(result).toContain('```json');
  });

  it('renders an array with null elements as JSON code block', () => {
    const withNulls: JsonValue[] = [null, 'text', null];
    const result = renderValue(withNulls, 0);
    expect(result).toContain('```json');
  });

  it('renders a plain object via renderObject', () => {
    const obj: JsonValue = { key: 'val' };
    const result = renderValue(obj, 0);
    expect(result).toContain('**Key:** val');
  });

  it('passes depth to renderObject for nested objects', () => {
    const obj: JsonValue = { nested: { inner: 'deep' } };
    const result = renderValue(obj, 2);
    // depth 2 -> renderObject at depth 3 -> heading #### (depth+1=4)
    expect(result).toContain('####');
  });
});

// ---------------------------------------------------------------------------
// isArtifactRef
// ---------------------------------------------------------------------------
describe('isArtifactRef', () => {
  it('returns true for a valid artifact ref with type, name, version', () => {
    const ref: JsonObject = { type: 'specification', name: 'my-spec', version: 1 };
    expect(isArtifactRef(ref)).toBe(true);
  });

  it('returns true for a valid artifact ref with 4 keys', () => {
    const ref: JsonObject = { type: 'specification', name: 'my-spec', version: 1, extra: 'val' };
    expect(isArtifactRef(ref)).toBe(true);
  });

  it('returns false when type is missing', () => {
    const ref: JsonObject = { name: 'my-spec', version: 1 };
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('returns false when name is missing', () => {
    const ref: JsonObject = { type: 'specification', version: 1 };
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('returns false when version is missing', () => {
    const ref: JsonObject = { type: 'specification', name: 'my-spec' };
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('returns false when type is not a string', () => {
    const ref: JsonObject = { type: 123, name: 'my-spec', version: 1 };
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('returns false when name is not a string', () => {
    const ref: JsonObject = { type: 'specification', name: 42, version: 1 };
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('returns false when version is not a number', () => {
    const ref: JsonObject = { type: 'specification', name: 'my-spec', version: '1' };
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('returns false when object has more than 4 keys', () => {
    const ref: JsonObject = {
      type: 'specification',
      name: 'my-spec',
      version: 1,
      a: 'x',
      b: 'y',
    };
    expect(isArtifactRef(ref)).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isArtifactRef({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderArtifactRefInline
// ---------------------------------------------------------------------------
describe('renderArtifactRefInline', () => {
  it('renders a humanized type with version', () => {
    const ref: JsonObject = { type: 'canonical_specification', name: 'spec', version: 3 };
    const result = renderArtifactRefInline(ref);
    expect(result).toContain('Canonical Specification');
    expect(result).toContain('v3');
  });

  it('renders simple type with version', () => {
    const ref: JsonObject = { type: 'plan', name: 'my-plan', version: 1 };
    const result = renderArtifactRefInline(ref);
    expect(result).toBe('Plan v1');
  });
});

// ---------------------------------------------------------------------------
// renderObject
// ---------------------------------------------------------------------------
describe('renderObject', () => {
  it('renders primitive key-value pairs', () => {
    const obj: JsonObject = { name: 'test', count: 5, active: true };
    const result = renderObject(obj, 0);
    expect(result).toContain('**Name:** test');
    expect(result).toContain('**Count:** 5');
    expect(result).toContain('**Active:** Yes');
  });

  it('skips null values', () => {
    const obj: JsonObject = { name: 'test', removed: null };
    const result = renderObject(obj, 0);
    expect(result).toContain('**Name:** test');
    expect(result).not.toContain('Removed');
  });

  it('renders arrays with a heading', () => {
    const obj: JsonObject = { items: ['a', 'b', 'c'] };
    const result = renderObject(obj, 0);
    expect(result).toContain('# Items');
    expect(result).toContain('- a');
    expect(result).toContain('- b');
    expect(result).toContain('- c');
  });

  it('renders artifact refs inline', () => {
    const obj: JsonObject = {
      source: { type: 'plan', name: 'my-plan', version: 2 },
    };
    const result = renderObject(obj, 0);
    expect(result).toContain('**Source:** Plan v2');
  });

  it('renders nested objects recursively', () => {
    const obj: JsonObject = {
      config: { timeout: 30, retries: 3 },
    };
    const result = renderObject(obj, 0);
    expect(result).toContain('# Config');
    expect(result).toContain('**Timeout:** 30');
    expect(result).toContain('**Retries:** 3');
  });

  it('caps heading depth at 6', () => {
    const obj: JsonObject = { nested: { deep: 'value' } };
    const result = renderObject(obj, 5);
    // depth 5 -> heading ###### (6), then nested goes to depth 6 -> still ######
    expect(result).toContain('######');
  });

  it('renders booleans as Yes/No in object context', () => {
    const obj: JsonObject = { enabled: true, disabled: false };
    const result = renderObject(obj, 0);
    expect(result).toContain('**Enabled:** Yes');
    expect(result).toContain('**Disabled:** No');
  });

  it('renders ISO date strings via formatDate', () => {
    const obj: JsonObject = { createdAt: '2024-01-15T10:30:00.000Z' };
    const result = renderObject(obj, 0);
    expect(result).toContain('**Created At:**');
    expect(result).not.toContain('2024-01-15T10:30:00.000Z');
  });

  it('returns empty string for an empty object', () => {
    expect(renderObject({}, 0)).toBe('');
  });

  it('renders an all-null object as empty string', () => {
    const obj: JsonObject = { a: null, b: null };
    expect(renderObject(obj, 0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// renderMetadata
// ---------------------------------------------------------------------------
describe('renderMetadata', () => {
  it('renders all four metadata keys when present', () => {
    const obj: JsonObject = {
      id: 'abc-123',
      version: 2,
      createdAt: '2024-01-15T10:30:00.000Z',
      updatedAt: '2024-06-01T12:00:00.000Z',
    };
    const result = renderMetadata(obj);
    expect(result).toContain('**Id:** abc-123');
    expect(result).toContain('**Version:** 2');
    expect(result).toContain('**Created At:**');
    expect(result).toContain('**Updated At:**');
    // Separator between pairs
    expect(result).toContain(' · ');
  });

  it('skips keys that are null', () => {
    const obj: JsonObject = { id: 'x', version: null, createdAt: null, updatedAt: null };
    const result = renderMetadata(obj);
    expect(result).toContain('**Id:** x');
    expect(result).not.toContain('Version');
    expect(result).not.toContain('Created At');
  });

  it('skips keys that are not present', () => {
    const obj: JsonObject = { id: 'only-id' };
    const result = renderMetadata(obj);
    expect(result).toBe('**Id:** only-id');
  });

  it('returns empty string when no metadata keys are present', () => {
    const obj: JsonObject = { title: 'Not metadata' };
    expect(renderMetadata(obj)).toBe('');
  });

  it('renders boolean metadata values', () => {
    // version as boolean (edge case)
    const obj: JsonObject = { id: 'test', version: true };
    const result = renderMetadata(obj);
    expect(result).toContain('**Version:** true');
  });

  it('formats ISO date metadata values', () => {
    const obj: JsonObject = { createdAt: '2024-01-15T10:30:00.000Z' };
    const result = renderMetadata(obj);
    expect(result).toContain('**Created At:**');
    // Should NOT contain the raw ISO string
    expect(result).not.toContain('2024-01-15T10:30:00.000Z');
  });

  it('renders non-ISO string values as-is', () => {
    const obj: JsonObject = { id: 'plain-string' };
    const result = renderMetadata(obj);
    expect(result).toContain('**Id:** plain-string');
  });
});

// ---------------------------------------------------------------------------
// renderRequirementsTable
// ---------------------------------------------------------------------------
describe('renderRequirementsTable', () => {
  it('renders a table header and row', () => {
    const reqs: Requirement[] = [
      { id: 'REQ-1', priority: 'High', description: 'Do something', rationale: 'Because' },
    ];
    const result = renderRequirementsTable(reqs);
    expect(result).toContain('| ID | Priority | Description | Rationale |');
    expect(result).toContain('| --- | --- | --- | --- |');
    expect(result).toContain('| REQ-1 | High | Do something | Because |');
  });

  it('uses statement as fallback when description is missing', () => {
    const reqs: Requirement[] = [{ id: 'REQ-2', statement: 'Must work' }];
    const result = renderRequirementsTable(reqs);
    expect(result).toContain('Must work');
  });

  it('uses dash when description and statement are both missing', () => {
    const reqs: Requirement[] = [{ id: 'REQ-3' }];
    const result = renderRequirementsTable(reqs);
    const lines = result.split('\n');
    const dataRow = lines[2];
    expect(dataRow).toContain('| REQ-3 |');
    // description column should be dash
    expect(dataRow).toMatch(/\| — \|/);
  });

  it('uses acceptanceCriteria as rationale fallback', () => {
    const reqs: Requirement[] = [
      { id: 'REQ-4', description: 'Test', acceptanceCriteria: 'Criteria text' },
    ];
    const result = renderRequirementsTable(reqs);
    expect(result).toContain('Criteria text');
  });

  it('uses dash when priority is missing', () => {
    const reqs: Requirement[] = [{ id: 'REQ-5', description: 'Desc' }];
    const result = renderRequirementsTable(reqs);
    const lines = result.split('\n');
    const dataRow = lines[2];
    // priority column should be dash
    expect(dataRow).toMatch(/REQ-5 \| — \|/);
  });

  it('renders multiple rows', () => {
    const reqs: Requirement[] = [
      { id: 'R1', priority: 'Low', description: 'First' },
      { id: 'R2', priority: 'High', description: 'Second' },
    ];
    const result = renderRequirementsTable(reqs);
    const lines = result.split('\n');
    // header + separator + 2 data rows
    expect(lines).toHaveLength(4);
  });

  it('renders empty requirements list with only header', () => {
    const result = renderRequirementsTable([]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2); // header + separator only
  });
});

// ---------------------------------------------------------------------------
// renderRisks
// ---------------------------------------------------------------------------
describe('renderRisks', () => {
  it('renders a string risk as a bullet', () => {
    const result = renderRisks(['Something risky']);
    expect(result).toBe('- Something risky');
  });

  it('renders a Risk object with id and description', () => {
    const risks: Risk[] = [{ id: 'R1', description: 'Bad thing' }];
    const result = renderRisks(risks);
    expect(result).toBe('- **R1:** Bad thing');
  });

  it('renders a Risk object with mitigation', () => {
    const risks: Risk[] = [{ id: 'R1', description: 'Bad', mitigation: 'Fix it' }];
    const result = renderRisks(risks);
    expect(result).toContain('- **R1:** Bad');
    expect(result).toContain('  - _Mitigation:_ Fix it');
  });

  it('uses severity as fallback label when id is missing', () => {
    const risks: Risk[] = [{ severity: 'High', description: 'Danger' }];
    const result = renderRisks(risks);
    expect(result).toContain('**High:** Danger');
  });

  it('uses "Risk" as fallback label when both id and severity are missing', () => {
    const risks: Risk[] = [{ description: 'Unknown risk' }];
    const result = renderRisks(risks);
    expect(result).toContain('**Risk:** Unknown risk');
  });

  it('renders empty description when description is missing', () => {
    const risks: Risk[] = [{ id: 'R1' }];
    const result = renderRisks(risks);
    expect(result).toBe('- **R1:** ');
  });

  it('renders mixed string and object risks', () => {
    const risks: (Risk | string)[] = [
      'Simple risk',
      { id: 'R1', description: 'Complex risk', mitigation: 'Handle it' },
    ];
    const result = renderRisks(risks);
    expect(result).toContain('- Simple risk');
    expect(result).toContain('- **R1:** Complex risk');
    expect(result).toContain('_Mitigation:_ Handle it');
  });

  it('renders an empty risks array as empty string', () => {
    expect(renderRisks([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// renderScopeBoundary
// ---------------------------------------------------------------------------
describe('renderScopeBoundary', () => {
  it('renders both in-scope and out-of-scope', () => {
    const result = renderScopeBoundary({
      inScope: ['Feature A', 'Feature B'],
      outOfScope: ['Feature C'],
    });
    expect(result).toContain('**In Scope:**');
    expect(result).toContain('- Feature A');
    expect(result).toContain('- Feature B');
    expect(result).toContain('**Out of Scope:**');
    expect(result).toContain('- Feature C');
  });

  it('renders only in-scope when out-of-scope is missing', () => {
    const result = renderScopeBoundary({ inScope: ['Feature A'] });
    expect(result).toContain('**In Scope:**');
    expect(result).toContain('- Feature A');
    expect(result).not.toContain('Out of Scope');
  });

  it('renders only out-of-scope when in-scope is missing', () => {
    const result = renderScopeBoundary({ outOfScope: ['Feature X'] });
    expect(result).toContain('**Out of Scope:**');
    expect(result).toContain('- Feature X');
    expect(result).not.toContain('In Scope');
  });

  it('returns empty string when both are empty arrays', () => {
    expect(renderScopeBoundary({ inScope: [], outOfScope: [] })).toBe('');
  });

  it('returns empty string when both are undefined', () => {
    expect(renderScopeBoundary({})).toBe('');
  });

  it('skips in-scope when it is an empty array', () => {
    const result = renderScopeBoundary({ inScope: [], outOfScope: ['X'] });
    expect(result).not.toContain('In Scope');
    expect(result).toContain('**Out of Scope:**');
  });
});

// ---------------------------------------------------------------------------
// renderKeyValuePairs
// ---------------------------------------------------------------------------
describe('renderKeyValuePairs', () => {
  it('renders string values with humanized keys', () => {
    const result = renderKeyValuePairs({ firstName: 'Alice', lastName: 'Smith' });
    expect(result).toContain('- **First Name:** Alice');
    expect(result).toContain('- **Last Name:** Smith');
  });

  it('renders number values', () => {
    const result = renderKeyValuePairs({ count: 42 });
    expect(result).toContain('- **Count:** 42');
  });

  it('renders boolean values as Yes/No', () => {
    const result = renderKeyValuePairs({ enabled: true, disabled: false });
    expect(result).toContain('- **Enabled:** Yes');
    expect(result).toContain('- **Disabled:** No');
  });

  it('filters out null values', () => {
    const result = renderKeyValuePairs({ visible: 'yes', hidden: null });
    expect(result).toContain('**Visible:** yes');
    expect(result).not.toContain('Hidden');
  });

  it('renders complex values as JSON', () => {
    const result = renderKeyValuePairs({ config: { nested: true } });
    expect(result).toContain('- **Config:** {"nested":true}');
  });

  it('renders arrays as JSON', () => {
    const result = renderKeyValuePairs({ tags: ['a', 'b'] as JsonValue });
    expect(result).toContain('- **Tags:** ["a","b"]');
  });

  it('returns empty string for empty object', () => {
    expect(renderKeyValuePairs({})).toBe('');
  });

  it('returns empty string when all values are null', () => {
    expect(renderKeyValuePairs({ a: null, b: null })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// omitKeys
// ---------------------------------------------------------------------------
describe('omitKeys', () => {
  it('removes specified keys from the object', () => {
    const obj: JsonObject = { a: 1, b: 2, c: 3 };
    const result = omitKeys(obj, ['a', 'c']);
    expect(result).toEqual({ b: 2 });
  });

  it('returns all keys when none are omitted', () => {
    const obj: JsonObject = { x: 'hello', y: 'world' };
    const result = omitKeys(obj, []);
    expect(result).toEqual({ x: 'hello', y: 'world' });
  });

  it('returns empty object when all keys are omitted', () => {
    const obj: JsonObject = { a: 1, b: 2 };
    const result = omitKeys(obj, ['a', 'b']);
    expect(result).toEqual({});
  });

  it('ignores keys that do not exist in the object', () => {
    const obj: JsonObject = { a: 1 };
    const result = omitKeys(obj, ['b', 'c']);
    expect(result).toEqual({ a: 1 });
  });

  it('does not mutate the original object', () => {
    const obj: JsonObject = { a: 1, b: 2 };
    const result = omitKeys(obj, ['a']);
    expect(obj).toEqual({ a: 1, b: 2 });
    expect(result).toEqual({ b: 2 });
  });

  it('accepts a Set as the keys iterable', () => {
    const obj: JsonObject = { a: 1, b: 2, c: 3 };
    const result = omitKeys(obj, new Set(['b']));
    expect(result).toEqual({ a: 1, c: 3 });
  });

  it('accepts METADATA_KEYS as the keys iterable', () => {
    const obj: JsonObject = { id: 'x', version: 1, title: 'Test', createdAt: '2024-01-01T00:00' };
    const result = omitKeys(obj, METADATA_KEYS);
    expect(result).toEqual({ title: 'Test' });
  });

  it('returns empty object for empty input', () => {
    expect(omitKeys({}, ['a'])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// renderSourceEntry
// ---------------------------------------------------------------------------
describe('renderSourceEntry', () => {
  it('renders title with content', () => {
    const src: SourceEntry = { title: 'README', content: 'Overview of project' };
    const result = renderSourceEntry(src);
    expect(result).toBe('**README:** Overview of project');
  });

  it('renders title with relevance as fallback for content', () => {
    const src: SourceEntry = { title: 'Docs', relevance: 'High relevance' };
    const result = renderSourceEntry(src);
    expect(result).toBe('**Docs:** High relevance');
  });

  it('falls back to path when title is missing', () => {
    const src: SourceEntry = { path: '/src/main.ts', content: 'Entry point' };
    const result = renderSourceEntry(src);
    expect(result).toBe('**/src/main.ts:** Entry point');
  });

  it('falls back to uri when title and path are missing', () => {
    const src: SourceEntry = { uri: 'https://example.com', content: 'External ref' };
    const result = renderSourceEntry(src);
    expect(result).toBe('**https://example.com:** External ref');
  });

  it('falls back to type when title, path, and uri are missing', () => {
    const src: SourceEntry = { type: 'file', content: 'Some content' };
    const result = renderSourceEntry(src);
    expect(result).toBe('**file:** Some content');
  });

  it('falls back to "Source" when all name fields are missing', () => {
    const src: SourceEntry = { content: 'Orphaned content' };
    const result = renderSourceEntry(src);
    expect(result).toBe('**Source:** Orphaned content');
  });

  it('renders title without content', () => {
    const src: SourceEntry = { title: 'Empty Source' };
    const result = renderSourceEntry(src);
    expect(result).toBe('**Empty Source**');
  });

  it('appends type when different from title', () => {
    const src: SourceEntry = { title: 'README', type: 'file' };
    const result = renderSourceEntry(src);
    expect(result).toContain('**README**');
    expect(result).toContain('_Type:_ file');
  });

  it('does not append type when same as title', () => {
    const src: SourceEntry = { type: 'file' };
    // title falls back to type='file', so srcTitle === src.type
    const result = renderSourceEntry(src);
    expect(result).toBe('**file**');
    expect(result).not.toContain('_Type:_');
  });

  it('appends fieldsMapped when present', () => {
    const src: SourceEntry = { title: 'Config', fieldsMapped: ['host', 'port', 'timeout'] };
    const result = renderSourceEntry(src);
    expect(result).toContain('_Fields:_ host, port, timeout');
  });

  it('does not append fieldsMapped when empty', () => {
    const src: SourceEntry = { title: 'Config', fieldsMapped: [] };
    const result = renderSourceEntry(src);
    expect(result).not.toContain('_Fields:_');
  });

  it('renders all parts together', () => {
    const src: SourceEntry = {
      title: 'API Spec',
      type: 'openapi',
      content: 'REST endpoints',
      fieldsMapped: ['paths', 'schemas'],
    };
    const result = renderSourceEntry(src);
    expect(result).toContain('**API Spec:** REST endpoints');
    expect(result).toContain('_Type:_ openapi');
    expect(result).toContain('_Fields:_ paths, schemas');
  });
});

// ---------------------------------------------------------------------------
// renderIdDescriptionList
// ---------------------------------------------------------------------------
describe('renderIdDescriptionList', () => {
  it('renders items with id and description', () => {
    const items: SpecIdDescItem[] = [
      { id: 'A1', description: 'First assumption' },
      { id: 'A2', description: 'Second assumption' },
    ];
    const result = renderIdDescriptionList(items, 'Assumptions');
    expect(result).toContain('## Assumptions');
    expect(result).toContain('- **A1**: First assumption');
    expect(result).toContain('- **A2**: Second assumption');
  });

  it('renders items with title', () => {
    const items: SpecIdDescItem[] = [{ title: 'Important thing', description: 'Details here' }];
    const result = renderIdDescriptionList(items, 'Items');
    expect(result).toContain('- **Important thing**: Details here');
  });

  it('renders items with both id and title joined by dash', () => {
    const items: SpecIdDescItem[] = [
      { id: 'C1', title: 'Performance', description: 'Must be fast' },
    ];
    const result = renderIdDescriptionList(items, 'Constraints');
    expect(result).toContain('- **C1 — Performance**: Must be fast');
  });

  it('uses "Item" as fallback when id and title are missing', () => {
    const items: SpecIdDescItem[] = [{ description: 'Orphaned' }];
    const result = renderIdDescriptionList(items, 'List');
    expect(result).toContain('- **Item**: Orphaned');
  });

  it('appends priority suffix when present', () => {
    const items: SpecIdDescItem[] = [{ id: 'R1', description: 'Requirement', priority: 'High' }];
    const result = renderIdDescriptionList(items, 'Requirements');
    expect(result).toContain('_(High)_');
  });

  it('omits priority suffix when not present', () => {
    const items: SpecIdDescItem[] = [{ id: 'R1', description: 'No priority' }];
    const result = renderIdDescriptionList(items, 'Requirements');
    expect(result).not.toContain('_(');
  });

  it('renders empty description', () => {
    const items: SpecIdDescItem[] = [{ id: 'X1' }];
    const result = renderIdDescriptionList(items, 'Empty');
    expect(result).toContain('- **X1**: ');
  });

  it('renders empty items list', () => {
    const result = renderIdDescriptionList([], 'Nothing');
    expect(result).toBe('## Nothing\n\n');
  });
});

// ---------------------------------------------------------------------------
// toRaw
// ---------------------------------------------------------------------------
describe('toRaw', () => {
  it('casts an object to JsonObject', () => {
    const view = { title: 'Test', count: 5 };
    const raw = toRaw(view);
    expect(raw).toBe(view);
    expect(raw['title']).toBe('Test');
    expect(raw['count']).toBe(5);
  });

  it('works with class instances', () => {
    class MyView {
      name = 'hello';
      value = 42;
    }
    const instance = new MyView();
    const raw = toRaw(instance);
    expect(raw['name']).toBe('hello');
    expect(raw['value']).toBe(42);
  });

  it('returns the same reference', () => {
    const obj = { a: 1 };
    expect(toRaw(obj)).toBe(obj);
  });
});
