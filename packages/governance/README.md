# @ai-orchestrator/governance

Governance engine that enforces ownership rules, quality gates, escalation policies, and iteration contracts. Controls how agents interact, what they are allowed to do, and when human review is required.

## Architecture Layer

**Domain** -- defines governance rules, ownership checks, and iteration contract semantics.

## Workspace Dependencies

- `@ai-orchestrator/ports`
- `@ai-orchestrator/schemas`

## Structure

```
src/
  domain/
    governance/
      __tests__/
    iteration-contracts/
      __tests__/
  infrastructure/
    governance/
      __tests__/
    iteration-contracts/
      __tests__/
    collaboration-model/
      __tests__/
```

## Key Exports

### Domain -- Governance

- `GovernanceError`, `EscalationError`, `PolicyLoadError` -- governance error hierarchy
- `OwnershipCheckResult` -- result type for ownership validation

### Domain -- Iteration Contracts

- `ContractNotFoundError`, `ContractStateMismatchError`, `InvalidContractError` -- contract errors

### Infrastructure -- Governance

- `DefaultGovernanceEngine` -- main governance engine coordinating all checks
- `OwnershipEnforcer` -- validates artifact ownership rules
- `QualityGateChecker` -- enforces quality gates before transitions
- `EscalationManager` -- handles escalation to human reviewers
- `IterationLimiter` -- enforces maximum iteration counts
- `DecisionRecorder` -- persists governance decisions

### Infrastructure -- Iteration Contracts

- `DefaultIterationContractRegistry` -- registry of iteration contract definitions
- `buildContracts` -- factory for constructing contracts from configuration
- `BUILT_IN_CONTRACTS` -- predefined contracts (plan review, implementation review, clarification, acceptance validation)

### Infrastructure -- Collaboration Model

- `DefaultCollaborationModel` -- manages multi-agent collaboration patterns
