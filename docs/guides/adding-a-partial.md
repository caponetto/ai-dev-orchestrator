# Adding a Partial

Partials are reusable Markdown fragments shared across role prompt templates. They use Handlebars syntax (`{{>partial_name}}`) and are resolved at render time by the prompt engine.

## When to Use a Partial

Create a partial when:

- The same block of text appears in 3+ templates verbatim or near-verbatim.
- A change to the block should propagate to every template that uses it.

Do **not** create a partial for text that varies significantly between templates — use template variables or conditional blocks instead.

## Steps

### 1. Create the partial file

Add a Markdown file under `packages/config-templates/src/static/partials/`:

```
packages/config-templates/src/static/partials/my_partial_name.md
```

**Naming rules:**

- Use `snake_case` — the partial regex (`\w+`) does not match hyphens.
- The filename (without `.md`) becomes the partial ID used in templates.

Write the partial content as plain Markdown. It can contain Handlebars expressions (`{{{variable}}}`, `{{#if ...}}`) that will be resolved against the template's variable context.

### 2. Reference the partial in templates

In each template that should include the partial, add two things:

**a. Frontmatter declaration** — list the partial in the `partials` array so the engine validates it at load time:

```yaml
---
role: my_role
partials:
  - my_partial_name
---
```

**b. Inline reference** — place `{{>my_partial_name}}` where the content should be inserted:

```markdown
## Output Contract

{{>my_partial_name}}
```

### 3. Verify

Run the full check suite:

```bash
pnpm typecheck && pnpm test:unit && pnpm lint
```

Key things to confirm:

- `partials-generator.test.ts` — the naming test asserts partial IDs match `/^[a-z][a-z0-9_]*$/`. Your new file must follow this pattern.
- `default-prompt-engine.test.ts` — if a template declares a partial that is not loaded, `MissingPartialError` is thrown. The composition root loads all partials from the directory automatically, so as long as the file exists the engine will find it.
- CLI E2E tests — these exercise the full render pipeline. A mismatch between a declared partial and a missing file will surface as a workflow abort.

## How It Works

The partial system has three layers:

1. **Static files** (`packages/config-templates/src/static/partials/*.md`) — the source of truth for partial content. The `partials-generator.ts` module reads all `.md` files from this directory and exposes `ALL_PARTIAL_IDS` and `generatePartialFile()`.

2. **Template frontmatter** (`partials: [...]` in each template's YAML header) — declares which partials a template depends on. The `template-file-loader.ts` module parses this field via `mapPartials()` and includes it in the `PromptTemplate` object.

3. **Prompt engine** (`DefaultPromptEngine`) — accepts a `PartialMap` (loaded at startup from the partials directory) and resolves `{{>name}}` references at render time. The `resolvePartials()` method validates that every declared partial exists in the loaded map before rendering.

## Existing Partials

| Partial ID                      | Purpose                                                | Used by              |
| ------------------------------- | ------------------------------------------------------ | -------------------- |
| `json_write_rules`              | JSON output formatting discipline                      | 24 templates         |
| `agent_time_management`         | Time management guidelines for agents                  | 19 templates         |
| `reviewer_base`                 | Shared boundaries and structure for reviewer roles     | 6 reviewer templates |
| `diff_retrieval_strategy`       | Multi-strategy diff fetching instructions              | 1 reviewer template  |
| `docs_only_fast_path`           | Short-circuit for documentation-only changes           | 1 reviewer template  |
| `refactoring_fast_path`         | Short-circuit for behavior-preserving refactor changes | 0 templates          |
| `reviewer_evidence_requirement` | Evidence requirement for review findings               | 7 reviewer templates |

## Common Mistakes

- **Using hyphens in the filename** — `my-partial.md` will not match `{{>my-partial}}` because `\w+` excludes `-`. Use underscores.
- **Forgetting the frontmatter declaration** — the partial will render (Handlebars resolves it from the loaded map), but the engine validation step will not check for it. Always declare partials in the frontmatter so missing files are caught early.
- **Nesting partials** — partials can reference other partials (`{{>other}}`), but avoid deep nesting. Keep the dependency chain flat (1 level max) for readability.
