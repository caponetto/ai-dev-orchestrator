# Adding a New Package

This guide walks through every file and location that must be created or updated when adding a new workspace package to the monorepo.

## 1. Create the Package Directory

```
packages/<name>/
├── src/
│   ├── domain/           # Domain types, errors, constants
│   │   ├── __tests__/
│   │   └── index.ts      # Barrel exports
│   ├── infrastructure/   # Implementations
│   │   ├── __tests__/
│   │   └── index.ts      # Barrel exports
│   └── index.ts           # Package-level barrel
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── turbo.json
└── vitest.config.ts
```

Not every package uses the `domain/infrastructure` split. Simple packages (e.g. `schemas`, `utils`) can use a flat `src/` layout. Follow whatever structure fits the package's role.

## 2. package.json

Use `@ai-orchestrator/<name>` as the package name. Reference workspace dependencies with `"workspace:*"`.

```json
{
  "name": "@ai-orchestrator/<name>",
  "version": "1.0.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/caponetto/ai-dev-orchestrator.git",
    "directory": "packages/<name>"
  },
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "clean": "rimraf dist tsconfig.build.tsbuildinfo",
    "build:base": "rimraf dist tsconfig.build.tsbuildinfo && tsc -p tsconfig.build.json",
    "build:dev": "pnpm run build:base",
    "build:prod": "pnpm run build:base --sourceMap false --declarationMap false",
    "lint": "eslint src/",
    "test:unit": "vitest run",
    "typecheck": "tsc -p tsconfig.build.json --noEmit"
  },
  "dependencies": {
    "@ai-orchestrator/schemas": "workspace:*"
  },
  "devDependencies": {
    "@ai-orchestrator/build-config": "workspace:*",
    "vitest": "^4.1.10"
  }
}
```

Adjust `dependencies` to include only the workspace packages you actually import. Always include `build-config` and `vitest` in `devDependencies`.

## 3. tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/"]
}
```

## 4. tsconfig.build.json

Extends the local tsconfig and excludes test files from the build output.

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

## 5. turbo.json

Assigns the package to an architecture layer via Turborepo boundary tags. The root `turbo.json` enforces that lower layers cannot depend on higher layers.

```json
{
  "extends": ["//"],
  "tags": ["<layer>"]
}
```

Valid layer tags (from lowest to highest): `foundation`, `contracts`, `domain`, `infrastructure`, `orchestration`, `application`, `composition`.

Choose the tag that matches the package's role:

| Tag              | When to use                                        |
| ---------------- | -------------------------------------------------- |
| `foundation`     | Shared schemas, utilities, build tooling           |
| `contracts`      | Port interfaces, test utilities                    |
| `domain`         | Business logic packages (most packages)            |
| `infrastructure` | Cross-cutting infrastructure (e.g. `core`)         |
| `orchestration`  | Workflow engine                                    |
| `application`    | User-facing servers, dashboards, config generators |
| `composition`    | CLI / composition root                             |

## 6. vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';
import { createBaseTestConfig } from '@ai-orchestrator/build-config';

export default defineConfig(createBaseTestConfig({ useAliases: true }));
```

## 7. Barrel Exports

Every module directory needs an `index.ts` that re-exports its public API. The package root `src/index.ts` re-exports from subdirectories:

```ts
export * from './domain';
export * from './infrastructure';
```

## 8. Install Dependencies

Run `pnpm install` from the repo root after creating the package. pnpm auto-discovers the new workspace package.

## 9. Checklist of Places to Update

These files contain package lists that must include the new package:

| File                            | What to update                                      |
| ------------------------------- | --------------------------------------------------- |
| `AGENTS.md`                     | Add row to the Monorepo Layout table                |
| `README.md`                     | Add to Architecture layer table; bump package count |
| `docs/system-overview.md`       | Add row to Package Layout table; bump package count |
| `CONTRIBUTING.md`               | Add line to the Project Structure tree              |
| `release-please-config.json`    | Add package entry with `component` name             |
| `.release-please-manifest.json` | Add package entry with initial version (`1.0.0`)    |

`CLAUDE.md` is a symlink to `AGENTS.md`, so editing `AGENTS.md` covers both.

## 10. Wire Into Consumers

If other packages or the composition root need the new package:

1. Add `"@ai-orchestrator/<name>": "workspace:*"` to the consumer's `package.json` dependencies.
2. If the package implements a port interface, create the port type in `packages/ports/src/contracts/` and export it from `packages/ports/src/contracts/index.ts`.
3. Wire it into `packages/cli/src/composition-root.ts` where all services are instantiated.
4. Run `pnpm install` again after adding dependencies.

## 11. Verify

Run the full check suite to confirm integration:

```bash
pnpm install
pnpm build:dev
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm knip
pnpm syncpack:check
pnpm publint
```

Fix any failures before considering the package complete. Common issues:

- **knip** flags unused exports: make sure the barrel re-exports only what consumers need.
- **syncpack** flags version mismatches: use the same version as other packages for shared deps (e.g. `vitest`, `zod`).
- **publint** flags missing exports: ensure `package.json` `exports` field points to the correct dist paths.
- **typecheck** can't find new types: run `pnpm build:dev` first so downstream packages can resolve compiled outputs via project references.
