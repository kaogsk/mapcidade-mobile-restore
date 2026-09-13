import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Answer, Plan, Task } from "./types.js";
import { buildInsert } from "./sql.js";
import { geomEwkt, maybe, md5File, stripExt, toInt } from "./value.js";

/**
 * Inserter DETERMINÍSTICO para um formulário fixo — a versão hardcoded pra um
 * único formulário mobile bem conhecido ("Street Incident Report"), em vez do
 * caminho genérico (processor.ts) que descobre o schema via banco.
 *
 * É uma função PURA: recebe as tasks + opções e devolve o PLANO de INSERTs
 * (lista de statements), SEM conectar/escrever no banco.
 */

export interface IncidentFormOptions {
  /** pasta `files/` do backup (para computar o md5/hash_name do documento). */
  filesDir: string;
  /** caminho remoto dos documentos. */
  docPath?: string;
  /** timestamp usado em date_time/insertdate (ex.: "NOW()" ou uma string fixa em teste). */
  now: unknown;
  /** valor de obj_code no doc; em dry-run usa '<ROOT_GID>'. */
  rootGid?: unknown;
}

const DEFAULT_DOC_PATH = "/opt/mapcidade/documents";

/** Lista verbatim dos campos booleanos de incident_scene_flags. */
export const SCENE_BOOL_FIELDS: readonly string[] = [
  "blocked_lane", "wet_surface", "night_time", "poor_lighting", "heavy_traffic",
  "construction_zone", "school_zone", "intersection", "curve", "roundabout",
  "signal_present", "speed_limit_posted", "damage_minor", "damage_major",
  "injuries_reported", "tow_required",
];

function get(a: Answer | undefined, key: string): unknown {
  return a ? a[key] : undefined;
}

/**
 * Monta o plano de INSERTs do "Street Incident Report" a partir da primeira
 * task do backup. Ordem fixa: incident_report → incident_team → 3× incident_party
 * → 2× incident_vehicle → incident_scene_flags → document_upload.
 */
export function buildIncidentFormPlan(tasks: Task[], opts: IncidentFormOptions): Plan {
  const task = tasks[0];
  if (!task) throw new Error("tasks.json vazio");

  const answers = task.send.answers;
  const files = task.files ?? {};
  const docPath = opts.docPath ?? DEFAULT_DOC_PATH;

  const aMain = answers["theme-100"] ?? {};
  const aTeam = answers["theme-100-theme-101"] ?? {};
  const aParty0 = answers["theme-100-theme-102"] ?? {};
  const aParty1 = answers["theme-100-theme-102_0"] ?? {};
  const aParty2 = answers["theme-100-theme-102_1"] ?? {};
  const aFlags = answers["theme-100-theme-104"] ?? {};
  const aVeh0 = answers["theme-100-theme-103"] ?? {};
  const aVeh1 = answers["theme-100-theme-103_0"] ?? {};

  const incidentId = get(aMain, "incident_id");
  const reportNumber = get(aMain, "report_number");
  const geomPt = get(aMain, "geom") as [number, number];
  const geom = geomEwkt(geomPt);

  const plan: Plan = [];

  // ── 1. incident_report ───────────────────────────────────────────────────
  plan.push(
    buildInsert(
      "incident_report",
      [
        "geom", "incident_id", "report_number", "unit_number", "filed_at",
        "occurred_at", "nature", "address", "neighborhood", "city", "notes",
        "userid", "done", "area",
      ],
      [
        geom, incidentId, reportNumber,
        maybe(get(aMain, "unit_number")),
        maybe(get(aMain, "filed_at")),
        maybe(get(aMain, "occurred_at")),
        maybe(get(aMain, "nature")),
        maybe(get(aMain, "address")),
        maybe(get(aMain, "neighborhood")),
        maybe(get(aMain, "city")),
        maybe(get(aMain, "notes")),
        task.userId,
        true,
        0,
      ],
      "gid",
    ),
  );

  // ── 2. incident_team ─────────────────────────────────────────────────────
  plan.push(
    buildInsert(
      "incident_team",
      ["geom", "incident_id", "report_number", "role", "badge_number", "callsign", "area"],
      [
        geom, incidentId, reportNumber,
        maybe(get(aTeam, "role")),
        maybe(get(aTeam, "badge_number")),
        maybe(get(aTeam, "callsign")),
        0,
      ],
      "gid",
    ),
  );

  // ── 3. incident_party × 3 ────────────────────────────────────────────────
  for (const aParty of [aParty0, aParty1, aParty2]) {
    plan.push(
      buildInsert(
        "incident_party",
        [
          "geom", "incident_id", "report_number", "role", "full_name",
          "document_id", "birth_date", "phone", "address", "area",
        ],
        [
          geom, incidentId, reportNumber,
          maybe(get(aParty, "role")),
          maybe(get(aParty, "full_name")),
          maybe(get(aParty, "document_id")),
          maybe(get(aParty, "birth_date")),
          maybe(get(aParty, "phone")),
          maybe(get(aParty, "address")),
          0,
        ],
      ),
    );
  }

  // ── 4. incident_vehicle × 2 ──────────────────────────────────────────────
  for (const aVeh of [aVeh0, aVeh1]) {
    plan.push(
      buildInsert(
        "incident_vehicle",
        [
          "geom", "incident_id", "report_number", "party_number", "vehicle_number",
          "plate", "make", "model", "color", "area",
        ],
        [
          geom, incidentId, reportNumber,
          maybe(get(aVeh, "party_number"), toInt),
          maybe(get(aVeh, "vehicle_number"), toInt),
          maybe(get(aVeh, "plate"), (x) => (x === "" ? null : x)),
          maybe(get(aVeh, "make")),
          maybe(get(aVeh, "model")),
          maybe(get(aVeh, "color")),
          0,
        ],
      ),
    );
  }

  // ── 5. incident_scene_flags ──────────────────────────────────────────────
  const flagsFields = [
    "geom", "incident_id", "area",
    ...SCENE_BOOL_FIELDS,
    "assisted_victim", "officer_dispatched", "scene_orientation", "evaded_scene",
    "speed_limit", "cleanup_by", "unit_callsign", "examiner_name",
  ];
  const flagsValues: unknown[] = [
    geom, incidentId, 0,
    ...SCENE_BOOL_FIELDS.map((f) => Boolean(get(aFlags, f) ?? false)),
    maybe(get(aFlags, "assisted_victim")),
    maybe(get(aFlags, "officer_dispatched")),
    maybe(get(aFlags, "scene_orientation")),
    maybe(get(aFlags, "evaded_scene")),
    maybe(get(aFlags, "speed_limit")),
    maybe(get(aFlags, "cleanup_by")),
    maybe(get(aFlags, "unit_callsign")),
    maybe(get(aFlags, "examiner_name")),
  ];
  plan.push(buildInsert("incident_scene_flags", flagsFields, flagsValues));

  // ── 6. document_upload ───────────────────────────────────────────────────
  const fileEntry = files["theme-100-theme-101"]?.[0];
  if (fileEntry) {
    const localFile = join(opts.filesDir, fileEntry.fileName);
    const baseName = stripExt(fileEntry.fileName);
    const md5 = existsSync(localFile) ? md5File(localFile) : "HASH_PENDING";
    const hashName = `${baseName}_${md5}.jpg`;
    const objCode = opts.rootGid ?? "<ROOT_GID>";

    plan.push(
      buildInsert(
        "document_upload",
        [
          "theme_id", "obj_code", "user_id", "doc_status",
          "file_name", "hash_name", "extension", "path", "doc_type",
          "group_id", "date_time", "insertdate",
        ],
        [
          105,
          objCode,
          task.userId,
          1,
          baseName,
          hashName,
          ".jpg",
          docPath,
          1,
          10,
          opts.now,
          opts.now,
        ],
      ),
    );
  }

  return plan;
}
