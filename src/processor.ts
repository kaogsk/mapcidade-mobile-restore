import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Answer, Plan, Statement, Task } from "./types.js";
import { buildInsert, toPgSql } from "./sql.js";
import { answerDepth, castValue, extractThemeId, md5File, stripExt } from "./value.js";

/**
 * Processador GENÉRICO/dinâmico. Resolve a estrutura de cada tema via
 * `theme` + information_schema e monta os INSERTs dinamicamente — ao
 * contrário do inserter determinístico (incidentForm.ts), que já sabe de
 * antemão o schema de um único formulário fixo. Aqui os testes usam um Db fake.
 *
 * SEGURANÇA: dry-run é o padrão. Nada é executado/enviado sem execute:true.
 */

/** Interface mínima de banco (implementada por PgDb em db.ts; fakeDb nos testes). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Uploader de arquivo (SFTP em db.ts; no-op/mocked em teste e dry-run). */
export type Uploader = (
  localPath: string,
  remoteDir: string,
  remoteName: string,
) => Promise<{ size: number }>;

export interface Theme {
  theme_id: number;
  theme_name: string;
  table_name: string | null;
  table_id: number | null;
  group_id: number | null;
  profile_id: number | null;
  key_column: string | null;
}

// ── schema helpers (read-only) ────────────────────────────────────────────

export async function getTheme(db: Db, themeId: number): Promise<Theme | null> {
  const rows = await db.query<Theme>(
    toPgSql(
      "SELECT theme_id, theme_name, table_name, table_id, group_id, profile_id, key_column " +
        "FROM theme WHERE theme_id = %s",
    ),
    [themeId],
  );
  return rows[0] ?? null;
}

/** Retorna {col_name: data_type} em ordem de ordinal_position. */
export async function getTableColumns(db: Db, tableName: string): Promise<Record<string, string>> {
  const rows = await db.query<{ column_name: string; data_type: string }>(
    toPgSql(
      "SELECT column_name, data_type FROM information_schema.columns " +
        "WHERE table_name = %s ORDER BY ordinal_position",
    ),
    [tableName],
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.column_name] = r.data_type;
  return out;
}

export async function getDocThemeId(db: Db, groupId: number, fallback: number): Promise<number> {
  const rows = await db.query<{ theme_id: number }>(
    toPgSql(
      "SELECT theme_id FROM document_upload WHERE group_id = %s " +
        "GROUP BY theme_id ORDER BY MAX(insertdate) DESC NULLS LAST LIMIT 1",
    ),
    [groupId],
  );
  return rows[0]?.theme_id ?? fallback;
}

export async function getDocPath(db: Db): Promise<string> {
  const rows = await db.query<{ path: string }>(
    "SELECT path FROM document_upload ORDER BY insertdate DESC NULLS LAST LIMIT 1",
  );
  return rows[0]?.path ?? "/opt/mapcidade/documents";
}

export async function recordExists(db: Db, table: string, incidentId: string): Promise<boolean> {
  try {
    const rows = await db.query(toPgSql(`SELECT 1 FROM ${table} WHERE incident_id = %s LIMIT 1`), [
      incidentId,
    ]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ── row builder (porte de build_row) ──────────────────────────────────────

export function buildRow(
  answer: Answer,
  tableCols: Record<string, string>,
  extra: Record<string, unknown>,
): { fields: string[]; values: unknown[] } {
  const merged: Record<string, unknown> = { ...answer, ...extra };
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [col, dtype] of Object.entries(tableCols)) {
    if (col === "gid") continue;
    if (col === "geom") {
      const geom = merged["geom"];
      if (Array.isArray(geom) && geom.length === 2) {
        fields.push("geom");
        values.push(`SRID=3857;POINT(${geom[0]} ${geom[1]})`);
      }
    } else if (col in merged) {
      fields.push(col);
      values.push(castValue(merged[col], dtype));
    }
  }
  return { fields, values };
}

// ── task processor ────────────────────────────────────────────────────────

export interface ProcessOptions {
  filesDir: string;
  now: unknown;
  /** false (padrão) = dry-run: monta o plano, não executa nem faz upload. */
  execute?: boolean;
  uploader?: Uploader;
  host?: string;
}

export interface TaskResult {
  plan: Plan;
  logs: string[];
  /** gid do registro raiz, quando executado (null em dry-run). */
  rootGid: number | null;
}

/**
 * Processa uma task: monta o plano de INSERTs (dry-run) e, se execute:true,
 * executa em sequência propagando o gid raiz e enviando os arquivos por SFTP.
 */
export async function processTask(db: Db, task: Task, opts: ProcessOptions): Promise<TaskResult> {
  const logs: string[] = [];
  const plan: Plan = [];
  const answers = task.send.answers;
  const files = task.files ?? {};
  const rootTid = task.themeId;
  const userId = task.userId;
  const now = opts.now;
  const execute = opts.execute ?? false;

  const rootTheme = await getTheme(db, rootTid);
  if (!rootTheme) {
    logs.push(`ERROR: theme ${rootTid} not found`);
    return { plan, logs, rootGid: null };
  }
  const rootTbl = rootTheme.table_name;
  const rootGroup = rootTheme.group_id;
  const rootKey = `theme-${rootTid}`;
  const rootAns = answers[rootKey] ?? {};
  const incidentId = rootAns["incident_id"] as string | undefined;

  logs.push(`Task: ${task.Form_name ?? ""} | incident_id=${incidentId ?? ""} | user=${userId}`);

  if (!incidentId) {
    logs.push("ERROR: incident_id not found in root answer");
    return { plan, logs, rootGid: null };
  }
  if (!rootTbl) {
    logs.push(`ERROR: root theme ${rootTid} has no table`);
    return { plan, logs, rootGid: null };
  }
  if (await recordExists(db, rootTbl, incidentId)) {
    logs.push(`SKIP: incident_id already exists in ${rootTbl}`);
    return { plan, logs, rootGid: null };
  }

  const colCache: Record<string, Record<string, string>> = {};
  let rootGid: number | null = null;

  // ordena por profundidade para inserir a raiz primeiro
  const sortedItems = Object.entries(answers)
    .filter((e): e is [string, Answer] => e[1] !== null)
    .sort((a, b) => answerDepth(a[0]) - answerDepth(b[0]));

  for (const [key, answer] of sortedItems) {
    const themeId = extractThemeId(key);
    const theme = await getTheme(db, themeId);
    if (!theme || !theme.table_name) {
      logs.push(`  SKIP answer ${key}: theme ${themeId} has no table`);
      continue;
    }
    const tbl = theme.table_name;
    colCache[tbl] ??= await getTableColumns(db, tbl);
    const cols = colCache[tbl];

    const extra: Record<string, unknown> = { area: 0, insertdate: now, done: true };
    if (!("report_number" in answer) && "report_number" in rootAns) {
      extra["report_number"] = rootAns["report_number"];
    }

    const { fields, values } = buildRow(answer, cols, extra);
    if (fields.length === 0) {
      logs.push(`  SKIP answer ${key}: no matching columns`);
      continue;
    }

    const st = buildInsert(tbl, fields, values, "gid");
    plan.push(st);

    if (execute) {
      const gid = await insertReturning(db, st);
      logs.push(`  INSERT ${tbl} (theme ${themeId}) gid=${gid}`);
      if (key === rootKey) rootGid = gid;
    } else {
      logs.push(`  [DRY-RUN] INSERT ${tbl} (theme ${themeId})`);
    }
  }

  // ── documentos ───────────────────────────────────────────────────────────
  if (Object.keys(files).length === 0) return { plan, logs, rootGid };

  const docThemeId = await getDocThemeId(db, rootGroup ?? rootTid, rootTid);
  const docPath = await getDocPath(db);
  logs.push(`  Documents: theme_id=${docThemeId} group_id=${rootGroup} path=${docPath}`);

  for (const fileList of Object.values(files)) {
    for (const fileEntry of fileList) {
      const fileName = fileEntry.fileName;
      const localPath = join(opts.filesDir, fileName);
      const baseName = stripExt(fileName);
      if (!existsSync(localPath)) {
        logs.push(`  WARN: file not found locally: ${localPath}`);
        continue;
      }
      const md5 = md5File(localPath);
      const hashName = `${baseName}_${md5}.jpg`;

      if (execute) {
        if (!opts.uploader) throw new Error("execute:true exige um uploader (SFTP)");
        const { size } = await opts.uploader(localPath, docPath, hashName);
        logs.push(`  upload OK: ${docPath}/${hashName} (${size} bytes)`);
      } else {
        logs.push(`  [DRY-RUN] would upload ${docPath}/${hashName}`);
      }

      const docAnswer: Record<string, unknown> = {
        theme_id: docThemeId,
        obj_code: rootGid !== null ? String(rootGid) : "<ROOT_GID>",
        user_id: userId,
        doc_status: 1,
        doc_type: Number(fileEntry.fileType ?? 1),
        file_name: baseName,
        hash_name: hashName,
        extension: ".jpg",
        path: docPath,
        group_id: rootGroup,
        date_time: now,
        insertdate: now,
      };
      const fields = Object.keys(docAnswer);
      const values = fields.map((f) => docAnswer[f]);
      const st = buildInsert("document_upload", fields, values, "doc_id");
      plan.push(st);

      if (execute) {
        const docId = await insertReturning(db, st);
        logs.push(`  INSERT document_upload doc_id=${docId} obj_code=${rootGid}`);
      } else {
        logs.push(`  [DRY-RUN] INSERT document_upload obj_code=${rootGid ?? "<ROOT_GID>"}`);
      }
    }
  }

  return { plan, logs, rootGid };
}

async function insertReturning(db: Db, st: Statement): Promise<number> {
  const rows = await db.query<Record<string, unknown>>(toPgSql(st.sql), st.values);
  const first = rows[0];
  const key = st.returning ?? "gid";
  return Number(first?.[key]);
}
