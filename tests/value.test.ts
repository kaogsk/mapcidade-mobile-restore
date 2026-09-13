import { describe, it, expect } from "vitest";
import {
  answerDepth,
  castValue,
  extractThemeId,
  geomEwkt,
  maybe,
  md5File,
  stripExt,
  toInt,
} from "../src/value.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "..", "fixtures", "demo_backup");

describe("maybe", () => {
  it("retorna null p/ vazio/None", () => {
    expect(maybe("")).toBeNull();
    expect(maybe(null)).toBeNull();
    expect(maybe(undefined)).toBeNull();
  });
  it("aplica cast quando dado", () => {
    expect(maybe("01", toInt)).toBe(1);
    expect(maybe("02", toInt)).toBe(2);
  });
  it("preserva valor sem cast", () => {
    expect(maybe("x")).toBe("x");
  });
  it("cast custom (ex.: campo texto que vira null quando vazio)", () => {
    const f = (x: unknown) => (x === "" ? null : x);
    expect(maybe("", f)).toBeNull();
    expect(maybe("FIC-2A22", f)).toBe("FIC-2A22");
  });
});

describe("geomEwkt", () => {
  it("monta EWKT web-mercator", () => {
    expect(geomEwkt([-100000.5, 200000.5])).toBe("SRID=3857;POINT(-100000.5 200000.5)");
  });
});

describe("castValue", () => {
  it("boolean", () => {
    expect(castValue(true, "boolean")).toBe(true);
    expect(castValue("true", "boolean")).toBe(true);
    expect(castValue("0", "boolean")).toBe(false);
  });
  it("integer trunca decimais", () => {
    expect(castValue("12.7", "integer")).toBe(12);
    expect(castValue("abc", "integer")).toBeNull();
  });
  it("numeric", () => {
    expect(castValue("3.14", "numeric")).toBe(3.14);
  });
  it("vazio vira null", () => {
    expect(castValue("", "text")).toBeNull();
    expect(castValue(null, "integer")).toBeNull();
  });
  it("texto default", () => {
    expect(castValue(42, "character varying")).toBe("42");
  });
});

describe("extractThemeId / answerDepth", () => {
  it("extrai o último theme id", () => {
    expect(extractThemeId("theme-100-theme-101_0")).toBe(101);
    expect(extractThemeId("theme-100")).toBe(100);
    expect(extractThemeId("theme-100-theme-102_1")).toBe(102);
  });
  it("profundidade", () => {
    expect(answerDepth("theme-100")).toBe(0);
    expect(answerDepth("theme-100-theme-101")).toBe(1);
    expect(answerDepth("theme-100-theme-102_0")).toBe(1);
  });
});

describe("stripExt / md5File", () => {
  it("remove última extensão", () => {
    expect(stripExt("a.jpg")).toBe("a");
    expect(stripExt("Signature_Unit12-theme-100-theme-101.jpg")).toBe(
      "Signature_Unit12-theme-100-theme-101",
    );
  });
  it("md5 do arquivo de amostra bate com o esperado", () => {
    const md5 = md5File(
      resolve(FIXTURE, "files", "Signature_Unit12-theme-100-theme-101.jpg"),
    );
    expect(md5).toBe("3fce4f057c4522116b2dabb6a69066ea");
  });
});
