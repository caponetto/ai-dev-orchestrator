# System Overview

This document summarizes the system that is implemented in the repository today.

## What the Project Is

AI Dev Orchestrator is a local-first orchestration system for software-development workflows. It loads global configuration from `~/.ai/`, executes a built-in workflow, stores run state on disk, and exposes both a CLI and a local dashboard for operators.

## Package Layout

The monorepo has twenty-seven packages:

| Layer          | Package               | Responsibility                                                   |
| -------------- | --------------------- | ---------------------------------------------------------------- |
| Foundation     | `schemas`             | Shared Zod schemas and TypeScript types                          |
| Foundation     | `utils`               | Shared utilities (error handling, YAML, hashing, timing)         |
| Foundation     | `build-config`        | Shared vitest and build configuration                            |
| Contracts      | `ports`               | Port interfaces and cross-layer contracts                        |
| Contracts      | `test-utils`          | Test fixtures and mock port implementations                      |
| Domain         | `artifacts`           | Artifact system, ownership, agreements                           |
| Contracts      | `agent-protocol`      | Agent-orchestrator protocol messages                             |
| Domain         | `agent-adapters`      | CLI adapters for Claude Code, Cursor, gh-cli                     |
| Domain         | `code-intelligence`   | SCIP-powered code context for symbol-level analysis              |
| Domain         | `dependency-graph`    | Artifact dependency graph, impact analysis, staleness detection  |
| Domain         | `execution-analytics` | Adaptive execution loop, statistical profiling, config tuning    |
| Domain         | `governance`          | Governance engine, iteration contracts, collaboration model      |
| Domain         | `journal`             | Journal writer/reader, event formatting                          |
| Domain         | `policy-engine`       | Policy evaluation (iteration limits, quality gates, budget)      |
| Domain         | `project-context`     | Persistent project context across runs                           |
| Domain         | `prompt-engine`       | Template engine, token budget management, context assembly       |
| Infrastructure | `recovery`            | Recovery manager, shutdown coordination, state reconstruction    |
| Domain         | `role-system`         | Role registry, model assignment, contract validation             |
| Domain         | `run-manifest`        | Manifest production, report rendering                            |
| Domain         | `runner`              | Agent dispatch, sessions, protocol transport                     |
| Domain         | `specification`       | Specification validation and merging                             |
| Infrastructure | `core`                | Config loading, repository discovery, state persistence, logging |
| Orchestration  | `workflow`            | Lifecycle controller, workflow DSL                               |
| Application    | `config-templates`    | Built-in workflows, roles, templates, static config generators   |
| Application    | `dashboard-server`    | Dashboard HTTP API, projections, settings, metrics, diagnostics  |
| Application    | `dashboard`           | React dashboard UI                                               |
| Composition    | `cli`                 | `ai` command, composition root, dashboard launch                 |

## Project-Local Runtime Layout

The orchestrator stores configuration and runtime data under the global `~/.ai/` directory.

```text
~/.ai/
  config.yaml
  roles.yaml
  governance.yaml
  runners.yaml
  templates/
    <role-id>.md
  scripts/
  runs/
    <run-id>/
      artifacts/
      config-snapshot.json
      inventory.yaml
      journal.md
      live-requests/
      live-responses/
      manifest.yaml
      report.md
      run.lock
      sessions/
      state.yaml
      workflow-definition.json
```

Not every run directory contains every optional file immediately, but those are the main artifacts written by the current implementation.

## Built-In Workflows

Built-in workflows ship from `packages/config-templates/src/static/workflows/`.

Current names:

- `dev`
- `pr-review`
- `task-breakdown`

The default `dev` workflow includes these states:

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

`WAITING_FOR_HUMAN` is a shared wait state reused for approvals, rejections, clarifications, and escalation handling.

## Main Operator Surfaces

- The CLI in `packages/cli` initializes config, starts runs, resumes runs, exposes human-gate commands, and launches the dashboard.
- The dashboard combines `packages/dashboard-server` and `packages/dashboard` to show run history, run details, workflow graphs, artifacts, findings, live requests, sessions, and project settings.

## Source of Truth

When this document drifts, prefer:

- `packages/cli/src/index.ts`
- `packages/cli/src/composition-root.ts`
- `packages/config-templates/src/static/workflows/`
- `packages/core/src/infrastructure/`
- `packages/workflow/src/infrastructure/`
