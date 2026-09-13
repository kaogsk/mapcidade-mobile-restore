import { z } from "zod";

/**
 * Estruturas do backup do app mobile (tasks.json).
 * O schema é intencionalmente permissivo (passthrough) porque cada formulário
 * mobile tem um conjunto de campos diferente — só validamos o que o núcleo usa.
 */

/** Ponto em Web Mercator (EPSG:3857): [x, y]. */
export const GeomSchema = z.tuple([z.number(), z.number()]);
export type Geom = z.infer<typeof GeomSchema>;

/** Uma resposta (answer) de um tema — dicionário arbitrário de campos. */
export const AnswerSchema = z.record(z.string(), z.unknown());
export type Answer = z.infer<typeof AnswerSchema>;

/** Entrada de arquivo anexado a um tema. */
export const FileEntrySchema = z
  .object({
    fileName: z.string(),
    fileType: z.union([z.number(), z.string()]).optional(),
    extension: z.string().optional(),
  })
  .passthrough();
export type FileEntry = z.infer<typeof FileEntrySchema>;

/** Uma task = um registro completo do formulário mobile. */
export const TaskSchema = z
  .object({
    Form_name: z.string().optional(),
    themeId: z.number(),
    userId: z.number(),
    geom: GeomSchema.optional(),
    send: z.object({
      // answers pode ter valores null (sub-temas não preenchidos)
      answers: z.record(z.string(), AnswerSchema.nullable()),
    }),
    files: z.record(z.string(), z.array(FileEntrySchema)).optional(),
  })
  .passthrough();
export type Task = z.infer<typeof TaskSchema>;

export const TasksSchema = z.array(TaskSchema);
export type Tasks = z.infer<typeof TasksSchema>;

/** Um INSERT montado (sem executar). É a unidade do "plano" de escrita. */
export interface Statement {
  table: string;
  fields: string[];
  /** valores na ordem de `fields`; placeholders %s no SQL. */
  values: unknown[];
  /** SQL parametrizado com placeholders %s (compatível com o Python legado). */
  sql: string;
  /** coluna a retornar (RETURNING), se houver. */
  returning: string | null;
}

/** Plano de escrita = lista ordenada de statements que seriam executados. */
export type Plan = Statement[];
