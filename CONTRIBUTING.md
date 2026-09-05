# Contributing to AI Dev Orchestrator

## Getting Started

1. Fork and clone the repository.
2. Install dependencies: `pnpm install`
3. Run checks: `pnpm lint && pnpm typecheck && pnpm test:unit`

## Development Workflow

This project follows the engineering governance defined in the repository documentation under [`docs/`](docs/README.md).

### Branch Naming

Use the format `<type>/<description>`:

- `feature/artifact-store`
- `fix/checksum-validation`
- `refactor/runner-lifecycle`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

Scope: subsystem name in kebab-case (e.g., `feat(artifact-system): add checksum verification`)

### Pull Requests

- One PR per subsystem or feature.
- All CI checks must pass before merge.
- Squash merge to `main`.

### Pre-commit Hooks

The project uses Husky with lint-staged. On every commit:

- ESLint and Prettier run on staged files via lint-staged
- `pnpm typecheck` runs TypeScript type checking
- `pnpm lint` runs ESLint across all packages
- `pnpm format:check` verifies formatting
- `pnpm syncpack:check` verifies dependency version consistency
- `pnpm build:prod` runs production build
- `pnpm publint` validates package.json exports
- `pnpm knip` detects unused files, dependencies, and exports
- `pnpm test:unit:coverage` runs unit tests with coverage
- `pnpm test:integration` runs integration tests
- `pnpm test:e2e` runs end-to-end tests

Commit messages are validated by [commitlint](https://commitlint.js.org/) via a `commit-msg` hook, enforcing the Conventional Commits format described above.

### Versioning

This project uses [Release Please](https://github.com/googleapis/release-please) for automated versioning. No manual steps are required — on merge to `main`, release-please reads conventional commit prefixes (`feat:` → minor, `fix:` → patch, `feat!:` / `BREAKING CHANGE` → major) and opens a release PR with version bumps and changelogs. Merging the release PR publishes the packages.

## Coding Standards

- TypeScript strict mode
- ESM modules (Node.js 22+)
- Hexagonal architecture layers (domain, infrastructure)
- No `any` types without justification
- No `console.log` — use `createLogger` from `@ai-orchestrator/core`

### Architecture Layers

| Layer          | Directory             | Rules                                               |
| -------------- | --------------------- | --------------------------------------------------- |
| Domain         | `src/domain/`         | Pure types and errors. No I/O, no external imports. |
| Infrastructure | `src/infrastructure/` | Adapter implementations. May import domain types.   |

### Required Configuration Files

`ai init` generates these files inside `.ai/`:

- `config.yaml`
- `roles.yaml`
- `governance.yaml`
- `runners.yaml`

### CLI Command Pattern

All CLI commands follow the signature:

```typescript
function commandFn(
  repoRoot: string,
  options: Options,
  formatter: OutputFormatter,
): Promise<ExitCode>;
```

- `repoRoot` — project root (usually `process.cwd()`)
- `options` — parsed command flags
- `formatter` — handles JSON/text/color output modes

## Architecture

The architecture specification is frozen at v1.0. Any change that modifies a TypeScript interface, adds/removes an FSM state, changes an artifact type, or alters a role contract requires an ADR.

## Project Structure

```
packages/
├── schemas/            # Shared Zod schemas and types
├── utils/              # Shared utilities (error handling, YAML, timing)
├── build-config/       # Shared vitest and build configuration
├── ports/              # Port interfaces (contracts between layers)
├── artifacts/          # Artifact system, ownership, agreements
├── agent-protocol/     # Agent-orchestrator protocol messages
├── agent-adapters/     # CLI adapters for Claude Code, Cursor, Codex, gh-cli
├── dependency-graph/   # Artifact dependency graph, impact analysis
├── execution-analytics/ # Adaptive execution loop, statistical profiling
├── governance/         # Governance engine, iteration contracts
├── journal/            # Journal writer/reader, event formatting
├── policy-engine/      # Policy evaluation (iteration, quality, budget)
├── project-context/    # Persistent project context across runs
├── prompt-engine/      # Template engine, token budget, context assembly
├── recovery/           # Recovery manager, state reconstruction
├── role-system/        # Role registry, model assignment
├── run-manifest/       # Manifest production, report rendering
├── runner/             # Agent dispatch, sessions, transport
├── specification/      # Specification validation and merging
├── core/               # Configuration, events, state, logging
├── workflow/           # Lifecycle controller, workflow DSL
├── config-templates/   # Init generators and static files
├── dashboard-server/   # HTTP server, metrics, diagnostics
├── dashboard/          # React web UI (SPA)
├── cli/                # Command-line interface (composition root)
└── test-utils/         # Test fixtures and mock implementations
```

## CI/CD

- **On push/PR** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): `quality` (formatting, boundaries, typecheck, syncpack, build, lint, publint, knip — all checks run via `continue-on-error` to surface every failure), `test` (unit tests with coverage, integration tests — runs after quality), `e2e` (Playwright — runs after test)
- **On merge to main** ([`.github/workflows/release.yml`](.github/workflows/release.yml)): release-please opens a version PR from conventional commits; merging it publishes packages
- **Dependency updates**: Dependabot opens weekly PRs for npm and GitHub Actions ([`.github/dependabot.yml`](.github/dependabot.yml))
