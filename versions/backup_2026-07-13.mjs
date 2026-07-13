// Резервная копия базы: скачивает весь узел /budget в папку backups/ с датой в имени.
// Запуск вручную: npm run backup   (автоматически — раз в 3 дня, задание Windows)
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";

const DB = "https://family-budget-18a4c-default-rtdb.europe-west1.firebasedatabase.app/budget.json";
const OUT = new URL("../../backups/", import.meta.url);
const KEEP = 30; // сколько последних копий хранить

const res = await fetch(DB);
if (!res.ok) throw new Error("не удалось скачать базу: " + res.status);
const data = await res.json();

if (!data || !data.transactions) {
  console.error("База пустая или недоступна — копия НЕ сделана (старую не трогаем).");
  process.exit(1);
}

const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;

await mkdir(OUT, { recursive: true });
await writeFile(new URL(`budget_${stamp}.json`, OUT), JSON.stringify(data, null, 2), "utf8");

// оставляем только последние KEEP копий
const files = (await readdir(OUT)).filter((f) => f.startsWith("budget_")).sort();
for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
  await unlink(new URL(f, OUT));
}

const tx = Object.keys(data.transactions || {}).length;
const pay = Object.keys(data.debtPayments || {}).length;
console.log(`Копия сохранена: backups/budget_${stamp}.json — операций: ${tx}, платежей по долгу: ${pay}`);
