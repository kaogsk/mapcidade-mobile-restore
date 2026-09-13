import type { Db } from "./processor.js";
import { toPgSql } from "./sql.js";

/**
 * Verificações READ-ONLY pós-restauração. As funções de builder retornam
 * {sql, params} (SQL parametrizado, sem interpolar valores) e são testáveis
 * offline; os runners executam os SELECTs.
 */

export interface Query {
  sql: string;
  params: unknown[];
}

// ── verificação de inserção ────────────────────────────────────────────────

export const reportByIncident = (incidentId: string): Query => ({
  sql: "SELECT gid, incident_id, report_number, userid, nature, insertdate " +
    "FROM incident_report WHERE incident_id = $1",
  params: [incidentId],
});

export const teamByIncident = (incidentId: string): Query => ({
  sql: "SELECT gid, incident_id, role, badge_number, callsign FROM incident_team WHERE incident_id = $1",
  params: [incidentId],
});

export const countByIncident = (table: string, incidentId: string): Query => ({
  sql: `SELECT COUNT(*) FROM ${table} WHERE incident_id = $1`,
  params: [incidentId],
});

export const docByHashPrefix = (prefix: string): Query => ({
  sql: "SELECT doc_id, theme_id, obj_code, file_name, hash_name, path " +
    "FROM document_upload WHERE hash_name LIKE $1",
  params: [`${prefix}%`],
});

export interface InsertVerification {
  report: Record<string, unknown> | null;
  team: Record<string, unknown> | null;
  partyCount: number;
  vehicleCount: number;
  sceneFlagsCount: number;
  document: Record<string, unknown> | null;
}

/** Roda todas as verificações de restauração para um incident_id. */
export async function verifyInsert(
  db: Db,
  incidentId: string,
  docHashPrefix: string,
): Promise<InsertVerification> {
  const one = async (q: Query) => (await db.query(q.sql, q.params))[0] ?? null;
  const count = async (table: string) => {
    const q = countByIncident(table, incidentId);
    const rows = await db.query<{ count: string }>(q.sql, q.params);
    return Number(rows[0]?.count ?? 0);
  };
  return {
    report: await one(reportByIncident(incidentId)),
    team: await one(teamByIncident(incidentId)),
    partyCount: await count("incident_party"),
    vehicleCount: await count("incident_vehicle"),
    sceneFlagsCount: await count("incident_scene_flags"),
    document: await one(docByHashPrefix(docHashPrefix)),
  };
}

// ── verificação de documento ───────────────────────────────────────────────

export const docByExactHash = (hashName: string): Query => ({
  sql: "SELECT doc_id, theme_id, obj_code, file_name, hash_name, path, user_id, insertdate " +
    "FROM document_upload WHERE hash_name = $1",
  params: [hashName],
});

export const recentDocsByUser = (userId: number, limit = 5): Query => ({
  sql: toPgSql(
    "SELECT doc_id, theme_id, obj_code, file_name, hash_name, path, insertdate " +
      "FROM document_upload WHERE user_id = %s ORDER BY insertdate DESC LIMIT %s",
  ),
  params: [userId, limit],
});

export const teamGidByIncident = (incidentId: string): Query => ({
  sql: "SELECT gid FROM incident_team WHERE incident_id = $1",
  params: [incidentId],
});

export const docByThemeObjCode = (themeId: number, objCode: string): Query => ({
  sql: toPgSql(
    "SELECT doc_id, theme_id, obj_code, file_name, hash_name, path, insertdate " +
      "FROM document_upload WHERE theme_id = %s AND obj_code = %s",
  ),
  params: [themeId, objCode],
});
