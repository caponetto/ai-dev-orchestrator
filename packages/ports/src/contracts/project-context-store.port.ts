import type {
  ContextCategory,
  ContextDocument,
  ContextFragment,
  ContextQuery,
} from '@ai-orchestrator/schemas';

export interface ProjectContextStore {
  initialize(projectRoot: string): Promise<void>;
  read(category: ContextCategory): Promise<ContextDocument | null>;
  write(category: ContextCategory, content: ContextDocument): Promise<void>;
  query(filter: ContextQuery): Promise<readonly ContextFragment[]>;
  getProjectHash(projectRoot: string): string;
}
