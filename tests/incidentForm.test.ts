import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIncidentFormPlan, SCENE_BOOL_FIELDS } from "../src/incidentForm.js";
import { TasksSchema, type Task } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "..", "fixtures", "demo_backup");

function loadTasks(): Task[] {
  return TasksSchema.parse(JSON.parse(readFileSync(resolve(FIXTURE, "tasks.json"), "utf-8")));
}

const GEOM = "SRID=3857;POINT(-100000.5 200000.5)";
const INCIDENT_ID = "aaaaaaaa-bbbb-cccc-dddd-000000000001";

describe("buildIncidentFormPlan (fixture demo_backup)", () => {
  const plan = buildIncidentFormPlan(loadTasks(), {
    filesDir: resolve(FIXTURE, "files"),
    now: "NOW_FIXO",
  });

  it("gera 9 statements na ordem esperada", () => {
    expect(plan.map((s) => s.table)).toEqual([
      "incident_report",
      "incident_team",
      "incident_party",
      "incident_party",
      "incident_party",
      "incident_vehicle",
      "incident_vehicle",
      "incident_scene_flags",
      "document_upload",
    ]);
  });

  it("report tem geom EWKT, incident_id, done=true, area=0 e RETURNING gid", () => {
    const r = plan[0]!;
    expect(r.returning).toBe("gid");
    expect(r.values[r.fields.indexOf("geom")]).toBe(GEOM);
    expect(r.values[r.fields.indexOf("incident_id")]).toBe(INCIDENT_ID);
    expect(r.values[r.fields.indexOf("done")]).toBe(true);
    expect(r.values[r.fields.indexOf("area")]).toBe(0);
    expect(r.values[r.fields.indexOf("userid")]).toBe(501);
    // campo vazio no fixture ('notes') vira null
    expect(r.values[r.fields.indexOf("notes")]).toBeNull();
  });

  it("veiculos: party_number/vehicle_number viram int; plate vazio vira null", () => {
    const v0 = plan[5]!;
    const v1 = plan[6]!;
    expect(v0.values[v0.fields.indexOf("party_number")]).toBe(1);
    expect(v0.values[v0.fields.indexOf("vehicle_number")]).toBe(1);
    expect(v0.values[v0.fields.indexOf("plate")]).toBeNull();
    expect(v1.values[v1.fields.indexOf("party_number")]).toBe(2);
    expect(v1.values[v1.fields.indexOf("plate")]).toBe("FIC-2A22");
    expect(v0.values[v0.fields.indexOf("make")]).toBe("Fictional Motors");
  });

  it("cena: todos os bool_fields presentes; speed_limit vazio vira null", () => {
    const t = plan[7]!;
    expect(t.fields.length).toBe(3 + SCENE_BOOL_FIELDS.length + 8);
    expect(t.values.length).toBe(t.fields.length);
    expect(t.values[t.fields.indexOf("blocked_lane")]).toBe(true);
    expect(t.values[t.fields.indexOf("wet_surface")]).toBe(false);
    expect(t.values[t.fields.indexOf("speed_limit")]).toBeNull();
  });

  it("documento: hash_name = base + md5 + .jpg, obj_code placeholder em dry-run", () => {
    const d = plan[8]!;
    expect(d.values[d.fields.indexOf("hash_name")]).toBe(
      "Signature_Unit12-theme-100-theme-101_3fce4f057c4522116b2dabb6a69066ea.jpg",
    );
    expect(d.values[d.fields.indexOf("file_name")]).toBe(
      "Signature_Unit12-theme-100-theme-101",
    );
    expect(d.values[d.fields.indexOf("theme_id")]).toBe(105);
    expect(d.values[d.fields.indexOf("group_id")]).toBe(10);
    expect(d.values[d.fields.indexOf("obj_code")]).toBe("<ROOT_GID>");
    expect(d.values[d.fields.indexOf("date_time")]).toBe("NOW_FIXO");
  });

  it("aceita rootGid explícito p/ execução real", () => {
    const p2 = buildIncidentFormPlan(loadTasks(), {
      filesDir: resolve(FIXTURE, "files"),
      now: "NOW_FIXO",
      rootGid: 12345,
    });
    const d = p2[8]!;
    expect(d.values[d.fields.indexOf("obj_code")]).toBe(12345);
  });
});
