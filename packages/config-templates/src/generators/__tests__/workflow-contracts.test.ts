import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACT_TYPES } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { PARTIALS_DIR, SCRIPTS_DIR, STATIC_DIR } from '../../paths';
import { roleSchema } from '../../schemas/static-schemas';
import { generateRolesYaml } from '../roles-generator';
import { generateTemplateFile } from '../templates-generator';
import { getBuiltInWorkflows } from '../workflow-generator';

const roles = z.object({ roles: z.array(roleSchema) }).parse(parse(generateRolesYaml())).roles;
const templates = z.object({
  role: z.string(),
  output_contract: z.object({ artifact_type: z.string() }),
  variables: z
    .array(z.object({ type: z.string(), artifact_type: z.string().optional() }))
    .optional(),
  partials: z.array(z.string()).optional(),
});

describe('built-in workflow, role, prompt and script contracts', () => {
  it.each(getBuiltInWorkflows())(
    '$name references executable roles and scripts with compatible artifact contracts',
    (workflow) => {
      const dispatched = new Set<string>();
      for (const state of Object.values(workflow.states)) {
        for (const action of [...(state.entryActions ?? []), ...(state.exitActions ?? [])]) {
          if (action.type === 'dispatch_worker' || action.type === 'dispatch_dynamic_workers') {
            dispatched.add(action.params.role);
          } else if (action.type === 'dispatch_parallel_workers') {
            for (const role of action.params.roles) {
              dispatched.add(role);
            }
          } else if (action.type === 'run_script') {
            expect(
              existsSync(join(STATIC_DIR, SCRIPTS_DIR, action.params.script)),
              action.params.script,
            ).toBe(true);
          }
        }
      }
      expect(dispatched.size).toBeGreaterThan(0);
      for (const id of dispatched) {
        const role = roles.find((candidate) => candidate.id === id);
        expect(role, id).toBeDefined();
        if (!role) {
          throw new Error(`Missing role: ${id}`);
        }
        const template = templates.parse(parse(generateTemplateFile(id).split('---')[1]));
        expect(template.role).toBe(id);
        expect(role.owned_artifacts, id).toContain(template.output_contract.artifact_type);
        for (const type of [...role.owned_artifacts, ...role.readable_artifacts]) {
          expect(ARTIFACT_TYPES, `${id}: ${type}`).toContain(type);
        }
        for (const variable of template.variables ?? []) {
          if (variable.type === 'artifact' && variable.artifact_type) {
            expect([...role.readable_artifacts, ...role.owned_artifacts], id).toContain(
              variable.artifact_type,
            );
          }
        }
        for (const partial of template.partials ?? []) {
          expect(existsSync(join(STATIC_DIR, PARTIALS_DIR, `${partial}.md`)), partial).toBe(true);
        }
      }
    },
  );
});
