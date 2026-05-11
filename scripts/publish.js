// Publish today's carousel to Instagram via Graph API.
//
// Required env:
//   IG_ACCESS_TOKEN   long-lived page access token
//   IG_BUSINESS_ID    Instagram Business Account ID
//   GH_RAW_BASE       e.g. https://raw.githubusercontent.com/<user>/<repo>/main
//
// Usage:
//   node scripts/publish.js              # publish today's post
//   node scripts/publish.js 2026-05-12   # publish specific date

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Login with Instagram Business uses graph.instagram.com (no version prefix).
const GRAPH = 'https://graph.instagram.com';
const { IG_ACCESS_TOKEN, IG_BUSINESS_ID, GH_RAW_BASE } = process.env;

function assertEnv() {
  const missing = ['IG_ACCESS_TOKEN', 'IG_BUSINESS_ID', 'GH_RAW_BASE']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`✗ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function listSlides(slidesDir) {
  const files = await fs.readdir(slidesDir);
  return files
    .filter((f) => f.endsWith('.png'))
    .sort((a, b) => parseInt(a) - parseInt(b));
}

async function createItemContainer(imageUrl) {
  const { data } = await axios.post(`${GRAPH}/${IG_BUSINESS_ID}/media`, null, {
    params: {
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: IG_ACCESS_TOKEN,
    },
  });
  return data.id;
}

async function createCarouselContainer(childrenIds, caption) {
  const { data } = await axios.post(`${GRAPH}/${IG_BUSINESS_ID}/media`, null, {
    params: {
      media_type: 'CAROUSEL',
      children: childrenIds.join(','),
      caption,
      access_token: IG_ACCESS_TOKEN,
    },
  });
  return data.id;
}

async function publishContainer(creationId) {
  const { data } = await axios.post(`${GRAPH}/${IG_BUSINESS_ID}/media_publish`, null, {
    params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN },
  });
  return data.id;
}

async function waitForContainerReady(id, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${GRAPH}/${id}`, {
      params: { fields: 'status_code', access_token: IG_ACCESS_TOKEN },
    });
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`Container ${id} failed`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Container ${id} did not finish in time`);
}

async function main() {
  assertEnv();

  const date = process.argv[2] || todayISO();
  const dateDir = path.join(ROOT, 'posts', date);
  const metaPath = path.join(dateDir, 'meta.json');

  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  if (meta.status === 'published') {
    console.log(`• Post ${date} already published — skipping.`);
    return;
  }

  const caption = await fs.readFile(path.join(dateDir, 'caption.txt'), 'utf8');
  const slides = await listSlides(path.join(dateDir, 'slides'));
  if (!slides.length) throw new Error(`No slides found for ${date}`);
  if (slides.length > 10) throw new Error('Instagram carousel max is 10 slides');

  console.log(`▶ Publishing ${slides.length}-slide carousel for ${date}`);

  console.log('  • Creating item containers...');
  const childrenIds = [];
  for (const file of slides) {
    const url = `${GH_RAW_BASE}/posts/${date}/slides/${file}`;
    const id = await createItemContainer(url);
    await waitForContainerReady(id);
    console.log(`    ✓ ${file} → ${id}`);
    childrenIds.push(id);
  }

  console.log('  • Creating carousel container...');
  const carouselId = await createCarouselContainer(childrenIds, caption);
  await waitForContainerReady(carouselId);

  console.log('  • Publishing...');
  const mediaId = await publishContainer(carouselId);
  console.log(`✓ Published — media id ${mediaId}`);

  meta.status = 'published';
  meta.published_at = new Date().toISOString();
  meta.instagram_media_id = mediaId;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

main().catch((err) => {
  const detail = err.response?.data || err.message;
  console.error('✗ Publish failed:', detail);
  process.exit(1);
});
