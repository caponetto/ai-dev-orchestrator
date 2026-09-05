import type { CanonicalSpecification, SpecificationId } from '@ai-dev-orchestrator/schemas';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const FRONTMATTER_DELIMITER = '---';

export function serializeSpecification(spec: CanonicalSpecification): string {
  const frontmatter: Record<string, unknown> = {
    id: spec.id,
    version: spec.version,
    title: spec.title,
    businessGoal: spec.businessGoal,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
  };

  if (spec.previousVersion) {
    frontmatter['previousVersion'] = spec.previousVersion;
  }
  if (spec.sources.length > 0) {
    frontmatter['sources'] = spec.sources;
  }
  if (spec.analysis) {
    frontmatter['analysis'] = spec.analysis;
  }
  if (spec.extensions && Object.keys(spec.extensions).length > 0) {
    frontmatter['extensions'] = spec.extensions;
  }

  const yaml = stringifyYaml(frontmatter);
  const body = serializeBody(spec);

  return `${FRONTMATTER_DELIMITER}\n${yaml}${FRONTMATTER_DELIMITER}\n\n${body}`;
}

/**
 * Deserialize a specification from frontmatter+markdown format.
 *
 * Body section parsing (stakeholders, requirements, etc.) is not yet implemented.
 * All body sections will be returned as empty arrays. Only frontmatter fields
 * (id, version, title, businessGoal, sources, analysis, etc.) are preserved.
 */
export function deserializeSpecification(content: string): CanonicalSpecification {
  const parts = content.split(FRONTMATTER_DELIMITER);
  if (parts.length < 3) {
    throw new Error('Invalid specification format: missing YAML frontmatter delimiters');
  }

  const yamlContent = parts[1].trim();
  const frontmatter = parseYaml(yamlContent) as Record<string, unknown>;

  const body = parts.slice(2).join(FRONTMATTER_DELIMITER).trim();
  const bodyData = parseBody(body);

  return {
    id: ((frontmatter['id'] as string | undefined) ?? '') as SpecificationId,
    version: Number(frontmatter['version'] ?? 1),
    previousVersion: frontmatter['previousVersion'] as string | undefined,
    title: (frontmatter['title'] as string | undefined) ?? '',
    businessGoal: (frontmatter['businessGoal'] as string | undefined) ?? '',
    stakeholders: bodyData.stakeholders,
    assumptions: bodyData.assumptions,
    constraints: bodyData.constraints,
    functionalRequirements: bodyData.functionalRequirements,
    nonFunctionalRequirements: bodyData.nonFunctionalRequirements,
    acceptanceCriteria: bodyData.acceptanceCriteria,
    risks: bodyData.risks,
    dependencies: bodyData.dependencies,
    definitionOfDone: bodyData.definitionOfDone,
    sources: (frontmatter['sources'] as CanonicalSpecification['sources'] | undefined) ?? [],
    createdAt: (frontmatter['createdAt'] as string | undefined) ?? '',
    updatedAt: (frontmatter['updatedAt'] as string | undefined) ?? '',
    extensions: frontmatter['extensions'] as Record<string, unknown> | undefined,
    analysis: frontmatter['analysis'] as CanonicalSpecification['analysis'],
  };
}

// ---------------------------------------------------------------------------
// Body serializer / parser
// ---------------------------------------------------------------------------

function serializeBody(spec: CanonicalSpecification): string {
  const sections: string[] = [];

  if (spec.stakeholders.length > 0) {
    sections.push('## Stakeholders\n');
    sections.push('| Name | Role | Interest |');
    sections.push('| ---- | ---- | -------- |');
    for (const s of spec.stakeholders) {
      sections.push(`| ${s.name} | ${s.role} | ${s.interest} |`);
    }
    sections.push('');
  }

  if (spec.assumptions.length > 0) {
    sections.push('## Assumptions\n');
    for (const a of spec.assumptions) {
      const validated = a.validated ? 'Validated.' : 'Not yet validated.';
      sections.push(`- **${a.id}** (${a.impact}): ${a.description} _${validated}_`);
    }
    sections.push('');
  }

  if (spec.constraints.length > 0) {
    sections.push('## Constraints\n');
    for (const c of spec.constraints) {
      sections.push(`- **${c.id}** (${c.type}): ${c.description} Source: ${c.source}`);
    }
    sections.push('');
  }

  if (spec.functionalRequirements.length > 0) {
    sections.push('## Functional Requirements\n');
    for (const fr of spec.functionalRequirements) {
      sections.push(`### ${fr.id}: ${fr.title} (${fr.priority})\n`);
      sections.push(fr.description);
      if (fr.acceptanceCriteria.length > 0) {
        sections.push('\n**Acceptance Criteria:**\n');
        for (const ac of fr.acceptanceCriteria) {
          sections.push(`- ${ac}`);
        }
      }
      if (fr.dependencies && fr.dependencies.length > 0) {
        sections.push(`\nDependencies: ${fr.dependencies.join(', ')}`);
      }
      sections.push('');
    }
  }

  if (spec.nonFunctionalRequirements.length > 0) {
    sections.push('## Non-Functional Requirements\n');
    for (const nfr of spec.nonFunctionalRequirements) {
      let line = `- **${nfr.id}** (${nfr.category}): ${nfr.description}`;
      if (nfr.metric) {
        line += ` Metric: ${nfr.metric}`;
      }
      if (nfr.threshold) {
        line += ` Threshold: ${nfr.threshold}`;
      }
      sections.push(line);
    }
    sections.push('');
  }

  if (spec.acceptanceCriteria.length > 0) {
    sections.push('## Acceptance Criteria\n');
    for (const ac of spec.acceptanceCriteria) {
      sections.push(
        `- **${ac.id}** (${ac.verificationMethod}): ${ac.description} Requirements: ${ac.requirementIds.join(', ')}`,
      );
    }
    sections.push('');
  }

  if (spec.risks.length > 0) {
    sections.push('## Risks\n');
    for (const r of spec.risks) {
      let line = `- **${r.id}** (likelihood: ${r.likelihood}, impact: ${r.impact}): ${r.description}`;
      if (r.mitigation) {
        line += ` Mitigation: ${r.mitigation}`;
      }
      sections.push(line);
    }
    sections.push('');
  }

  if (spec.dependencies.length > 0) {
    sections.push('## Dependencies\n');
    for (const d of spec.dependencies) {
      let line = `- **${d.id}** (${d.type}, ${d.status}): ${d.description}`;
      if (d.owner) {
        line += ` Owner: ${d.owner}`;
      }
      sections.push(line);
    }
    sections.push('');
  }

  if (spec.definitionOfDone.length > 0) {
    sections.push('## Definition of Done\n');
    for (const item of spec.definitionOfDone) {
      sections.push(`- ${item}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

function parseBody(
  _body: string,
): Pick<
  CanonicalSpecification,
  | 'stakeholders'
  | 'assumptions'
  | 'constraints'
  | 'functionalRequirements'
  | 'nonFunctionalRequirements'
  | 'acceptanceCriteria'
  | 'risks'
  | 'dependencies'
  | 'definitionOfDone'
> {
  return {
    stakeholders: [],
    assumptions: [],
    constraints: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    acceptanceCriteria: [],
    risks: [],
    dependencies: [],
    definitionOfDone: [],
  };
}
