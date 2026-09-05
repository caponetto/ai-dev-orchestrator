# @ai-dev-orchestrator/config-templates

Generates initial configuration files for the orchestrator: project config, governance rules, roles, workflows, prompt templates, partials, and shell scripts. Includes both YAML generators and static template files that are copied during `ai init`.

## Architecture Layer

**Application** -- provides the file-generation logic that the CLI's `init` command uses to scaffold a new project.

## Workspace Dependencies

- `@ai-dev-orchestrator/schemas`
- `@ai-dev-orchestrator/utils`
- `@ai-dev-orchestrator/workflow`

## Structure

```
src/
  generators/
  schemas/
  static/
    partials/
    roles/
    scripts/
    templates/
    workflows/
```

## Key Exports

- `generateAll`, `generateGlobalFiles` -- top-level orchestrators that produce every config file at once
- `generateConfigYaml`, `generateGovernanceYaml`, `generateRolesYaml`, `generateRunnersYaml`, `generateWorkflowYaml` -- individual YAML generators
- `generateTemplateFile`, `generatePartialFile`, `generateScriptFile` -- static file generators
- `getBuiltInWorkflows`, `getAvailableWorkflowNames` -- workflow discovery
- `configSchema`, `governanceSchema`, `roleSchema`, `workflowYamlSchema`, `validateStatic` -- validation schemas
- Path constants (`CONFIG_FILENAME`, `GOVERNANCE_FILENAME`, `ROLES_DIR`, `WORKFLOWS_DIR`, etc.)
