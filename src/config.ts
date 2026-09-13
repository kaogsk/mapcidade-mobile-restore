import { existsSync, readFileSync } from "node:fs";

/**
 * Porte de load_mcp_config / list_databases / _build_psycopg2_params.
 * Lê o mcp_config.json central e extrai as conexões postgresql:// dos args.
 */

export interface McpServerCfg {
  command?: string;
  args?: string[];
  disabled?: boolean;
}

export interface DatabaseEntry {
  name: string;
  conn_str: string;
  host: string;
}

export interface PgParams {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function loadMcpConfig(configPath: string): { mcpServers?: Record<string, McpServerCfg> } {
  if (!existsSync(configPath)) {
    throw new Error(`mcp_config.json não encontrado: ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as {
    mcpServers?: Record<string, McpServerCfg>;
  };
}

export function extractHost(connStr: string): string {
  return new URL(connStr).hostname;
}

/** Lista bancos ativos (não-disabled) com string de conexão postgresql://. */
export function listDatabases(configPath: string): DatabaseEntry[] {
  const cfg = loadMcpConfig(configPath);
  const result: DatabaseEntry[] = [];
  for (const [name, server] of Object.entries(cfg.mcpServers ?? {})) {
    if (server.disabled) continue;
    const connStr = (server.args ?? []).find((a) => a.startsWith("postgresql://"));
    if (connStr) {
      result.push({ name, conn_str: connStr, host: extractHost(connStr) });
    }
  }
  return result;
}

/** Converte a conn_str postgresql:// nos parâmetros do node-postgres. */
export function buildPgParams(connStr: string): PgParams {
  const u = new URL(connStr);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}
