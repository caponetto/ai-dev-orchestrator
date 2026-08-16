# Workflow Engine

The workflow engine lives in `packages/workflow/src/infrastructure/workflow-engine/`. Workflow parsing and validation live in `packages/workflow/src/infrastructure/workflow-dsl/`.

## Responsibilities

The current engine:

- loads a workflow definition
- evaluates guards and transitions
- dispatches entry actions
- coordinates `WAITING_FOR_HUMAN`
- persists state
- appends journal events
- produces a manifest and report near terminal completion

## Workflow Sources

The repository currently ships built-in workflows from `packages/config-templates/src/static/workflows/`.

Available names:

- `dev`
- `pr-review`
- `task-breakdown`

The CLI resolves the built-in workflow by name rather than loading a project-owned workflow from `.ai/`.

## Current Action Types

The workflow schema and runtime currently support entry actions including:

- `dispatch_worker`
- `dispatch_parallel_workers`
- `run_script` — executes a named script from `~/.ai/scripts/` (TypeScript via Node; other executables via shebang). Scripts may write `{"message":"..."}` to `$ORCHESTRATOR_SCRIPT_RESULT` for chat display.
- `notify_human`
- `generate_agreement`
- `produce_manifest`
- `record_journal`
- `store_artifact`

## Default Development Workflow

The built-in `dev` workflow contains these states:

1. `INTAKE`
2. `REFINEMENT`
3. `WAITING_FOR_HUMAN`
4. `CODEBASE_ANALYSIS`
5. `PLANNING`
6. `PLAN_REVIEW`
7. `IMPLEMENTATION`
8. `TEST_AUTHORING`
9. `CODE_REVIEW`
10. `REVIEW_SYNTHESIS`
11. `JUDGE_REVIEW`
12. `REMEDIATION_TRIAGE`
13. `TEST_EXECUTION`
14. `ACCEPTANCE_VALIDATION`
15. `WRAP_UP`
16. `DONE`
17. `FAILED`
18. `ABORTED`

`CODE_REVIEW` uses `dispatch_parallel_workers` for the built-in reviewer set. `WAITING_FOR_HUMAN` is reused for multiple human-interaction paths and routed by waiting context.

## PR Review Workflow

The `pr-review` workflow is a production-hardened review pipeline:

1. `SETUP` — Clone PR repository and check out the PR branch
2. `INTAKE` — Validate inputs, resolve structured source references, produce `canonical_specification`
3. `DIFF_COMPUTATION` — Compute diff between PR branch and base
4. `REVIEW_EXECUTION` — Parallel multi-perspective review
5. `REVIEW_SYNTHESIS` — Synthesize findings into unified `review_report`
6. `WRAP_UP` — Generate final `review_findings` report
7. `PUBLISH_FINDINGS` — Upload findings to a GitHub Gist via `run_script`
8. `CLEANUP` — Clean up temporary resources
9. `DONE` / `FAILED` / `ABORTED`

### Fail-closed semantics

- `iteration_exhausted` → `ABORTED` (prevents infinite review loops)
- `human_input` → `ABORTED` (explicit escalation when human intervention needed)
- `failure` → `ABORTED` (hard process failures, incomplete review sets)
- Required template variables throw `RequiredVariableMissingError` instead of silently defaulting to empty strings
- Review synthesis is blocked when required reviewer artifacts are missing

### Source resolution

The CLI intake router (`packages/cli/src/intake-router.ts`) parses typed source references:

- `github:owner/repo#123` — GitHub PR (optional `@base-branch`)
- `github-issue:owner/repo#456` — GitHub issue
- Plain text fallback for unrecognized formats

Parsed metadata flows into `rawFields` on `IntermediateRequirements` so downstream roles receive structured context.

## Key Runtime Files

See `packages/workflow/src/infrastructure/workflow-engine/` for the full set. Core files include:

- `lifecycle-controller.ts` — main workflow loop and state progression
- `action-dispatcher.ts` — entry action execution (dispatch, notify, store, etc.)
- `transition-evaluator.ts` — evaluates outgoing transitions from current state
- `guard-checker.ts` — guard condition evaluation
- `review-result-interpreter.ts` — interprets review artifacts into transition decisions
- `escalation-handler.ts` — escalation path handling
- `script-executor.ts` — `run_script` action execution
- `resolve-canonical-specification.ts` — specification assembly for downstream roles
- `post-run-context-updater.ts` — post-run project context updates
- `confidence-extractor.ts` — confidence score extraction from agent output

## Source of Truth

Prefer:

- `packages/workflow/src/infrastructure/workflow-engine/`
- `packages/workflow/src/infrastructure/workflow-dsl/`
- `packages/config-templates/src/static/workflows/dev.yaml`
- `packages/config-templates/src/static/workflows/pr-review.yaml`
- `packages/config-templates/src/static/workflows/task-breakdown.yaml`
