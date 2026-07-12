# Budget App — правила проекта

## ПРАВИЛО №1 (соблюдать всегда)

Каждый раз при внесении **любых** правок в приложение Budget:

1. Сохранить новую версию каждого изменённого файла в папку `versions/` с датой в имени:
   `versions/app_2026-07-12.jsx`, `versions/firebase_2026-07-12.js` и т. д.
2. Дописать запись в `CHANGELOG.md`: дата + краткое описание изменения.

Это правило действует во всех будущих сессиях.

## Что это за проект

PWA семейного бюджета для Мити и Марины (Польша). Валюта — злотые (zł), долг — в евро (€),
интерфейс только на русском.

- **Код приложения:** `app/` (Vite + React + Tailwind)
- **База данных:** Firebase Realtime Database, проект `family-budget-18a4c`, один узел `/budget`
- **Хостинг:** GitHub Pages, репозиторий `zovupl/BUDGET` → https://zovupl.github.io/BUDGET/
- **Деплой:** автоматически при `git push` в ветку `main` (GitHub Actions, `.github/workflows/deploy.yml`)
- **Прототип-основа:** `family-budget-v2.jsx` (историческая справка, в сборку не входит)

## Структура данных в Firebase (`/budget`)

```
people[]        — профили: id, name, avatar (base64, 120px), color
categories      — { income: [...], expense: [...] }, у категории: id, emoji, label, color
transactions    — объект { id: {id, type, personId, category, amount, note, date} }
debtTotal       — число, общий долг в €
debtPayments    — объект { id: {id, amount, personId, date} }
```

Списки (`transactions`, `debtPayments`) хранятся объектами, а не массивами, и пишутся
по отдельным путям — чтобы одновременные записи с двух телефонов не затирали друг друга.

## Команды

```bash
cd app
npm install      # установить зависимости
npm run dev      # локальный запуск
npm run build    # проверить сборку
npm run icons    # перегенерировать иконки PWA
```
