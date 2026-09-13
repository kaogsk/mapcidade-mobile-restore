import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import "dotenv/config";
import { listDatabases } from "./config.js";
import { buildIncidentFormPlan } from "./incidentForm.js";
import { runBackup } from "./runBackup.js";
import { previewPlan } from "./sql.js";
import { TasksSchema } from "./types.js";

/**
 * CLI do mapcidade-mobile-restore. Dry-run é o padrão.
 *
 *   npm run dev -- --backup <pasta> --incident-form      # plano offline (sem banco)
 *   npm run dev -- --backup <pasta> --db <nome>          # dry-run genérico (lê schema)
 *   npm run dev -- --backup <pasta> --db <nome> --execute --confirm EXECUTAR
 */

interface Args {
  backup?: string;
  db?: string;
  conn?: string;
  execute: boolean;
  confirm?: string;
  incidentForm: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { execute: false, incidentForm: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--backup") a.backup = argv[++i];
    else if (v === "--db") a.db = argv[++i];
    else if (v === "--conn") a.conn = argv[++i];
    else if (v === "--confirm") a.confirm = argv[++i];
    else if (v === "--execute") a.execute = true;
    else if (v === "--incident-form") a.incidentForm = true;
    else if (v === "--json") a.json = true;
  }
  return a;
}

function resolveConn(args: Args): string {
  if (args.conn) return args.conn;
  if (args.db) {
    const cfgPath = process.env.DB_CONFIG
      ? resolve(process.env.DB_CONFIG)
      : resolve(process.cwd(), "configs", "databases.json");
    const dbs = listDatabases(cfgPath);
    const found = dbs.find((d) => d.name === args.db);
    if (!found) throw new Error(`banco '${args.db}' não encontrado/ativo em ${cfgPath}`);
    return found.conn_str;
  }
  throw new Error("informe --db <nome> ou --conn <postgresql://...>");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.backup) throw new Error("informe --backup <pasta do backup>");
  const backup = resolve(args.backup);

  // Caminho offline determinístico (não conecta ao banco).
  if (args.incidentForm) {
    const tasks = TasksSchema.parse(
      JSON.parse(readFileSync(resolve(backup, "tasks.json"), "utf-8")),
    );
    const plan = buildIncidentFormPlan(tasks, {
      filesDir: resolve(backup, "files"),
      now: "NOW()",
    });
    if (args.json) console.log(JSON.stringify(plan, null, 2));
    else console.log(previewPlan(plan));
    console.log(`\n${plan.length} INSERTs montados (dry-run, nada foi escrito).`);
    return;
  }

  if (args.execute && args.confirm !== "EXECUTAR") {
    throw new Error('execução real exige --confirm EXECUTAR (senão roda em dry-run)');
  }

  const connStr = resolveConn(args);
  const { logs, plan } = await runBackup(connStr, backup, { execute: args.execute });
  console.log(logs.join("\n"));
  if (args.json) console.log(JSON.stringify(plan, null, 2));
}

main().catch((e: unknown) => {
  console.error(`ERRO: ${(e as Error).message}`);
  process.exit(1);
});
