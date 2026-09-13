import { describe, it, expect } from "vitest";
import { buildInsert, previewStatement, toPgSql } from "../src/sql.js";

describe("buildInsert", () => {
  it("monta INSERT com placeholders %s (estilo psycopg2)", () => {
    const st = buildInsert("t", ["a", "b"], [1, "x"], "gid");
    expect(st.sql).toBe("INSERT INTO t (a, b) VALUES (%s, %s) RETURNING gid");
    expect(st.values).toEqual([1, "x"]);
    expect(st.returning).toBe("gid");
  });
  it("sem returning", () => {
    const st = buildInsert("t", ["a"], [1]);
    expect(st.sql).toBe("INSERT INTO t (a) VALUES (%s)");
    expect(st.returning).toBeNull();
  });
});

describe("toPgSql", () => {
  it("converte %s em $1,$2,...", () => {
    expect(toPgSql("INSERT INTO t (a, b) VALUES (%s, %s)")).toBe(
      "INSERT INTO t (a, b) VALUES ($1, $2)",
    );
  });
});

describe("previewStatement", () => {
  it("mostra campos e trunca a 120", () => {
    const st = buildInsert("t", ["a"], ["x".repeat(200)], "gid");
    const out = previewStatement(st);
    expect(out).toContain("[DRY-RUN] INSERT INTO t");
    expect(out).toContain(">> would return: gid");
    expect(out).toContain("  a: " + "x".repeat(120));
    expect(out).not.toContain("x".repeat(121));
  });
});
