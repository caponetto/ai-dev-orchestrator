const USAGE_REFRESH_EVENTS = new Set(['state_changed', 'worker_completed', 'run_completed']);

export function shouldRefreshUsage(eventType: string): boolean {
  return USAGE_REFRESH_EVENTS.has(eventType);
}

const HEALTH_REFRESH_EVENTS = new Set([
  'health_changed',
  'run_started',
  'run_completed',
  'run_aborted',
]);

export function shouldRefreshHealth(eventType: string): boolean {
  return HEALTH_REFRESH_EVENTS.has(eventType);
}

const RUNS_REFRESH_EVENTS = new Set([
  'state_changed',
  'run_started',
  'run_completed',
  'run_aborted',
  'worker_completed',
]);

export function shouldRefreshRuns(eventType: string): boolean {
  return RUNS_REFRESH_EVENTS.has(eventType);
}
