import { describe, expect, it } from 'vitest';

import { StateHistory } from '../state-history';

describe('StateHistory', () => {
  it('starts empty by default', () => {
    const history = new StateHistory();
    expect(history.getHistory()).toEqual([]);
  });

  it('restores from initial state', () => {
    const history = new StateHistory(['INTAKE', 'PLANNING']);
    expect(history.getHistory()).toEqual(['INTAKE', 'PLANNING']);
    expect(history.hasVisited('INTAKE')).toBe(true);
  });

  it('records and queries states', () => {
    const history = new StateHistory();
    history.record('INTAKE');
    history.record('PLANNING');
    expect(history.hasVisited('INTAKE')).toBe(true);
    expect(history.hasVisited('PLANNING')).toBe(true);
    expect(history.hasVisited('DONE')).toBe(false);
  });

  it('counts visits to a state', () => {
    const history = new StateHistory();
    history.record('IMPLEMENTATION');
    history.record('CODE_REVIEW');
    history.record('IMPLEMENTATION');
    expect(history.visitCount('IMPLEMENTATION')).toBe(2);
    expect(history.visitCount('CODE_REVIEW')).toBe(1);
    expect(history.visitCount('DONE')).toBe(0);
  });

  it('returns a copy of history', () => {
    const history = new StateHistory();
    history.record('INTAKE');
    const copy = history.getHistory();
    expect(copy).toEqual(['INTAKE']);
  });
});
