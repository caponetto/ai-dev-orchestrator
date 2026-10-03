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

The project uses Husky with lint-staged. The hook inspects the staged file list and picks one of two tiers.

**Tier 1 — docs and CI only.** When every staged path is documentation or CI/editor metadata (any `.md` file, `docs/`, `.github/`, `.husky/`, `.vscode/`, `LICENSE`, `.gitignore`, `.editorconfig`, `.gitattributes`), the hook runs:

- ESLint and Prettier on staged files via lint-staged
- `pnpm format:check` for a repo-wide formatting sweep

These paths cannot affect the TypeScript program, the package graph, or the test suites, and CI still runs the full gate on the push. Note that a package source tree is never treated as inert: `packages/*/src/**` is always tier 2, because data files there are real build inputs (`packages/config-templates/src/static/**` holds prompt templates, role definitions, and workflow YAML that are read at runtime, copied into `dist` by `copy:static`, and schema-validated by unit tests).

**Tier 2 — code changes.** If any staged path falls outside that list, the hook runs the full gate:

- ESLint and Prettier run on staged files via lint-staged
- `pnpm typecheck` runs TypeScript type checking
- `pnpm lint` runs ESLint across all packages
- `pnpm format:check` verifies formatting
- `pnpm syncpack:check` verifies dependency version consistency
- `pnpm build:prod` runs production build
- `pnpm publint` validates package.json exports
- `pnpm knip` detects unused files, dependencies, and exports
- `pnpm test:unit:coverage` runs unit tests with coverage
- `pnpm test:scripts` runs the tests for the `scripts/` tooling
- `pnpm test:integration:coverage` runs integration tests with coverage into `packages/<name>/coverage-integration/`
- `pnpm coverage:merge` unions every package's Vitest blob reports into `coverage/lcov.info` for Codecov, using `vitest --merge-reports` (see [Coverage reporting](#coverage-reporting))
- `pnpm test:integration` runs integration tests
- `pnpm test:e2e` runs end-to-end tests
- `pnpm test:results:merge` merges the JUnit reports into `test-results/junit.xml` for Codecov Test Analytics (requires `CI=true`, which is what turns the reporter on). Pass `--suites=unit,integration,scripts` or `--suites=e2e` to merge a subset; no flag merges all four kinds.

To widen or narrow the tier-1 allowlist, edit `NON_CODE_PATTERN` and `SOURCE_TREE_PATTERN` in [`.husky/pre-commit`](.husky/pre-commit). Config files that gate the toolchain — `package.json`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig*.json`, `.npmrc`, `.nvmrc`, `.prettierignore`, `.prettierrc`, `eslint.config.js` — are deliberately not on the allowlist, so editing them always runs the full gate.

Commit messages are validated by [commitlint](https://commitlint.js.org/) via a `commit-msg` hook, enforcing the Conventional Commits format described above.

### Versioning

This project uses [Release Please](https://github.com/googleapis/release-please) for automated versioning. No manual steps are required — on merge to `main`, release-please reads conventional commit prefixes (`feat:` → minor, `fix:` → patch, `feat!:` / `BREAKING CHANGE` → major) and opens a release PR with version bumps and changelogs. Merging the release PR publishes the packages.

## Coding Standards

- TypeScript strict mode
- ESM modules (Node.js 22+)
- Hexagonal architecture layers (domain, infrastructure)
- No `any` types without justification
- No `console.log` — use `createLogger` from `@ai-dev-orchestrator/core`

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
├── agent-adapters/     # CLI adapters for Claude Code, Cursor, Codex, OpenCode, gh-cli
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

- **On push/PR** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): package-level Turbo checks use `*` for shared/root changes, or changed packages plus their downstream dependents for package changes. Repository-level script, boundary, and unused-code checks also run on code changes; Syncpack, Publint, and the dependency audit run for shared/root or package-manifest changes. The dashboard E2E suite runs for every code change. Docs-only changes skip CI checks.
- **On merge to main** ([`.github/workflows/release.yml`](.github/workflows/release.yml)): release-please opens a version PR from conventional commits; merging it publishes packages
- **Dependency updates**: Dependabot opens weekly PRs for npm and GitHub Actions ([`.github/dependabot.yml`](.github/dependabot.yml))

### Coverage reporting

Each package runs Vitest with the v8 provider. When `CI=true`, every run also emits a **blob** report to `packages/<name>/.vitest-reports/<package>-<unit|integration>.json`, which embeds that run's coverage map. `pnpm coverage:merge` flattens those into a single `.vitest-reports/` directory and runs `vitest --merge-reports`, which unions them via `istanbul-lib-coverage` and writes the repo-relative `coverage/lcov.info` that Codecov consumes.

Do not hand-roll this merge. `CoverageMap.merge()` already handles the parts that are easy to get subtly wrong: it keys coverage on **absolute** paths, so two packages each having `src/index.ts` cannot collide; a file appears once; and line, function, and branch hit counts are summed rather than overwritten, which is what stops a branch from being reported as untaken just because the other suite skipped it. Only the lcov writer relativises paths, and only relative to its config's directory — which is why `vitest.merge.config.ts` must stay at the repository root.

Two consequences worth knowing:

- `vitest --merge-reports` reads one **flat** directory of files and throws on any subdirectory, so `coverage:merge` copies the per-package blobs together first. Filenames are prefixed with the package name because the packages would otherwise all write `unit.json`.
- Vitest also walks its normal test-collection path during the merge and finds nothing, so `vitest.merge.config.ts` sets `passWithNoTests: true`. Without it the command exits 1 _after_ writing a correct report.

The per-package `coverage/lcov.info` and `coverage-integration/lcov.info` files are still written, but only for local inspection — nothing reads them, and the Codecov report comes from the blobs.

- Locally: `pnpm test:unit:coverage:ci` runs unit tests with coverage, integration tests with coverage, then merges. It needs `CI=true`, because the blob reporter is gated on it.
- In CI: the `test` job runs `test:unit:coverage`, `test:scripts:coverage`, and `test:integration:coverage` as separate steps, then `pnpm coverage:merge` once both report sets exist, then uploads `coverage/lcov.info` via `codecov/codecov-action@v7` with `disable_search: true` so the per-package reports are not uploaded separately
- The merge and both uploads are guarded by `if: ${{ !cancelled() }}`, so a failing suite still uploads its coverage and results
- Project and patch targets live in [`codecov.yml`](codecov.yml)

Set a `CODECOV_TOKEN` repository secret (Settings → Secrets and variables → Actions). It is required for private repos and recommended everywhere, since tokenless uploads are rate-limited. Without it the upload step fails because `fail_ci_if_error: true`.

### Repo tooling (`scripts/`)

`scripts/` holds repository-level tooling that is not part of any published package: `merge-test-results.ts` (merges per-package JUnit reports). It sits outside `packages/*`, so it gets no per-package coverage config, but it is wired into the repo-level gates through `//#`-prefixed Turbo tasks (`test:scripts:run`, `lint:scripts:run`, `typecheck:scripts:run`, `knip:run`). `pnpm lint`, `pnpm typecheck`, and `pnpm knip` each run `turbo` **and then** the matching root task — plain `turbo lint` covers only workspace packages and would otherwise skip `scripts/` entirely. Coverage merging deliberately has no script here — see [Coverage reporting](#coverage-reporting) for why `vitest --merge-reports` is used instead.

Each script is a CLI entrypoint that also exports its helpers, so it can be unit tested:

- Path and output targets are parameters of `main(root, ...)` rather than module constants, so tests can point it at a temp directory instead of the working tree
- The `main()` call is guarded by an `import.meta.url` check, so importing the module has no side effects
- Tests live in `scripts/__tests__/` and run via `vitest.scripts.config.ts`

`pnpm test:scripts` runs them; it is wired into the pre-commit gate, the `test` CI job, and the 80% coverage thresholds via `coverage-scripts/`. Its JUnit report is merged into Test Analytics like every other suite, but its _coverage_ is not — `codecov.yml` ignores `scripts/**`, since `scripts/` is tooling rather than product code.

### Test analytics

Coverage answers "which lines are untested"; Test Analytics answers "which tests are slow or flaky". It needs JUnit XML rather than `lcov`, and the same repo-root path problem applies, so the flow mirrors coverage reporting.

- `createBaseTestConfig()` in [`packages/build-config`](packages/build-config/src/index.ts) appends a `junit` reporter when `CI=true`. It is additive, so `default` and the GitHub Actions reporter still run. `CI` is listed in `globalEnv` in [`turbo.json`](turbo.json), which makes the toggle part of the cache key — otherwise a cached run could replay without the report.
- Vitest writes `packages/<name>/test-report.unit.junit.xml`, plus `test-report.integration.junit.xml` for the three `integrationOnly` configs. `vitest.scripts.config.ts` writes a fourth report, `test-report.scripts.junit.xml`, at the repository root — without it the `scripts/` suite is invisible to Test Analytics, because the merger only discovers reports under `packages/`. Playwright writes `packages/dashboard/test-results/junit.xml` with `includeRetries: true` so flaky tests are visible instead of reported as plain passes.
- Playwright names its suites `relative(rootDir, file)`, and since v1.63 `rootDir` is the `testDir`, so a spec arrives as a bare `health.e2e.ts`. `scripts/merge-test-results.ts` restores the directory in `withSuiteDir()` as it merges. This happens at merge time rather than in a custom Playwright reporter on purpose: `playwright.config.ts` accepts only `[name, arg]` tuples, so passing a reporter instance throws at config load, and a named custom reporter would have to be resolved by module path and would then depend on `onEnd` ordering.
- `scripts/merge-test-results.ts` concatenates the `<testsuite>` elements, rewrites each `name`/`classname` to `packages/<name>/…`, drops the `hostname` attribute (it carries the runner's machine name), and sums the counters into `test-results/junit.xml`. Root-level reports are collected with an empty prefix, since `scripts/` suite names are already repository-relative.
- Pass `--suites=unit,integration,scripts` or `--suites=e2e` to merge a subset. The `test` and `e2e` CI jobs upload separately, and the filter stops the `e2e` job from re-reporting the unit tests that turbo restores from cache.
- Both jobs upload with `report_type: test_results`, each under its own Codecov `flags` value (`vitest` and `playwright`) so the two reports are distinguishable rather than merged into one untagged stream. The `if: ${{ !cancelled() }}` guard is what makes results show up on failing runs, which is when flakiness is most useful.

> Codecov's Test Analytics quick-start still shows `codecov/test-results-action@v1`. That action is deprecated — it is superseded by `codecov/codecov-action` with `report_type: test_results`, which is what this repo uses.
