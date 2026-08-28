# AI Dev Orchestrator

[![CI](https://github.com/caponetto/ai-dev-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/caponetto/ai-dev-orchestrator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22-green.svg)](https://nodejs.org/)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

An orchestration platform for AI coding agents. You define the workflow, and the orchestrator runs it: dispatching agents to roles, enforcing governance gates, collecting artifacts, and recovering from failures. Everything runs locally.

## Why

AI coding agents work best with structure. Without it, they skip steps, ignore review feedback, and produce inconsistent results. This orchestrator gives them a finite state machine to follow, quality gates to pass, and a review loop that catches what they miss.

## Capabilities

**Deterministic workflows.** An 18-state FSM drives each run from intake to done. Fork/join for parallel workers. Governance gates between phases enforce iteration limits, quality thresholds, and required reviews.

**25 built-in roles.** Requirements Analyst, Planner, Implementer, seven specialized reviewers (static, security, performance, design, adversarial, docs, UX), Verifier, Judge, and more. Each role gets its own prompt template, model assignment, and artifact ownership.

**Agent runners.** Dispatches work through Claude Code, Cursor, and Codex CLIs, each with its own model roster. Failover chains switch runners automatically. Rate limiting with token buckets. Retry with exponential backoff.

**Artifact system.** Immutable, versioned, SHA-256 checksummed. 34 schema-validated types. A dependency graph tracks staleness and impact across artifacts.

**Recovery.** Atomic checkpoint writes. Append-only journal. State reconstruction from journal when a checkpoint corrupts. SIGTERM/SIGINT handling, crash recovery, lock protocol.

**Dashboard.** React UI for monitoring runs, browsing artifacts, inspecting findings, and viewing token usage per role.

## Quickstart

```bash
node --version  # >= 22
pnpm --version  # >= 11

pnpm install
pnpm link:cli
```

## CLI

```bash
ai dashboard             # Open web dashboard

ai init                  # Set up ~/.ai/ configuration
ai run <source>          # Start a workflow run
ai status [runId]        # Current state and progress
ai list                  # Past runs with status
ai inspect [runId]       # Detailed run information
ai artifacts [runId]     # Artifact inventory

ai resume [runId]        # Resume an interrupted run
ai retry <runId>         # Retry from failure state
ai abort [runId]         # Abort a running run
ai kill                  # Kill all active processes

ai approve [runId]       # Approve a human gate
ai answer [runId]        # Answer clarification questions
ai permit [runId]        # Grant/deny permission requests

ai validate              # Check config without running
ai config show           # Display merged configuration
ai version               # Version, commit SHA, build info
```

All commands accept `--json` for machine-readable output and `--verbose` for detail. `run`, `resume`, and `retry` also accept `--repo <path>`.

## Architecture

Hexagonal (ports & adapters) with strict layering enforced by Turborepo boundary tags. Lower layers cannot import from higher layers.

| Layer          | Packages                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation     | `schemas`, `utils`, `build-config`                                                                                                                                                                                                    |
| Contracts      | `ports`, `agent-protocol`, `test-utils`                                                                                                                                                                                               |
| Domain         | `artifacts`, `agent-adapters`, `code-intelligence`, `dependency-graph`, `execution-analytics`, `governance`, `journal`, `policy-engine`, `project-context`, `prompt-engine`, `role-system`, `run-manifest`, `runner`, `specification` |
| Infrastructure | `core`, `recovery`                                                                                                                                                                                                                    |
| Orchestration  | `workflow`                                                                                                                                                                                                                            |
| Application    | `config-templates`, `dashboard-server`, `dashboard`                                                                                                                                                                                   |
| Composition    | `cli`                                                                                                                                                                                                                                 |

27 packages in a pnpm/Turborepo monorepo. See [`docs/system-overview.md`](docs/system-overview.md) for the full breakdown.

## Development

| Command                   | What it does                         |
| ------------------------- | ------------------------------------ |
| `pnpm lint`               | ESLint across all packages           |
| `pnpm typecheck`          | TypeScript type checking             |
| `pnpm test:unit`          | Unit tests                           |
| `pnpm test:unit:coverage` | Tests with coverage report           |
| `pnpm build:prod`         | Production build                     |
| `pnpm build:dev`          | Development build (sourcemaps)       |
| `pnpm format`             | Prettier formatting                  |
| `pnpm format:check`       | Check formatting                     |
| `pnpm knip`               | Detect unused files, deps, exports   |
| `pnpm syncpack:check`     | Check dependency version consistency |
| `pnpm publint`            | Validate package.json exports        |

Pre-commit hooks run eleven checks: lint-staged (ESLint + Prettier), typecheck, lint, format, syncpack, build, publint, knip, unit tests with coverage, integration tests, and e2e tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow.

## Documentation

- [System Overview](docs/system-overview.md) — architecture, packages, runtime layout
- [Contributing Guide](CONTRIBUTING.md) — branch naming, commits, CI/CD, coding standards
- [Architecture Docs](docs/README.md) — full specification index

## License

[MIT](LICENSE)
