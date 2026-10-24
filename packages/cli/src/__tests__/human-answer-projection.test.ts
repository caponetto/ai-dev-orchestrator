import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PersistedState } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectHumanAnswer } from '../human-answer-projection';

vi.mock('node:fs', async (load) => ({
  ...(await load<object>()),
  renameSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
}));
const real = await vi.importActual<typeof fs>('node:fs');
let root: string;
let path: string;
const answer = {
  content: 'accepted',
  stateId: 'WAIT',
  requestingState: 'WORK',
  waitingSince: 'wait-1',
};
const state = { lastHumanAnswer: answer } as PersistedState;
beforeEach(() => {
  root = real.mkdtempSync(join(tmpdir(), 'answer-projection-'));
  path = join(root, 'artifacts', 'clarification_answers_v1.md');
  vi.mocked(fs.renameSync).mockImplementation(real.renameSync);
  vi.mocked(fs.writeFileSync).mockImplementation(real.writeFileSync);
  vi.mocked(fs.rmSync).mockImplementation(real.rmSync);
});
afterEach(() => {
  vi.resetAllMocks();
  real.rmSync(root, { recursive: true, force: true });
});
describe('accepted human answer projection', () => {
  it('removes abandoned projection temporaries while preserving unrelated files', () => {
    real.mkdirSync(join(root, 'artifacts'));
    const orphan = `${path}.12345678-1234-1234-1234-123456789abc.tmp`;
    real.writeFileSync(orphan, 'partial');
    real.writeFileSync(join(root, 'artifacts', 'keep.tmp'), 'keep');
    projectHumanAnswer(root, state);
    expect(real.existsSync(orphan)).toBe(false);
    expect(real.readFileSync(join(root, 'artifacts', 'keep.tmp'), 'utf8')).toBe('keep');
    expect(real.readFileSync(path, 'utf8')).toBe('accepted');
  });
  it.each([null, {} as PersistedState])(
    'does not create files without an accepted receipt (%s)',
    (checkpoint) => {
      projectHumanAnswer(root, checkpoint);
      expect(real.readdirSync(root)).toEqual([]);
    },
  );
  it('keeps the previous answer readable until atomic publication and leaves no temporary file', () => {
    real.mkdirSync(join(root, 'artifacts'));
    real.writeFileSync(path, 'previous');
    vi.mocked(fs.renameSync).mockImplementationOnce((from, to) => {
      expect(real.readFileSync(path, 'utf8')).toBe('previous');
      expect(real.readFileSync(from, 'utf8')).toBe('accepted');
      real.renameSync(from, to);
    });
    projectHumanAnswer(root, state);
    expect(real.readFileSync(path, 'utf8')).toBe('accepted');
    expect(real.readdirSync(join(root, 'artifacts'))).toEqual(['clarification_answers_v1.md']);
  });
  it.each(['write', 'rename'])(
    'preserves the old answer and cleans temporary files after %s failure',
    (boundary) => {
      real.mkdirSync(join(root, 'artifacts'));
      real.writeFileSync(path, 'previous');
      const failed = () => {
        throw new Error('projection failed');
      };
      if (boundary === 'write') {
        vi.mocked(fs.writeFileSync).mockImplementationOnce(failed);
      } else {
        vi.mocked(fs.renameSync).mockImplementationOnce(failed);
      }
      expect(() => {
        projectHumanAnswer(root, state);
      }).toThrow('projection failed');
      expect(real.readFileSync(path, 'utf8')).toBe('previous');
      expect(real.readdirSync(join(root, 'artifacts'))).toEqual(['clarification_answers_v1.md']);
    },
  );
  it('does not report a committed projection as failed when temporary cleanup throws', () => {
    vi.mocked(fs.rmSync).mockImplementationOnce(() => {
      throw new Error('cleanup failed');
    });
    projectHumanAnswer(root, state);
    expect(real.readFileSync(path, 'utf8')).toBe('accepted');
  });
});
