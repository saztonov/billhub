/**
 * audit-s3-sample — выборочный byte-range audit миграции файлов R2 → Cloud.ru
 * (план Iteration 9, ADR-0004). Берёт N случайных ключей из манифеста и для каждого
 * побайтово сверяет первые и последние 1 KB между источником (R2) и назначением (Cloud.ru).
 *
 * Зачем не ETag/checksum: у multipart-объектов ETag различается между провайдерами (ADR-0004).
 * byte-range на случайной выборке даёт криптографическую уверенность для подмножества корпуса,
 * дополняя `rclone check --size-only` (verify-s3-sync.sh) и manifest-сверку (compare-s3-manifests.ts).
 *
 * Чистая логика (sampleKeys/computeRanges/buffersEqual/auditSamples) отделена от @aws-sdk и
 * покрыта unit-тестами; S3-драйвер (fetchRange через GetObjectCommand+Range) — для реального прогона.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { parseManifest, type ManifestEntry } from './compare-s3-manifests.js';

/* ---------------------------- Чистая логика -------------------------------- */

/** Случайная выборка до n записей из манифеста (Fisher-Yates, инъекция random для тестов). */
export function sampleKeys(
  entries: ManifestEntry[],
  n: number,
  random: () => number = Math.random,
): ManifestEntry[] {
  const idx = Array.from({ length: entries.length }, (_, i) => i);
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = idx[i]!;
    const b = idx[j]!;
    idx[i] = b;
    idx[j] = a;
  }
  return idx.slice(0, Math.min(n, entries.length)).map((i) => entries[i]!);
}

export interface EdgeRanges {
  /** HTTP Range первых байт (null для пустого объекта). */
  first: string | null;
  /** HTTP Range последних байт (null, если объект ≤ edge — последние = первые). */
  last: string | null;
}

/**
 * Диапазоны для byte-range audit: первые и последние `edge` байт.
 *  - size === 0 → оба null (нечего сверять).
 *  - size ≤ edge → first покрывает весь объект, last = null (без дублирования).
 *  - size > edge → first = [0, edge-1], last = [size-edge, size-1] (непересекающиеся).
 */
export function computeRanges(size: number, edge = 1024): EdgeRanges {
  if (size <= 0) return { first: null, last: null };
  if (size <= edge) return { first: `bytes=0-${size - 1}`, last: null };
  return { first: `bytes=0-${edge - 1}`, last: `bytes=${size - edge}-${size - 1}` };
}

/** Побайтовое равенство двух буферов. */
export function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export type AuditSide = 'source' | 'target';
export type RangeFetcher = (side: AuditSide, key: string, range: string) => Promise<Uint8Array>;

export interface AuditFailure {
  key: string;
  reason: string;
}

export interface AuditResult {
  sampled: number;
  passed: number;
  failures: AuditFailure[];
}

export interface AuditSamplesOptions {
  entries: ManifestEntry[];
  sampleSize: number;
  fetch: RangeFetcher;
  random?: () => number;
  edgeBytes?: number;
  logger?: (msg: string) => void;
}

/**
 * Сверяет выборку ключей: для каждого скачивает первые (и последние) `edge` байт из обоих
 * провайдеров и сравнивает побайтово. Ошибка скачивания или несовпадение → запись в failures.
 */
export async function auditSamples(opts: AuditSamplesOptions): Promise<AuditResult> {
  const log = opts.logger ?? (() => {});
  const edge = opts.edgeBytes ?? 1024;
  const sample = sampleKeys(opts.entries, opts.sampleSize, opts.random);

  const failures: AuditFailure[] = [];
  let passed = 0;

  for (const entry of sample) {
    const ranges = computeRanges(entry.Size, edge);
    const toCheck = [ranges.first, ranges.last].filter((r): r is string => r !== null);
    if (toCheck.length === 0) {
      // Пустой объект — сверять нечего, считаем пройденным.
      passed += 1;
      continue;
    }
    try {
      let ok = true;
      for (const range of toCheck) {
        const [src, dst] = await Promise.all([
          opts.fetch('source', entry.Key, range),
          opts.fetch('target', entry.Key, range),
        ]);
        if (!buffersEqual(src, dst)) {
          ok = false;
          failures.push({ key: entry.Key, reason: `байты диапазона ${range} различаются` });
          break;
        }
      }
      if (ok) passed += 1;
    } catch (err) {
      failures.push({ key: entry.Key, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  log(`byte-range audit: ${passed}/${sample.length} ключей зелёные, провалов: ${failures.length}`);
  return { sampled: sample.length, passed, failures };
}

/* ----------------------------- S3-драйвер ---------------------------------- */

interface S3Side {
  client: S3Client;
  bucket: string;
}

function buildClient(
  endpoint: string,
  region: string,
  accessKeyId: string,
  secret: string,
): S3Client {
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey: secret },
    forcePathStyle: true,
    maxAttempts: 5,
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`не задана переменная окружения ${name}`);
  return v;
}

/** Источник (R2) и назначение (Cloud.ru) из окружения. */
function buildSides(): { source: S3Side; target: S3Side } {
  const source: S3Side = {
    client: buildClient(
      requireEnv('R2_ENDPOINT'),
      process.env.R2_REGION ?? 'auto',
      requireEnv('R2_ACCESS_KEY'),
      requireEnv('R2_SECRET_KEY'),
    ),
    bucket: process.env.R2_BUCKET ?? 'billhub-r2',
  };
  const target: S3Side = {
    client: buildClient(
      requireEnv('CLOUDRU_ENDPOINT'),
      process.env.CLOUDRU_REGION ?? 'ru-msk',
      requireEnv('CLOUDRU_ACCESS_KEY'),
      requireEnv('CLOUDRU_SECRET_KEY'),
    ),
    bucket: process.env.CLOUDRU_BUCKET ?? 'billhub-s3',
  };
  return { source, target };
}

async function fetchRangeFromSide(side: S3Side, key: string, range: string): Promise<Uint8Array> {
  const res = await side.client.send(
    new GetObjectCommand({ Bucket: side.bucket, Key: key, Range: range }),
  );
  if (!res.Body) throw new Error(`пустое тело ответа для ${key} (${range})`);
  // AWS SDK v3 Node: Body — поток с transformToByteArray().
  return await (
    res.Body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray();
}

/* ------------------------------- CLI --------------------------------------- */

async function main(): Promise<void> {
  const manifestPath =
    process.argv[2] ??
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../docs/cutover-artifacts/manifest_r2_T1.json',
    );
  const sampleSize = Number.parseInt(process.env.SAMPLE_SIZE ?? '50', 10);

  let entries: ManifestEntry[];
  try {
    entries = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch (err) {
    console.error('Не удалось прочитать манифест:', err instanceof Error ? err.message : err);
    process.exit(2);
    return;
  }

  const { source, target } = buildSides();
  const fetch: RangeFetcher = (sideName, key, range) =>
    fetchRangeFromSide(sideName === 'source' ? source : target, key, range);

  const result = await auditSamples({
    entries,
    sampleSize,
    fetch,
    logger: (m) => console.log(m),
  });

  if (result.failures.length > 0) {
    console.error('BYTE-RANGE AUDIT ПРОВАЛЕН:');
    for (const f of result.failures) console.error(`  - ${f.key}: ${f.reason}`);
    process.exit(1);
  }
  console.log(`Byte-range audit зелёный: ${result.passed}/${result.sampled}.`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
