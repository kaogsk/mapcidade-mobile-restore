import { Client } from "pg";
import SftpClient from "ssh2-sftp-client";
import type { Db, Uploader } from "./processor.js";
import { buildPgParams } from "./config.js";

/**
 * Adaptador de banco baseado em node-postgres (substitui psycopg2).
 * Uso read-only nas verificações e no dry-run; escrita só no modo execute.
 */
export class PgDb implements Db {
  private constructor(private readonly client: Client) {}

  static async connect(connStr: string): Promise<PgDb> {
    const client = new Client(buildPgParams(connStr));
    await client.connect();
    return new PgDb(client);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(sql, params);
    return res.rows as T[];
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

/**
 * Uploader SFTP (substitui paramiko sftp.put). Fecha a conexão ao final.
 * Usado só no modo execute — nunca em dry-run.
 */
export function makeSftpUploader(host: string, user: string, password: string): Uploader {
  return async (localPath, remoteDir, remoteName) => {
    const remotePath = `${remoteDir}/${remoteName}`;
    const sftp = new SftpClient();
    await sftp.connect({ host, port: 22, username: user, password });
    try {
      await sftp.put(localPath, remotePath);
      const stat = await sftp.stat(remotePath);
      return { size: stat.size };
    } finally {
      await sftp.end();
    }
  };
}
