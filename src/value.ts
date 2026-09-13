import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Geom } from "./types.js";
import { toStr } from "./util/str.js";

/**
 * Helpers de coerção de valor — porte fiel de processor.py / insert_backup.py.
 */

/** insert_backup.maybe: vazio/None → null; senão aplica cast (se dado). */
export function maybe(v: unknown, cast?: (x: unknown) => unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  return cast ? cast(v) : v;
}

/**
 * insert_backup.py usa `int` do Python, que trunca para inteiro.
 * int("01") -> 1, int("02") -> 2. Replicamos parseInt em base 10.
 */
export function toInt(v: unknown): number {
  return parseInt(String(v), 10);
}

/** Web-mercator point → EWKT (idêntico a geom_ewkt / build_row). */
export function geomEwkt(xy: Geom): string {
  return `SRID=3857;POINT(${xy[0]} ${xy[1]})`;
}

/**
 * processor.cast_value: coerção por data_type do information_schema.
 * Retorna null p/ vazio; mantém a semântica do Python.
 */
export function castValue(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined || value === "") return null;

  if (dataType === "boolean") {
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes"].includes(toStr(value).toLowerCase());
  }
  if (dataType === "integer" || dataType === "bigint" || dataType === "smallint") {
    const n = parseInt(toStr(value).split(".")[0] ?? "", 10);
    return Number.isNaN(n) ? null : n;
  }
  if (
    dataType === "numeric" ||
    dataType === "decimal" ||
    dataType === "real" ||
    dataType === "double precision"
  ) {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  if (dataType === "date") {
    return value ? value : null;
  }
  return toStr(value);
}

/** processor.extract_theme_id: 'theme-3793-theme-3794_0' → 3794. */
export function extractThemeId(answerKey: string): number {
  const key = answerKey.replace(/_\d+$/, "");
  const parts = [...key.matchAll(/theme-(\d+)/g)].map((m) => m[1]);
  const last = parts[parts.length - 1];
  return parseInt(last ?? "", 10);
}

/** processor.answer_depth: quantos '-theme-' há na chave. */
export function answerDepth(answerKey: string): number {
  return answerKey.split("-theme-").length - 1;
}

/** MD5 hex de um arquivo (idêntico a md5_file). */
export function md5File(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

/** splitext(name)[0] — nome sem a última extensão. */
export function stripExt(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx <= 0 ? fileName : fileName.slice(0, idx);
}
