import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRow, getTheme, processTask, type Db } from "../src/processor.js";
import { TasksSchema, type Task } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "..", "fixtures", "demo_backup");

function loadTasks(): Task[] {
  return TasksSchema.parse(JSON.parse(readFileSync(resolve(FIXTURE, "tasks.json"), "utf-8")));
}

/** Db fake que registra as queries e devolve schema canned. */
function makeFakeDb() {
  const queries: { sql: string; params: unknown[] }[] = [];
  const themes: Record<number, { table_name: string; group_id: number }> = {
    100: { table_name: "incident_report", group_id: 10 },
    101: { table_name: "incident_team", group_id: 10 },
    102: { table_name: "incident_party", group_id: 10 },
    103: { table_name: "incident_vehicle", group_id: 10 },
    104: { table_name: "incident_scene_flags", group_id: 10 },
  };
  const columns = [
    "gid", "geom", "incident_id", "report_number", "area", "insertdate", "done",
    "role", "badge_number", "callsign", "full_name",
    "party_number", "plate", "nature",
  ];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      queries.push({ sql, params });
      if (sql.includes("FROM theme")) {
        const t = themes[params[0] as number];
        return (t ? [{ theme_id: params[0], table_name: t.table_name, group_id: t.group_id }] : []) as T[];
      }
      if (sql.includes("information_schema.columns")) {
        return columns.map((c) => ({
          column_name: c,
          data_type: c === "done" ? "boolean" : c === "area" ? "integer" : "text",
        })) as T[];
      }
      if (sql.includes("SELECT 1 FROM")) return [] as T[]; // recordExists → não existe
      if (sql.includes("document_upload")) return [] as T[];
      return [] as T[];
    },
  };
  return { db, queries };
}

describe("buildRow", () => {
  it("inclui só colunas existentes; geom vira EWKT; pula gid", () => {
    const cols = { gid: "integer", geom: "text", incident_id: "text", area: "integer" };
    const { fields, values } = buildRow(
      { incident_id: "R", geom: [1, 2] },
      cols,
      { area: 0 },
    );
    expect(fields).toEqual(["geom", "incident_id", "area"]);
    expect(values[0]).toBe("SRID=3857;POINT(1 2)");
    expect(values[1]).toBe("R");
    expect(values[2]).toBe(0);
  });
});

describe("getTheme", () => {
  it("retorna null quando não achado", async () => {
    const { db } = makeFakeDb();
    expect(await getTheme(db, 9999)).toBeNull();
  });
});

describe("processTask dry-run", () => {
  it("monta plano sem executar nenhuma escrita", async () => {
    const { db, queries } = makeFakeDb();
    const task = loadTasks()[0]!;
    const res = await processTask(db, task, {
      filesDir: resolve(FIXTURE, "files"),
      now: "NOW",
      execute: false,
    });
    // plano tem inserts (root + subs + doc)
    expect(res.plan.length).toBeGreaterThan(5);
    expect(res.plan[0]!.table).toBe("incident_report");
    expect(res.plan.some((s) => s.table === "document_upload")).toBe(true);
    // NENHUMA query de escrita/transação foi emitida
    const writes = queries.filter((q) =>
      /^\s*(INSERT|UPDATE|DELETE|BEGIN|COMMIT)/i.test(q.sql),
    );
    expect(writes).toEqual([]);
    // rootGid é null em dry-run
    expect(res.rootGid).toBeNull();
  });

  it("aborta com erro se incident_id ausente na raiz", async () => {
    const { db } = makeFakeDb();
    const task = loadTasks()[0]!;
    const noIncidentId: Task = {
      ...task,
      send: { answers: { "theme-100": { foo: "bar" } } },
    };
    const res = await processTask(db, noIncidentId, { filesDir: ".", now: "NOW" });
    expect(res.logs.some((l) => l.includes("incident_id not found"))).toBe(true);
    expect(res.plan).toEqual([]);
  });
});
