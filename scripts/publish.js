// Publish today's carousel to Instagram + Facebook via Graph API.
//
// Required env:
//   IG_ACCESS_TOKEN       long-lived Instagram access token
//   IG_BUSINESS_ID        Instagram Business Account ID
//   GH_RAW_BASE           e.g. https://raw.githubusercontent.com/<user>/<repo>/main
//   FB_PAGE_ID            Facebook Page ID
//   FB_PAGE_ACCESS_TOKEN  permanent Facebook Page access token
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
const IG_GRAPH = 'https://graph.instagram.com';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';
const { IG_ACCESS_TOKEN, IG_BUSINESS_ID, GH_RAW_BASE, FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN } = process.env;

function assertEnv() {
  const missing = ['IG_ACCESS_TOKEN', 'IG_BUSINESS_ID', 'GH_RAW_BASE', 'FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN']
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

// ─── Instagram helpers ────────────────────────────────────────────────────────

async function createItemContainer(imageUrl) {
  const { data } = await axios.post(`${IG_GRAPH}/${IG_BUSINESS_ID}/media`, null, {
    params: { image_url: imageUrl, is_carousel_item: true, access_token: IG_ACCESS_TOKEN },
  });
  return data.id;
}

async function createCarouselContainer(childrenIds, caption) {
  const { data } = await axios.post(`${IG_GRAPH}/${IG_BUSINESS_ID}/media`, null, {
    params: { media_type: 'CAROUSEL', children: childrenIds.join(','), caption, access_token: IG_ACCESS_TOKEN },
  });
  return data.id;
}

async function publishIgContainer(creationId) {
  const { data } = await axios.post(`${IG_GRAPH}/${IG_BUSINESS_ID}/media_publish`, null, {
    params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN },
  });
  return data.id;
}

async function waitForContainerReady(id, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${IG_GRAPH}/${id}`, {
      params: { fields: 'status_code', access_token: IG_ACCESS_TOKEN },
    });
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`Container ${id} failed`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Container ${id} did not finish in time`);
}

// ─── Facebook helpers ─────────────────────────────────────────────────────────

async function uploadFbPhoto(imageUrl) {
  const { data } = await axios.post(`${FB_GRAPH}/${FB_PAGE_ID}/photos`, null, {
    params: { url: imageUrl, published: false, access_token: FB_PAGE_ACCESS_TOKEN },
  });
  return data.id;
}

async function publishFbMultiPhoto(photoIds, caption) {
  const attachedMedia = Object.fromEntries(
    photoIds.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })])
  );
  const { data } = await axios.post(`${FB_GRAPH}/${FB_PAGE_ID}/feed`, null, {
    params: { message: caption, ...attachedMedia, access_token: FB_PAGE_ACCESS_TOKEN },
  });
  return data.id;
}

// ─── Instagram Reels helpers ──────────────────────────────────────────────────

async function createReelContainer(videoUrl, caption) {
  const { data } = await axios.post(`${IG_GRAPH}/${IG_BUSINESS_ID}/media`, null, {
    params: {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: IG_ACCESS_TOKEN,
    },
  });
  return data.id;
}

async function waitForReelReady(id, maxAttempts = 40) {
  console.log('  • Aguardando processamento do vídeo (pode levar 1-3 min)...');
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(`${IG_GRAPH}/${id}`, {
      params: { fields: 'status_code', access_token: IG_ACCESS_TOKEN },
    });
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error(`Reel container ${id} falhou`);
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Reel container ${id} não finalizou em tempo`);
}

async function publishReelContainer(creationId) {
  const { data } = await axios.post(`${IG_GRAPH}/${IG_BUSINESS_ID}/media_publish`, null, {
    params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN },
  });
  return data.id;
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

  console.log('  • Publishing to Instagram...');
  const igMediaId = await publishIgContainer(carouselId);
  console.log(`✓ Instagram — media id ${igMediaId}`);

  // ── Facebook ──────────────────────────────────────────────────────────────
  console.log('\n▶ Publishing to Facebook...');
  console.log('  • Uploading photos...');
  const fbPhotoIds = [];
  for (const file of slides) {
    const url = `${GH_RAW_BASE}/posts/${date}/slides/${file}`;
    const id = await uploadFbPhoto(url);
    console.log(`    ✓ ${file} → ${id}`);
    fbPhotoIds.push(id);
  }
  console.log('  • Creating post...');
  const fbPostId = await publishFbMultiPhoto(fbPhotoIds, caption);
  console.log(`✓ Facebook — post id ${fbPostId}`);

  // ── Instagram Reel (se reel.mp4 existir) ──────────────────────────────────
  const reelPath = path.join(dateDir, 'reel.mp4');
  let reelExists = false;
  try { await fs.access(reelPath); reelExists = true; } catch {}

  if (reelExists) {
    console.log('\n▶ Publishing Reel to Instagram...');
    const reelUrl = `${GH_RAW_BASE}/posts/${date}/reel.mp4`;
    const reelContainerId = await createReelContainer(reelUrl, caption);
    process.stdout.write('  ');
    await waitForReelReady(reelContainerId);
    process.stdout.write('\n');
    const reelMediaId = await publishReelContainer(reelContainerId);
    console.log(`✓ Reel publicado — media id ${reelMediaId}`);
    meta.instagram_reel_id = reelMediaId;
  } else {
    console.log('\n• Sem reel.mp4 — pulando Reel.');
  }

  meta.status = 'published';
  meta.published_at = new Date().toISOString();
  meta.instagram_media_id = igMediaId;
  meta.facebook_post_id = fbPostId;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

main().catch((err) => {
  const detail = err.response?.data || err.message;
  console.error('✗ Publish failed:', detail);
  process.exit(1);
});
