/**
 * In-memory счётчик исходов S3-операций в воркерах (план Iteration 7, мониторинг §7).
 *
 * Скользящее окно 60с. Воркеры зовут recordS3Result(ok) на каждый S3-вызов; монитор
 * (BullMQ recurring, раз в минуту) читает s3ErrorRateLastMinute() и при error-rate >5%
 * (с минимальным числом сэмплов, чтобы не шуметь на 1/1) эмитит audit-событие.
 *
 * Счётчик процесс-локальный: воркеры и API живут в одном процессе (queuesPlugin), окно общее.
 * Чистые функции (isS3ErrorRateBreached / snapshot c инъекцией now) — unit-тестируемы без таймеров.
 */
interface S3Sample {
  t: number;
  ok: boolean;
}

const WINDOW_MS = 60_000;
const samples: S3Sample[] = [];

function prune(t: number): void {
  const cutoff = t - WINDOW_MS;
  while (samples.length > 0 && samples[0]!.t < cutoff) samples.shift();
}

/** Зафиксировать исход одной S3-операции (true = успех). */
export function recordS3Result(ok: boolean, now: () => number = Date.now): void {
  const t = now();
  prune(t);
  samples.push({ t, ok });
}

export interface S3RateSnapshot {
  total: number;
  errors: number;
  errorRate: number;
}

/** Снимок error-rate за последнюю минуту. */
export function s3ErrorRateLastMinute(now: () => number = Date.now): S3RateSnapshot {
  prune(now());
  const total = samples.length;
  let errors = 0;
  for (const s of samples) if (!s.ok) errors += 1;
  return { total, errors, errorRate: total === 0 ? 0 : errors / total };
}

/** Чистая проверка превышения порога error-rate (с минимальным числом сэмплов). */
export function isS3ErrorRateBreached(
  snapshot: S3RateSnapshot,
  threshold = 0.05,
  minSamples = 20,
): boolean {
  return snapshot.total >= minSamples && snapshot.errorRate > threshold;
}

/** Сброс окна (только для тестов). */
export function __resetS3Samples(): void {
  samples.length = 0;
}
