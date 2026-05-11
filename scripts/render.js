// Render HTML carousel to 1080x1350 PNG slides via Puppeteer.
//
// Usage:
//   node scripts/render.js                       # render today's post
//   node scripts/render.js 2026-05-12            # render specific date
//
// Input:  posts/<date>/meta.json + templates/<template>.html
// Output: posts/<date>/slides/1.png ... N.png

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SLIDE_W = 1080;
const SLIDE_H = 1350;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function readMeta(dateDir) {
  const raw = await fs.readFile(path.join(dateDir, 'meta.json'), 'utf8');
  return JSON.parse(raw);
}

async function loadTemplate(name) {
  const templatePath = path.join(ROOT, 'templates', `${name}.html`);
  return fs.readFile(templatePath, 'utf8');
}

function interpolate(html, data) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in data) return String(data[key]);
    return '';
  });
}

async function renderSlides(html, outDir) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 });

    // Write a temp file so relative <link rel="stylesheet" href="_base.css"> resolves.
    const tmpPath = path.join(ROOT, 'templates', '.__render.html');
    await fs.writeFile(tmpPath, html, 'utf8');
    await page.goto(pathToFileURL(tmpPath).href, { waitUntil: 'networkidle0' });

    // Wait for webfonts.
    await page.evaluate(() => document.fonts.ready);

    const slides = await page.$$('.slide');
    if (!slides.length) throw new Error('No .slide elements found in template');

    await fs.mkdir(outDir, { recursive: true });

    for (let i = 0; i < slides.length; i++) {
      const filePath = path.join(outDir, `${i + 1}.png`);
      await slides[i].screenshot({ path: filePath, type: 'png', omitBackground: false });
      console.log(`  ✓ slide ${i + 1} → ${path.relative(ROOT, filePath)}`);
    }

    await fs.unlink(tmpPath).catch(() => {});
    return slides.length;
  } finally {
    await browser.close();
  }
}

async function main() {
  const date = process.argv[2] || todayISO();
  const dateDir = path.join(ROOT, 'posts', date);

  try {
    await fs.access(dateDir);
  } catch {
    console.error(`✗ No post directory for ${date}: ${dateDir}`);
    process.exit(1);
  }

  console.log(`▶ Rendering carousel for ${date}`);

  const meta = await readMeta(dateDir);
  const rawTpl = await loadTemplate(meta.template);
  const html = interpolate(rawTpl, meta.data || {});

  const slideCount = await renderSlides(html, path.join(dateDir, 'slides'));
  console.log(`✓ Done — ${slideCount} slides written to posts/${date}/slides/`);
}

main().catch((err) => {
  console.error('✗ Render failed:', err);
  process.exit(1);
});
