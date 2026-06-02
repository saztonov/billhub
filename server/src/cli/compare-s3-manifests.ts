/**
 * compare-s3-manifests — сверка двух S3-манифестов (R2 vs Cloud.ru) по count и total_size
 * с допуском ±0.1% (план Iteration 9, ADR-0004). Manifest-based verification — независимая
 * страховка к `rclone check --size-only` и byte-range audit.
 *
 * Manifest — вывод `scripts/list-r2-manifest.sh` (массив `{Key, Size, LastModified?, ETag?}`,
 * как `aws s3api list-objects-v2 --query 'Contents[].{...}'`).
 *
 * НЕ сравнивает ETag/MD5: у multipart-объектов ETag различается между провайдерами (ADR-0004).
 *
 * Чистая логика (parseManifest/compareManifests) отделена от fs и покрыта unit-тестами.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Запись манифеста: ключ + размер (остальные поля игнорируются при сверке). */
export interface ManifestEntry {
  Key: string;
  Size: number;
}

export interface ManifestSummary {
  count: number;
  totalBytes: number;
  keys: Set<string>;
}

export interface CompareOptions {
  /** Допуск по количеству объектов, доля (по умолчанию 0.001 = ±0.1%). */
  countTolerance?: number;
  /** Допуск по суммарному размеру, доля (по умолчанию 0.001 = ±0.1%). */
  sizeTolerance?: number;
  /** Максимум перечисляемых расходящихся ключей в отчёте (по умолчанию 20). */
  maxListed?: number;
}

export interface CompareResult {
  ok: boolean;
  sourceCount: number;
  targetCount: number;
  sourceBytes: number;
  targetBytes: number;
  countDeltaPct: number;
  bytesDeltaPct: number;
  /** Ключи источника, отсутствующие в назначении (усечено до maxListed). */
  missingInTarget: string[];
  /** Ключи назначения, отсутствующие в источнике (усечено до maxListed). */
  extraInTarget: string[];
  /** Ключи, присутствующие в обоих, но с разным Size (усечено до maxListed). */
  sizeMismatch: string[];
  reasons: string[];
}

/** Валидирует и нормализует сырой JSON манифеста в массив записей. */
export function parseManifest(raw: unknown): ManifestEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error('манифест должен быть JSON-массивом объектов {Key, Size}');
  }
  const out: ManifestEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') {
      throw new Error('элемент манифеста не является объектом');
    }
    const obj = item as Record<string, unknown>;
    const key = obj.Key ?? obj.key;
    const size = obj.Size ?? obj.size;
    if (typeof key !== 'string') throw new Error('у элемента манифеста отсутствует строковый Key');
    const sizeNum = typeof size === 'number' ? size : Number(size);
    if (!Number.isFinite(sizeNum) || sizeNum < 0) {
      throw new Error(`некорректный Size у ключа ${key}: ${String(size)}`);
    }
    out.push({ Key: key, Size: sizeNum });
  }
  return out;
}

/** Агрегаты манифеста: количество, суммарный размер, множество ключей. */
export function summarize(entries: ManifestEntry[]): ManifestSummary {
  let totalBytes = 0;
  const keys = new Set<string>();
  for (const e of entries) {
    totalBytes += e.Size;
    keys.add(e.Key);
  }
  return { count: entries.length, totalBytes, keys };
}

/** Относительная разница |a-b| / max(a,1), в долях. */
function relDelta(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, 1);
}

/**
 * Сравнивает source-манифест (R2) с target-манифестом (Cloud.ru).
 * ok=true, если count и total_size в пределах допуска И нет ключей источника,
 * пропущенных в назначении, И нет расхождений по размеру у общих ключей.
 */
export function compareManifests(
  source: ManifestEntry[],
  target: ManifestEntry[],
  opts: CompareOptions = {},
): CompareResult {
  const countTol = opts.countTolerance ?? 0.001;
  const sizeTol = opts.sizeTolerance ?? 0.001;
  const maxListed = opts.maxListed ?? 20;

  const s = summarize(source);
  const t = summarize(target);
  const targetSize = new Map(target.map((e) => [e.Key, e.Size]));

  const missingInTarget: string[] = [];
  const sizeMismatch: string[] = [];
  for (const e of source) {
    const ts = targetSize.get(e.Key);
    if (ts === undefined) {
      missingInTarget.push(e.Key);
    } else if (ts !== e.Size) {
      sizeMismatch.push(e.Key);
    }
  }
  const extraInTarget: string[] = [];
  for (const e of target) {
    if (!s.keys.has(e.Key)) extraInTarget.push(e.Key);
  }

  const countDeltaPct = relDelta(s.count, t.count) * 100;
  const bytesDeltaPct = relDelta(s.totalBytes, t.totalBytes) * 100;

  const reasons: string[] = [];
  if (relDelta(s.count, t.count) > countTol) {
    reasons.push(
      `count вне допуска: source=${s.count}, target=${t.count} (Δ=${countDeltaPct.toFixed(4)}% > ${(countTol * 100).toFixed(3)}%)`,
    );
  }
  if (relDelta(s.totalBytes, t.totalBytes) > sizeTol) {
    reasons.push(
      `total_size вне допуска: source=${s.totalBytes}, target=${t.totalBytes} (Δ=${bytesDeltaPct.toFixed(4)}% > ${(sizeTol * 100).toFixed(3)}%)`,
    );
  }
  if (missingInTarget.length > 0) {
    reasons.push(`${missingInTarget.length} ключей источника отсутствуют в назначении`);
  }
  if (sizeMismatch.length > 0) {
    reasons.push(`${sizeMismatch.length} общих ключей с разным Size`);
  }

  return {
    ok: reasons.length === 0,
    sourceCount: s.count,
    targetCount: t.count,
    sourceBytes: s.totalBytes,
    targetBytes: t.totalBytes,
    countDeltaPct,
    bytesDeltaPct,
    missingInTarget: missingInTarget.slice(0, maxListed),
    extraInTarget: extraInTarget.slice(0, maxListed),
    sizeMismatch: sizeMismatch.slice(0, maxListed),
    reasons,
  };
}

/* ------------------------------- CLI --------------------------------------- */

function readManifestFile(file: string): ManifestEntry[] {
  return parseManifest(JSON.parse(readFileSync(file, 'utf8')));
}

function main(argv: string[]): void {
  const sourceFile = argv[0];
  const targetFile = argv[1];
  if (!sourceFile || !targetFile) {
    console.error(
      'Использование: compare-s3-manifests <manifest_source.json> <manifest_target.json>',
    );
    process.exit(2);
  }

  let result: CompareResult;
  try {
    result = compareManifests(readManifestFile(sourceFile), readManifestFile(targetFile));
  } catch (err) {
    console.error('Ошибка чтения манифестов:', err instanceof Error ? err.message : err);
    process.exit(2);
    return;
  }

  console.log(
    `source: ${result.sourceCount} объектов / ${result.sourceBytes} байт\n` +
      `target: ${result.targetCount} объектов / ${result.targetBytes} байт\n` +
      `Δcount=${result.countDeltaPct.toFixed(4)}%  Δsize=${result.bytesDeltaPct.toFixed(4)}%`,
  );
  if (result.missingInTarget.length > 0) {
    console.log(`Отсутствуют в target (до 20): ${result.missingInTarget.join(', ')}`);
  }
  if (result.sizeMismatch.length > 0) {
    console.log(`Разный размер (до 20): ${result.sizeMismatch.join(', ')}`);
  }

  if (result.ok) {
    console.log('МАНИФЕСТЫ СОШЛИСЬ (в пределах ±0.1%).');
    process.exit(0);
  } else {
    console.error('РАСХОЖДЕНИЕ МАНИФЕСТОВ:\n  - ' + result.reasons.join('\n  - '));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
