// Gera reel.mp4 1080×1920 a partir dos slides PNG de um post.
//
// Requer: ffmpeg instalado no PATH
//
// Uso:
//   node scripts/render-video.js              # post de hoje
//   node scripts/render-video.js 2026-05-19   # post específico

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import 'dotenv/config';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SLIDE_DURATION = 3.5;   // segundos por slide
const FADE_DURATION  = 0.5;   // segundos de fade entre slides
const OUTPUT_W = 1080;
const OUTPUT_H = 1920;
const SLIDE_H  = 1350;        // altura original dos PNGs

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function listSlides(slidesDir) {
  const files = await fs.readdir(slidesDir);
  return files
    .filter((f) => f.endsWith('.png'))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((f) => path.join(slidesDir, f));
}

function buildFilterComplex(slideCount) {
  const parts = [];

  for (let i = 0; i < slideCount; i++) {
    // Fundo: escalar para cobrir 1080×1920, blur, escurecer levemente
    parts.push(
      `[${i}:v]scale=${OUTPUT_W}:${OUTPUT_H}:force_original_aspect_ratio=increase,` +
      `crop=${OUTPUT_W}:${OUTPUT_H},` +
      `boxblur=25:25,` +
      `colorchannelmixer=rr=0.6:gg=0.6:bb=0.6` +
      `[bg${i}]`
    );
    // Foreground: escalar mantendo proporção
    parts.push(
      `[${i}:v]scale=${OUTPUT_W}:-1,crop=${OUTPUT_W}:${SLIDE_H}[fg${i}]`
    );
    // Overlay centralizado verticalmente
    const yOffset = Math.round((OUTPUT_H - SLIDE_H) / 2);
    parts.push(
      `[bg${i}][fg${i}]overlay=x=0:y=${yOffset}[s${i}]`
    );
  }

  // Xfade entre slides consecutivos
  let prev = 's0';
  for (let i = 1; i < slideCount; i++) {
    const offset = (SLIDE_DURATION * i) - (FADE_DURATION * i);
    const out = i === slideCount - 1 ? 'vout' : `v${i}`;
    parts.push(
      `[${prev}][s${i}]xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset.toFixed(2)}[${out}]`
    );
    prev = out;
  }

  // Se só 1 slide, renomear para vout
  if (slideCount === 1) {
    parts.push(`[s0]copy[vout]`);
  }

  return parts.join('; ');
}

async function renderVideo(date) {
  const dateDir    = path.join(ROOT, 'posts', date);
  const slidesDir  = path.join(dateDir, 'slides');
  const metaPath   = path.join(dateDir, 'meta.json');
  const outputPath = path.join(dateDir, 'reel.mp4');

  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  const theme = meta.music_theme || 'informativo';
  const musicPath = path.join(ROOT, 'brand', 'music', `${theme}.mp3`);

  try {
    await fs.access(musicPath);
  } catch {
    console.warn(`⚠  Música não encontrada: ${musicPath}`);
    console.warn('   Adicione o arquivo MP3 em brand/music/ antes de renderizar.');
    process.exit(1);
  }

  const slides = await listSlides(slidesDir);
  if (!slides.length) throw new Error(`Nenhum slide encontrado em ${slidesDir}`);

  console.log(`▶ Renderizando vídeo para ${date} (${slides.length} slides, tema: ${theme})`);

  const totalDuration = (SLIDE_DURATION * slides.length) - (FADE_DURATION * (slides.length - 1));
  console.log(`  Duração: ${totalDuration.toFixed(1)}s`);

  const inputs = slides.flatMap((slidePath) => [
    '-loop', '1',
    '-t', String(SLIDE_DURATION + FADE_DURATION),
    '-i', slidePath,
  ]);

  const filterComplex = buildFilterComplex(slides.length);

  const args = [
    ...inputs,
    '-i', musicPath,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', `${slides.length}:a`,
    '-t', String(totalDuration),
    '-c:v', 'libx264',
    '-crf', '26',
    '-preset', 'fast',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];

  console.log('  • Executando ffmpeg...');
  try {
    const { stderr } = await execFileAsync('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 });
    if (stderr && process.env.DEBUG) console.error(stderr);
  } catch (err) {
    console.error('✗ ffmpeg falhou:', err.stderr?.slice(-2000) || err.message);
    process.exit(1);
  }

  const stat = await fs.stat(outputPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`✓ reel.mp4 gerado — ${sizeMB}MB → ${outputPath}`);
}

async function main() {
  const date = process.argv[2] || todayISO();
  await renderVideo(date);
}

main().catch((err) => {
  console.error('✗ render-video falhou:', err.message);
  process.exit(1);
});
