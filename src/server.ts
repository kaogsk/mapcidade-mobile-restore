import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express, { type Request, type Response } from "express";
import "dotenv/config";
import { listDatabases } from "./config.js";
import { runBackup } from "./runBackup.js";
import { queryStr } from "./util/str.js";

/**
 * Porte de app.py (Flask) para Express 5.
 * DIFERENÇA DE SEGURANÇA em relação ao legado: o /api/process do Flask
 * executava INSERTs reais sempre. Aqui o padrão é DRY-RUN; só executa com
 * execute:true + confirm:"EXECUTAR", validado ANTES de conectar ao banco.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const STATIC_DIR = join(PROJECT_ROOT, "static");
const BACKUP_ROOT = join(PROJECT_ROOT, "fixtures");

const DEFAULT_DB_CONFIG = resolve(PROJECT_ROOT, "configs", "databases.json");
const DB_CONFIG = process.env.DB_CONFIG ? resolve(process.env.DB_CONFIG) : DEFAULT_DB_CONFIG;

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(join(STATIC_DIR, "index.html"));
  });

  app.get("/api/municipalities", (_req: Request, res: Response) => {
    try {
      res.json(listDatabases(DB_CONFIG));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/backups", (_req: Request, res: Response) => {
    const items: { name: string; path: string }[] = [];
    for (const entry of readdirSync(BACKUP_ROOT)) {
      const full = join(BACKUP_ROOT, entry);
      if (statSync(full).isDirectory() && existsSync(join(full, "tasks.json"))) {
        items.push({ name: entry, path: full });
      }
    }
    items.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    res.json(items);
  });

  app.post("/api/process", (req: Request, res: Response) => {
    void (async () => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const connStr = queryStr(body["conn_str"]);
      const backupPath = queryStr(body["backup_path"]);
      const sshUser = queryStr(body["ssh_user"]);
      const sshPassword = queryStr(body["ssh_password"]);
      const execute = body["execute"] === true;
      const confirm = queryStr(body["confirm"]);

      if (!connStr || !backupPath) {
        res.status(400).json({ error: "conn_str and backup_path required" });
        return;
      }

      // GUARD de escrita: execução real exige confirmação explícita.
      if (execute && confirm !== "EXECUTAR") {
        res.status(409).json({
          error: 'Execução real exige confirm:"EXECUTAR". Sem isso, rode em dry-run (execute:false).',
        });
        return;
      }

      try {
        const { logs, plan } = await runBackup(connStr, backupPath, {
          execute,
          sshUser,
          sshPassword,
        });
        res.json({ mode: execute ? "execute" : "dry-run", logs, plan });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    })();
  });

  return app;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 5050);
  createApp().listen(port, () => {
    console.log(`mapcidade-mobile-restore em http://localhost:${String(port)} (dry-run por padrão)`);
  });
}
