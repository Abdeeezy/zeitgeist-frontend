import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { Redis } from '@upstash/redis';

// --- Vercel deployment nuance | Upstash Redis (data writing and reading, 500k reads per month free) ---
const redis = new Redis({
  url: process.env.gildedlamp_KV_REST_API_URL!,
  token: process.env.gildedlamp_KV_REST_API_TOKEN!,
});
const REDIS_KEY = 'articles-backup';

// --- Config -------------------------------------------------------------------

const MAX_ARTICLES = 405;

const DATA_DIR  = join(process.cwd(), 'data');
const DATA_FILE = join(DATA_DIR, 'articles-backup.json');

// --- Types --------------------------------------------------------------------

interface ArticleEntry {
  headline: string;
  themeScores: Record<string, number>;
}

interface BackupData {
  writeIndex: number;   // next slot to write into (0 … MAX_ARTICLES-1)
  count: number;        // filled slots (0 … MAX_ARTICLES)
  lastUpdated: string | null;  // ISO datetime of the most recent POST
  articles: ArticleEntry[];
}

// --- Helpers ------------------------------------------------------------------

//// OLD LOCAL-FILESYSTEM BACKUP
/*
function readBackup(): BackupData {
  if (!existsSync(DATA_FILE)) {
    return { writeIndex: 0, count: 0, lastUpdated: null, articles: [] };
  }
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  // Backwards-compat: files written before lastUpdated was added default to null
  return { ...raw, lastUpdated: raw.lastUpdated ?? null } as BackupData;
}

function writeBackup(data: BackupData): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(DATA_FILE, JSON.stringify(data), 'utf-8');
}
*/


async function readBackup(): Promise<BackupData> {
  const raw = await redis.get<BackupData>(REDIS_KEY);
  if (!raw) return { writeIndex: 0, count: 0, lastUpdated: null, articles: [] };
  return { ...raw, lastUpdated: raw.lastUpdated ?? null };
}

async function writeBackup(data: BackupData): Promise<void> {
  await redis.set(REDIS_KEY, data);
}

// Returns the articles in insertion order: oldest → newest.
// When the buffer is full, oldest slot = writeIndex (next write overwrites it).
function getOrderedArticles(data: BackupData): ArticleEntry[] {
  const total = Math.min(data.count, MAX_ARTICLES);
  const start = data.count >= MAX_ARTICLES ? data.writeIndex : 0;

  const ordered: ArticleEntry[] = [];
  for (let i = 0; i < total; i++) {
    const slot = (start + i) % MAX_ARTICLES;
    if (data.articles[slot]) ordered.push(data.articles[slot]);
  }
  return ordered;
}

// --- Route handlers -----------------------------------------------------------

// GET /api/articles-backup
// Returns all stored articles in insertion order (oldest first).
export async function GET() {
  const data = await readBackup();
  const articles = getOrderedArticles(data);
  return NextResponse.json({ articles, count: data.count, lastUpdated: data.lastUpdated });
}

// POST /api/articles-backup
// Body: { articles: ArticleEntry[] }
// Appends each article to the circular buffer.
export async function POST(req: NextRequest) {
  const body: { articles: ArticleEntry[] } = await req.json();
  const data = await readBackup();

  for (const article of body.articles) {
    data.articles[data.writeIndex] = article;
    data.writeIndex = (data.writeIndex + 1) % MAX_ARTICLES;
    if (data.count < MAX_ARTICLES) data.count++;
  }

  data.lastUpdated = new Date().toISOString();
  writeBackup(data);
  return NextResponse.json({ ok: true, stored: data.count, lastUpdated: data.lastUpdated });
}
