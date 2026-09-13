/**
 * Coerção segura de valor desconhecido para string (evita "[object Object]").
 * Objetos viram JSON; null/undefined viram ""; escalares usam String().
 */
export function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return JSON.stringify(v);
}

/** Extrai string de um query param do Express (string | array | undefined). */
export function queryStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return fallback;
}
