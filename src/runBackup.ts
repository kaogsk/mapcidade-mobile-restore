import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TasksSchema, type Plan } from "./types.js";
import { extractHost } from "./config.js";
import { PgDb, makeSftpUploader } from "./db.js";
import { processTask, type Uploader } from "./processor.js";

/**
 * Orquestrador (porte de process_backup) — lê tasks.json, conecta no banco e
 * processa cada task com o processador genérico.
 *
 * SEGURANÇA: execute é false por padrão (dry-run). Só escreve/faz upload quando
 * execute:true. Em execute cada task roda numa transação (commit/rollback).
 */
export interface RunBackupOptions {
  execute?: boolean;
  sshUser?: string;
  sshPassword?: string;
  now?: unknown;
}

export interface RunBackupResult {
  logs: string[];
  plan: Plan;
}

export async function runBackup(
  connStr: string,
  backupPath: string,
  opts: RunBackupOptions = {},
): Promise<RunBackupResult> {
  const logs: string[] = [];
  const plan: Plan = [];
  const execute = opts.execute ?? false;
  const now = opts.now ?? new Date();

  const tasksFile = join(backupPath, "tasks.json");
  const filesDir = join(backupPath, "files");

  if (!existsSync(tasksFile)) {
    return { logs: [`ERROR: tasks.json not found in ${backupPath}`], plan };
  }

  const tasks = TasksSchema.parse(JSON.parse(readFileSync(tasksFile, "utf-8")));
  const host = extractHost(connStr);

  logs.push(`Mode: ${execute ? "EXECUTE (escreve no banco)" : "DRY-RUN (sem escrita)"}`);
  logs.push(`Backup: ${backupPath}`);
  logs.push(`Tasks: ${tasks.length}`);

  let db: PgDb;
  try {
    db = await PgDb.connect(connStr);
  } catch (e) {
    logs.push(`DB CONNECTION ERROR: ${(e as Error).message}`);
    return { logs, plan };
  }

  const uploader: Uploader | undefined =
    execute && opts.sshUser
      ? makeSftpUploader(host, opts.sshUser, opts.sshPassword ?? "")
      : undefined;

  try {
    for (let i = 0; i < tasks.length; i++) {
      logs.push(`\n--- Task ${i + 1}/${tasks.length} ---`);
      const task = tasks[i]!;
      try {
        if (execute) await db.query("BEGIN");
        const res = await processTask(db, task, { filesDir, now, execute, uploader, host });
        plan.push(...res.plan);
        logs.push(...res.logs);
        if (execute) {
          await db.query("COMMIT");
          logs.push("  COMMIT OK");
        }
      } catch (e) {
        if (execute) await db.query("ROLLBACK");
        logs.push(`  ERROR: ${(e as Error).message}`);
        if (execute) logs.push("  ROLLBACK");
      }
    }
  } finally {
    await db.close();
  }

  return { logs, plan };
}
