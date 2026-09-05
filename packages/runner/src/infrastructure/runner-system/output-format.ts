/** File extension for a worker output artifact given its contract format. */
import type { WorkerOutputFormat } from '@ai-dev-orchestrator/schemas';
export function extensionForOutputFormat(format: WorkerOutputFormat | undefined): string {
  switch (format) {
    case 'yaml':
      return 'yaml';
    case 'markdown_with_frontmatter':
      return 'md';
    case 'freeform':
      return 'txt';
    case 'json':
    default:
      return 'json';
  }
}

/** Human-readable label used in agent write instructions. */
export function labelForOutputFormat(format: WorkerOutputFormat | undefined): string {
  switch (format) {
    case 'yaml':
      return 'YAML';
    case 'markdown_with_frontmatter':
      return 'markdown with YAML frontmatter';
    case 'freeform':
      return 'plain text';
    case 'json':
    default:
      return 'JSON';
  }
}
