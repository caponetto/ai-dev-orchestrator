# Governance

The governance implementation spans:

- `packages/governance/src/infrastructure/governance/`
- `packages/governance/src/infrastructure/iteration-contracts/`
- `packages/policy-engine/src/`

## What Governance Controls Today

The current runtime enforces governance from `governance.yaml` plus workflow context.

Implemented policy areas include:

- iteration limits
- quality gates
- token budget
- permission policy

The workflow engine consults governance when transitions or reviews need policy evaluation. The runner system consumes the permission policy that is authored in `governance.yaml` and surfaced in merged config as `roles.permissionPolicy`.

## Main Components

- transition gating and decision recording
- iteration-limit evaluation
- quality-gate evaluation
- budget policy assembly
- agreement checks
- role-collaboration helpers and ownership-related checks
- iteration contracts (built-in loops: `PLAN_REVIEW_LOOP`, `IMPLEMENTATION_REVIEW_LOOP`, `CLARIFICATION_LOOP`, `ACCEPTANCE_VALIDATION_LOOP`)

## Config Surface

The current authored governance file supports:

- `iteration_limits`
- `quality_gates`
- `budget`
- `permission_policy`

The dashboard settings UI edits a subset of this data through `FilesystemSettingsProvider`.

## Source of Truth

Prefer:

- `packages/governance/src/infrastructure/governance/`
- `packages/governance/src/infrastructure/iteration-contracts/`
- `packages/policy-engine/src/`
- `packages/policy-engine/src/infrastructure/governance-file-loader.ts`
- `packages/core/src/infrastructure/configuration/configuration-loader.ts`
- `packages/config-templates/src/static/governance.yaml`
