import type { Statement, Plan } from "./types.js";
import { toStr } from "./util/str.js";

/**
 * Montagem de SQL — porte de run_insert/insert_row.
 * Gera o INSERT parametrizado com placeholders %s (mesmo texto do Python legado),
 * SEM executar. Executar é responsabilidade explícita de quem chama (dry-run default).
 */
export function buildInsert(
  table: string,
  fields: string[],
  values: unknown[],
  returning: string | null = null,
): Statement {
  const cols = fields.join(", ");
  const placeholders = fields.map(() => "%s").join(", ");
  let sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`;
  if (returning) sql += ` RETURNING ${returning}`;
  return { table, fields, values, sql, returning };
}

/**
 * Converte o SQL de placeholders %s (estilo psycopg2) para placeholders
 * posicionais $1, $2, … (estilo node-postgres/pg).
 */
export function toPgSql(sql: string): string {
  let i = 0;
  return sql.replace(/%s/g, () => `$${++i}`);
}

/** Preview textual de um statement em dry-run (campo: valor truncado a 120). */
export function previewStatement(st: Statement): string {
  const lines = [`[DRY-RUN] INSERT INTO ${st.table}`];
  st.fields.forEach((f, idx) => {
    const s = toStr(st.values[idx]);
    lines.push(`  ${f}: ${s.slice(0, 120)}`);
  });
  if (st.returning) lines.push(`  >> would return: ${st.returning}`);
  return lines.join("\n");
}

/** Preview de um plano inteiro. */
export function previewPlan(plan: Plan): string {
  return plan.map(previewStatement).join("\n");
}
