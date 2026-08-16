import { z } from 'zod/v4';

export const diffHunkSchema = z.object({
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  content: z.string(),
});
export type DiffHunk = z.infer<typeof diffHunkSchema>;

export const symbolRoleSchema = z.enum(['definition', 'reference', 'import', 'write']);
export type SymbolRole = z.infer<typeof symbolRoleSchema>;

export const symbolContextSchema = z.object({
  symbol: z.string(),
  filePath: z.string(),
  line: z.number(),
  role: symbolRoleSchema,
  documentation: z.string().optional(),
  kind: z.string().optional(),
});
export type SymbolContext = z.infer<typeof symbolContextSchema>;

export const codeBundleSchema = z.object({
  symbols: z.array(symbolContextSchema),
  relatedDefinitions: z.array(
    z.object({
      filePath: z.string(),
      startLine: z.number(),
      endLine: z.number(),
      content: z.string(),
      symbol: z.string(),
    }),
  ),
  tokenEstimate: z.number(),
});
export type CodeBundle = z.infer<typeof codeBundleSchema>;
