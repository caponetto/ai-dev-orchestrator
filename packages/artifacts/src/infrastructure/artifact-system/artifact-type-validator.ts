import type { ArtifactTypeValidator, ArtifactValidationResult } from '@ai-orchestrator/ports';
import type { ArtifactType } from '@ai-orchestrator/schemas';

import { ARTIFACT_SCHEMA_MAP } from '../../domain/artifact-system/artifact-descriptors';

import { parseArtifactContent, parseYaml } from './content-parser';

export class DefaultArtifactTypeValidator implements ArtifactTypeValidator {
  validate(type: ArtifactType, content: string): ArtifactValidationResult {
    const schema = ARTIFACT_SCHEMA_MAP[type];

    if (type === 'intake_requirements') {
      return content.length > 0
        ? { valid: true }
        : { valid: false, errors: [{ path: '', message: 'Content must be non-empty' }] };
    }

    const data = type === 'run_manifest' ? parseYaml(content) : parseArtifactContent(content);
    if (!data) {
      return {
        valid: false,
        errors: [
          {
            path: '',
            message:
              type === 'run_manifest'
                ? 'Content is not valid YAML'
                : 'Content is not valid frontmatter or JSON',
          },
        ],
      };
    }

    const result = schema.safeParse(data);
    if (result.success) {
      return { valid: true };
    }

    const errors = result.error.issues.map((issue) => ({
      path: '/' + issue.path.join('/'),
      message: issue.message,
    }));

    return { valid: false, errors };
  }

  getSchema(type: ArtifactType): unknown {
    return ARTIFACT_SCHEMA_MAP[type];
  }
}
