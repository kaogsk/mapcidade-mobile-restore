# mapcidade-mobile-restore

> Anonymized, from-scratch reconstruction of a real internal tool's architecture, built for a portfolio. Fictional data only ("MapCidade" / Rivermeadow) — no real company, city, or infrastructure is represented here.

## English

### Problem

When a mobile device loses sync, or a field record needs to be recovered from a local backup (`tasks.json` + photos), restoring it by hand means building the correct INSERTs for every table/theme involved, handling special fields (geometry, types, files), and re-uploading each photo separately to the city's server — a manual process, error-prone at every step, and risky because it touches production directly.

### Solution

An automation reads the backup's structure, resolves the destination schema (either via the database's own data dictionary, or a deterministic path for one well-known fixed form), builds the full INSERT plan plus the attachment upload, and only executes for real with explicit confirmation — dry-run by default, always showing what would happen first.

### Stack

TypeScript core: `zod` for backup validation, `pg` for the database, `ssh2-sftp-client` for attachment upload, Express for the web UI, a plain CLI. 43 vitest tests.

### How to run

```bash
npm install
npm run build

# Deterministic offline plan (no database needed):
npm run dev -- --backup fixtures/demo_backup --incident-form

# Generic dry-run (reads schema via `theme` + information_schema — needs a real database):
npm run dev -- --backup fixtures/demo_backup --db <name>

# Real execution (writes!) — requires confirmation:
npm run dev -- --backup fixtures/demo_backup --db <name> --execute --confirm EXECUTAR

# Web UI (port 5050):
npm run serve
```

### Demo

Terminal walkthrough — `npm run dev -- --backup fixtures/demo_backup --incident-form` prints the 9-statement plan for the seeded fictional "Street Incident Report" backup, entirely offline; a recorded GIF will be linked here.

### Two insert paths, on purpose

- **`incidentForm.ts`** — a deterministic, hardcoded inserter for one specific, well-known mobile form. It's a pure function: tasks in, plan out, no database round-trip — which is exactly what makes it the thing you can validate offline, byte-for-byte, against a fixture. This mirrors a real trade-off: a hardcoded path is faster and needs no schema lookup, at the cost of only working for that one form.
- **`processor.ts`** — the generic path. It resolves each theme's table and columns by querying `theme` + `information_schema.columns` at runtime, so it works for *any* mobile form without code changes, but it can only be tested against a fake `Db` (or a real one), never fully offline.

Both produce the same kind of `Plan` (an ordered list of INSERT statements) and go through the same dry-run/execute gate.

### What I learned / engineering decisions

The safety guard exists because the original Flask endpoint always executed real INSERTs — the TypeScript port's `execute:true` + `confirm:"EXECUTAR"` gate, checked *before* opening any database connection, is a deliberate hardening over the legacy behavior, not a straight port.

A real Windows bug, found only by actually running the server (not by the test suite): the CLI-entrypoint guard used a raw string comparison (`import.meta.url === \`file://${process.argv[1]}\``), which never matches on Windows because of path separator/encoding differences — the server silently never called `.listen()`. Fixed with `pathToFileURL()`, which normalizes both sides. Same fix already applied preventively in a sibling project in this portfolio (`mapcidade-lockdown-audit`) — worth checking for anywhere else this pattern appears.

The deterministic form in this repo is a fictional "Street Incident Report" (team, up to three involved parties, up to two vehicles, a scene checklist, one photo attachment) — a stand-in for a real client's much larger, government-specific incident-report form that this code was originally hardcoded against. The shape (fixed hierarchy of sub-forms, one boolean-heavy checklist table, one attachment table) is the real design decision worth preserving; the exact fields of a specific government form are not.

## Português

### Problema

Quando um dispositivo mobile perde sincronização, ou um registro de campo precisa ser recuperado a partir de um backup local (`tasks.json` + fotos), restaurar isso na mão significa montar os INSERTs corretos para cada tabela/tema envolvido, tratar campos especiais (geometria, tipos, arquivos) e ainda subir cada foto separadamente pro servidor da cidade — um processo manual, sujeito a erro em cada etapa e arriscado por mexer direto em produção.

### Solução

Uma automação lê a estrutura do backup, resolve o schema de destino (via o dicionário de dados do próprio banco, ou um caminho determinístico pra um único formulário fixo bem conhecido), monta o plano completo de INSERTs e o upload de anexos, e só executa de fato com confirmação explícita — dry-run por padrão, sempre mostrando o que aconteceria antes.

### Stack

Núcleo TypeScript: `zod` pra validar o backup, `pg` pro banco, `ssh2-sftp-client` pro upload de anexo, Express pra UI web, CLI simples. 43 testes vitest.

### Como rodar

```bash
npm install
npm run build

# Plano offline determinístico (não precisa de banco):
npm run dev -- --backup fixtures/demo_backup --incident-form

# Dry-run genérico (lê o schema via `theme` + information_schema — precisa de banco real):
npm run dev -- --backup fixtures/demo_backup --db <nome>

# Execução real (escreve!) — exige confirmação:
npm run dev -- --backup fixtures/demo_backup --db <nome> --execute --confirm EXECUTAR

# Interface web (porta 5050):
npm run serve
```

### Dois caminhos de inserção, de propósito

- **`incidentForm.ts`** — inserter determinístico, fixo pra um único formulário mobile bem conhecido. É função pura: tasks entram, plano sai, sem ida e volta ao banco — exatamente o que permite validar offline, byte a byte, contra uma fixture. Espelha um trade-off real: um caminho fixo é mais rápido e não precisa de consulta de schema, ao custo de só funcionar pra aquele formulário.
- **`processor.ts`** — caminho genérico. Resolve tabela e colunas de cada tema consultando `theme` + `information_schema.columns` em tempo real, então funciona pra *qualquer* formulário mobile sem mudar código, mas só é testável contra um `Db` fake (ou um real), nunca totalmente offline.

Os dois produzem o mesmo tipo de `Plan` (lista ordenada de INSERTs) e passam pelo mesmo gate de dry-run/execute.

### O que aprendi / decisões de engenharia

O guard de segurança existe porque o endpoint Flask original sempre executava INSERTs reais — o gate `execute:true` + `confirm:"EXECUTAR"` da versão TS, checado *antes* de abrir qualquer conexão com o banco, é um reforço deliberado sobre o comportamento legado, não uma porta 1:1.

Um bug real de Windows, achado só ao rodar o servidor de verdade (não pela suíte de teste): o guard de entrypoint da CLI usava comparação de string crua (`import.meta.url === \`file://${process.argv[1]}\``), que nunca bate no Windows por diferença de separador/encoding de caminho — o servidor nunca chamava `.listen()`, silenciosamente. Corrigido com `pathToFileURL()`, que normaliza os dois lados. Mesmo fix já aplicado preventivamente num projeto irmão deste portfolio (`mapcidade-lockdown-audit`) — vale checar se aparece em mais algum lugar.

O formulário determinístico deste repo é um "Relatório de Incidente de Rua" fictício (equipe, até três envolvidos, até dois veículos, uma checklist de cena, um anexo de foto) — no lugar do formulário de ocorrência muito maior e específico de um órgão público real de um cliente, contra o qual esse código originalmente era fixo. O formato (hierarquia fixa de sub-formulários, uma tabela de checklist cheia de booleanos, uma tabela de anexo) é a decisão de design real que vale preservar; os campos exatos de um formulário governamental específico, não.
