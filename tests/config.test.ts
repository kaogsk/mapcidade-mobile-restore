import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPgParams, extractHost, listDatabases } from "../src/config.js";

describe("buildPgParams", () => {
  it("decodifica credenciais url-encoded", () => {
    const p = buildPgParams("postgresql://postgres:Postgres%211%402%233@203.0.113.10:5432/rivermeadow");
    expect(p).toEqual({
      host: "203.0.113.10",
      port: 5432,
      user: "postgres",
      password: "Postgres!1@2#3",
      database: "rivermeadow",
    });
  });
  it("porta default 5432", () => {
    const p = buildPgParams("postgresql://u:p@host/db");
    expect(p.port).toBe(5432);
  });
});

describe("extractHost", () => {
  it("extrai hostname", () => {
    expect(extractHost("postgresql://u:p@203.0.113.1:5432/db")).toBe("203.0.113.1");
  });
});

describe("listDatabases", () => {
  it("ignora disabled e servidores sem postgresql://", () => {
    const cfg = {
      mcpServers: {
        ativo: {
          command: "npx",
          args: ["-y", "srv", "postgresql://u:p@203.0.113.9:5432/ativo"],
        },
        desligado: {
          command: "npx",
          args: ["postgresql://u:p@203.0.113.8:5432/x"],
          disabled: true,
        },
        semconn: { command: "uvx", args: ["algo", "stdio"] },
      },
    };
    const p = join(tmpdir(), `db_config_test_${String(Date.now())}.json`);
    writeFileSync(p, JSON.stringify(cfg), "utf-8");
    const dbs = listDatabases(p);
    expect(dbs).toHaveLength(1);
    expect(dbs[0]).toMatchObject({ name: "ativo", host: "203.0.113.9" });
  });
});
