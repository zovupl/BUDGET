// Восстановление базы из резервной копии — ЗАМЕНЯЕТ всё содержимое /budget.
// Запуск: npm run restore -- budget_2026-07-13_14-30.json
// Без имени файла берёт самую свежую копию и только показывает, что в ней (ничего не меняя).
import { readdir, readFile } from "node:fs/promises";

const DB = "https://family-budget-18a4c-default-rtdb.europe-west1.firebasedatabase.app/budget.json";
const DIR = new URL("../../backups/", import.meta.url);

const arg = process.argv[2];
const files = (await readdir(DIR)).filter((f) => f.startsWith("budget_")).sort();
if (!files.length) { console.error("В папке backups/ нет копий."); process.exit(1); }

const file = arg || files[files.length - 1];
const data = JSON.parse(await readFile(new URL(file, DIR), "utf8"));
const tx = Object.keys(data.transactions || {}).length;
const pay = Object.keys(data.debtPayments || {}).length;

if (!arg) {
  console.log(`Самая свежая копия: ${file} — операций: ${tx}, платежей по долгу: ${pay}`);
  console.log(`Чтобы восстановить её в базу: npm run restore -- ${file}`);
  console.log("(Это ЗАМЕНИТ все текущие данные в базе на данные из копии.)");
  process.exit(0);
}

const res = await fetch(DB, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
if (!res.ok) throw new Error("не удалось записать в базу: " + res.status);

console.log(`База восстановлена из ${file} — операций: ${tx}, платежей по долгу: ${pay}`);
