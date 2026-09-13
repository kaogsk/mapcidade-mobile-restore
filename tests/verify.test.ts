import { describe, it, expect } from "vitest";
import {
  countByIncident,
  docByExactHash,
  docByHashPrefix,
  docByThemeObjCode,
  reportByIncident,
  recentDocsByUser,
  teamByIncident,
  teamGidByIncident,
  verifyInsert,
} from "../src/verify.js";
import type { Db } from "../src/processor.js";

const INCIDENT_ID = "aaaaaaaa-bbbb-cccc-dddd-000000000001";

describe("query builders (read-only)", () => {
  it("reportByIncident", () => {
    const q = reportByIncident(INCIDENT_ID);
    expect(q.sql).toContain("FROM incident_report WHERE incident_id = $1");
    expect(q.params).toEqual([INCIDENT_ID]);
  });
  it("countByIncident parametriza a tabela", () => {
    expect(countByIncident("incident_vehicle", INCIDENT_ID).sql).toBe(
      "SELECT COUNT(*) FROM incident_vehicle WHERE incident_id = $1",
    );
  });
  it("docByHashPrefix adiciona %", () => {
    expect(docByHashPrefix("Signature").params).toEqual(["Signature%"]);
  });
  it("docByExactHash", () => {
    expect(docByExactHash("h.jpg").params).toEqual(["h.jpg"]);
  });
  it("recentDocsByUser usa $1/$2", () => {
    const q = recentDocsByUser(501, 5);
    expect(q.sql).toContain("user_id = $1");
    expect(q.sql).toContain("LIMIT $2");
    expect(q.params).toEqual([501, 5]);
  });
  it("teamGidByIncident / teamByIncident / docByThemeObjCode", () => {
    expect(teamGidByIncident(INCIDENT_ID).sql).toContain("SELECT gid FROM incident_team");
    expect(teamByIncident(INCIDENT_ID).params).toEqual([INCIDENT_ID]);
    const q = docByThemeObjCode(105, "123");
    expect(q.sql).toContain("theme_id = $1 AND obj_code = $2");
    expect(q.params).toEqual([105, "123"]);
  });
});

describe("verifyInsert", () => {
  it("agrega resultados usando o Db", async () => {
    const db: Db = {
      async query<T>(sql: string): Promise<T[]> {
        if (sql.includes("FROM incident_report")) return [{ gid: 1, incident_id: INCIDENT_ID }] as T[];
        if (sql.includes("FROM incident_team")) return [{ gid: 2 }] as T[];
        if (sql.includes("COUNT(*) FROM incident_party")) return [{ count: "3" }] as T[];
        if (sql.includes("COUNT(*) FROM incident_vehicle")) return [{ count: "2" }] as T[];
        if (sql.includes("COUNT(*) FROM incident_scene_flags")) return [{ count: "1" }] as T[];
        if (sql.includes("document_upload")) return [{ doc_id: 9 }] as T[];
        return [] as T[];
      },
    };
    const r = await verifyInsert(db, INCIDENT_ID, "Signature");
    expect(r.report).toMatchObject({ gid: 1 });
    expect(r.team).toMatchObject({ gid: 2 });
    expect(r.partyCount).toBe(3);
    expect(r.vehicleCount).toBe(2);
    expect(r.sceneFlagsCount).toBe(1);
    expect(r.document).toMatchObject({ doc_id: 9 });
  });
});
