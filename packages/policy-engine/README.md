# @ai-orchestrator/policy-engine

Policy evaluation engine that loads, resolves, and enforces governance policies from YAML configuration. Provides the rule evaluation layer that the governance engine delegates to for iteration limits, quality thresholds, and budget constraints.

## Architecture Layer

**Domain** -- defines the policy model, resolution logic, and evaluation semantics.

## Workspace Dependencies

- `@ai-orchestrator/ports`
- `@ai-orchestrator/schemas`
- `@ai-orchestrator/utils`

## Structure

```
src/
  domain/
    __tests__/
  infrastructure/
    __tests__/
```

## Key Exports

### Domain

- `PolicyEvaluationError` -- thrown when a policy fails to evaluate
- `PolicyConfigurationError` -- thrown for invalid policy configuration
- `PolicyResolverError` -- thrown when policy resolution fails
- `UnknownPolicyTypeError` -- thrown for unrecognized policy types

### Infrastructure

- `DefaultPolicyEngine` -- evaluates policies against the current workflow state
- `DefaultPolicyRegistry` -- stores and retrieves registered policy definitions
- `PolicyResolver` -- resolves which policies apply to a given context
- `loadGovernanceFromYaml` -- parses governance configuration from YAML files
- `loadPoliciesFromGovernance` -- extracts policy definitions from a governance config
