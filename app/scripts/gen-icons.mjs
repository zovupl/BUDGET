// Генерирует иконки приложения: 💰 на фиолетовом градиенте.
// Запуск: npm run icons
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../public/icons/", import.meta.url);
const EMOJI_URL = "https://cdn.jsdelivr.net/gh/twitter/twemoji@v14.0.2/assets/svg/1f4b0.svg";

const bg = (size) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="55%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#d946ef"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
</svg>`);

async function build(size, name, scale) {
  const res = await fetch(EMOJI_URL);
  if (!res.ok) throw new Error("не удалось скачать эмодзи: " + res.status);
  const svg = Buffer.from(await res.arrayBuffer());
  const inner = Math.round(size * scale);
  const emoji = await sharp(svg, { density: 600 }).resize(inner, inner).png().toBuffer();
  const png = await sharp(bg(size))
    .composite([{ input: emoji, top: Math.round((size - inner) / 2), left: Math.round((size - inner) / 2) }])
    .png()
    .toBuffer();
  await writeFile(new URL(name, OUT), png);
  console.log("✓", name, size + "px");
}

await mkdir(OUT, { recursive: true });
await build(192, "icon-192.png", 0.62);
await build(512, "icon-512.png", 0.62);
await build(180, "apple-touch-icon.png", 0.62);
await build(512, "icon-maskable-512.png", 0.5); // запас по краям для маски Android
