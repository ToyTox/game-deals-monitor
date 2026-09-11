#!/usr/bin/env node
/**
 * Подготовка проекта к запуску. Выполняется автоматически на `npm install`
 * (хук postinstall) и вручную через `npm run setup`.
 *
 * Шаги:
 *   1. создать .env из .env.example, если его ещё нет;
 *   2. сгенерировать Prisma-клиент в src/generated/prisma;
 *   3. применить миграции (пропускается при SKIP_DB_MIGRATE=1 — например, в сборке Docker-образа).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(step, args) {
  console.log(`\n▶ ${step}`);
  const result = spawnSync("npx", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\n✖ Шаг «${step}» завершился с ошибкой.`);
    process.exit(result.status ?? 1);
  }
}

const env = resolve(root, ".env");
const envExample = resolve(root, ".env.example");

if (existsSync(env)) {
  console.log("▶ .env уже есть — оставляю как есть");
} else if (existsSync(envExample)) {
  copyFileSync(envExample, env);
  console.log("▶ .env создан из .env.example");
} else {
  console.log("▶ .env.example не найден — пропускаю создание .env");
}

run("prisma generate", ["prisma", "generate"]);

if (process.env.SKIP_DB_MIGRATE === "1") {
  console.log("\n▶ SKIP_DB_MIGRATE=1 — миграции пропущены");
} else {
  run("prisma migrate deploy", ["prisma", "migrate", "deploy"]);
}

console.log("\n✔ Готово. Дальше: npm run dev\n");
