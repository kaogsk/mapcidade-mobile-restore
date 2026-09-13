import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((res) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${String(port)}`;
      res();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

async function post(body: unknown) {
  const r = await fetch(`${base}/api/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

describe("guard de escrita em /api/process", () => {
  it("400 sem conn_str/backup_path", async () => {
    const { status } = await post({});
    expect(status).toBe(400);
  });

  it("409 quando execute:true sem confirm EXECUTAR (antes de conectar)", async () => {
    const { status, json } = await post({
      conn_str: "postgresql://u:p@203.0.113.254:5432/x",
      backup_path: "/nao/importa",
      execute: true,
    });
    expect(status).toBe(409);
    expect(String(json.error)).toContain("EXECUTAR");
  });

  it("409 quando execute:true com confirm errado", async () => {
    const { status } = await post({
      conn_str: "postgresql://u:p@203.0.113.254:5432/x",
      backup_path: "/nao/importa",
      execute: true,
      confirm: "sim",
    });
    expect(status).toBe(409);
  });
});

describe("/api/municipalities", () => {
  it("responde JSON (lista ou erro estruturado)", async () => {
    const r = await fetch(`${base}/api/municipalities`);
    expect([200, 500]).toContain(r.status);
    const body: unknown = await r.json();
    expect(body === null || typeof body === "object").toBe(true);
  });
});
