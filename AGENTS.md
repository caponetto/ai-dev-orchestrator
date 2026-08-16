# Agent Instructions

This file provides repository-level guidance for AI coding agents working in the `ai-dev-orchestrator` codebase.

## Project Identity

A local-first AI software engineering platform that orchestrates autonomous coding agents through a deterministic, artifact-driven workflow. Built as a pnpm/Turborepo monorepo with strict TypeScript.

## Tech Stack

| Technology     | Version / Config                                                 |
| -------------- | ---------------------------------------------------------------- |
| TypeScript     | ^5.9, strict mode, ES2022 target, Bundler module resolution      |
| Node.js        | >= 22                                                            |
| pnpm           | 11.x (workspace monorepo)                                        |
| Turborepo      | ^2.10 (task orchestration)                                       |
| Vitest         | Unit and integration tests                                       |
| ESLint         | ^9.x with typescript-eslint strictTypeChecked                    |
| Prettier       | printWidth 100, singleQuote, trailingComma all, semi, tabWidth 2 |
| Zod            | Schema validation                                                |
| Husky          | Pre-commit hooks (lint-staged, typecheck, lint, format, tests)   |
| Commitlint     | Conventional commit message enforcement                          |
| Release Please | Automated versioning and changelog from conventional commits     |
| Knip           | Dead code detection (unused files, deps, exports)                |
| Syncpack       | Dependency version consistency across packages                   |
| Publint        | Package.json exports validation                                  |

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm lint             # ESLint across all packages
pnpm typecheck        # TypeScript type checking
pnpm test:unit        # Unit tests
pnpm test:unit:coverage  # Tests with coverage
pnpm build:prod       # Production build
pnpm build:dev        # Development build (sourcemaps)
pnpm clean            # Remove all dist/ and tsbuildinfo across packages
pnpm format           # Format with Prettier
pnpm format:check     # Check formatting
pnpm knip             # Detect unused files, deps, exports
pnpm syncpack:check   # Check dependency version consistency
pnpm publint          # Validate package.json exports
```

## Monorepo Layout

All workspace packages live under `packages/`, scoped as `@ai-orchestrator/<name>`:

| Package               | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `schemas`             | Shared Zod schemas and types (foundation)           |
| `utils`               | Shared utilities (error handling, YAML, timing)     |
| `ports`               | Port interfaces (contracts between layers)          |
| `artifacts`           | Artifact system, ownership, agreements              |
| `agent-protocol`      | Agent-orchestrator protocol messages                |
| `agent-adapters`      | CLI adapters for Claude Code, Cursor, gh-cli        |
| `code-intelligence`   | SCIP-powered code context for symbol-level analysis |
| `dependency-graph`    | Artifact dependency graph, impact analysis          |
| `execution-analytics` | Adaptive execution loop, statistical profiling      |
| `governance`          | Governance engine, iteration contracts              |
| `journal`             | Journal writer/reader, event formatting             |
| `policy-engine`       | Policy evaluation (iteration, quality, budget)      |
| `project-context`     | Persistent project context across runs              |
| `prompt-engine`       | Template engine, token budget, context assembly     |
| `recovery`            | Recovery manager, state reconstruction              |
| `role-system`         | Role registry, model assignment                     |
| `run-manifest`        | Manifest production, report rendering               |
| `runner`              | Agent dispatch, sessions, transport                 |
| `specification`       | Specification validation and merging                |
| `core`                | Configuration, events, state, logging               |
| `workflow`            | Lifecycle controller, workflow DSL                  |
| `config-templates`    | Init generators and static files                    |
| `dashboard-server`    | HTTP server, metrics, diagnostics                   |
| `dashboard`           | React + Vite web UI (SPA)                           |
| `cli`                 | Command-line interface (composition root)           |
| `build-config`        | Shared vitest and build configuration               |
| `test-utils`          | Test fixtures and mock implementations              |

Architecture follows hexagonal (ports & adapters) with strict layering enforced by Turborepo boundaries. Lower layers cannot depend on higher layers. See the architecture table in [README.md](README.md#architecture) for the full layer hierarchy.

## Coding Conventions

- **File naming:** kebab-case for all source and test files.
- **Imports:** `import type` enforced by `@typescript-eslint/consistent-type-imports`. Import order enforced by `eslint-plugin-import-x` (builtin, external, internal, parent, sibling, index — alphabetized, blank lines between groups).
- **No `any`:** `no-explicit-any` is an error. Prefix unused variables with `_`.
- **No `console.log`:** Use `createLogger` from `@ai-orchestrator/core`.
- **Exports:** Named exports via barrel `index.ts` files per module.
- **Dependencies:** Workspace packages reference each other via `"@ai-orchestrator/<name>": "workspace:*"`.

## Module Structure

Most packages (artifacts, runner, governance, core, workflow) follow a bounded-context layout. Packages like `schemas`, `ports`, `cli`, `dashboard`, and `config-templates` use different structures suited to their role:

```
packages/<name>/src/
├── domain/<context>/
│   ├── errors.ts          # Error classes extending NonRecoverableErrorBase
│   ├── index.ts           # Barrel re-exports
│   └── __tests__/         # Co-located unit tests
├── infrastructure/<context>/
│   ├── <implementation>.ts
│   ├── index.ts
│   └── __tests__/
└── index.ts               # Package-level barrel
```

Tests use Vitest with `describe`/`it`/`expect` imported by name. Test files are named `<unit>.test.ts` inside `__tests__/` directories beside the source. Property-based tests use `fast-check` and are named `*.property.test.ts`.

## Testing Requirements

All code changes must include corresponding tests. New features require tests covering the primary functionality. Bug fixes require regression tests that reproduce the original issue. Refactors must maintain or improve existing test coverage. Run `pnpm test:unit` before committing to verify nothing is broken.

## Documentation Requirements

When a code change affects documented behavior, update the relevant docs in the same change. Check `docs/`, `README.md`, `CONTRIBUTING.md`, and this file for references to renamed files, moved packages, changed CLI flags, added/removed workflow states, or modified interfaces. The code is the source of truth; docs that contradict it are bugs.

## Commit and Branch Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`. Branch naming: `<type>/<description>`. See [CONTRIBUTING.md](CONTRIBUTING.md) for full details.

## Further Reading

- [README.md](README.md) — quickstart, CLI usage, project overview
- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow, coding standards, PR process
- [docs/](docs/README.md) — subsystem docs and guides
