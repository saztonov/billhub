/**
 * Ф3 — mode-runners (чистая логика над портами; IO инъектируется, unit-тестируется моками без Docker).
 *
 * Инварианты (скилл): импорт с id=users.id; после SKIP основной якорь — exact email, sub перечитывается
 * из KC; sub≠users.id → mismatch+СТОП (кроме approved-mapping); линки идемпотентны; группа active/pending
 * по is_active; reconcile правит ТОЛЬКО БД-зеркало (KC→БД), KC-группы не трогает.
 */
import { PasswordService } from '../../services/auth/password.service.js';
import { buildUserPayload } from './payload-builder.js';
import { analyzePreflight, type PreflightReport } from './preflight.js';
import type {
  KcGroupRef,
  KeycloakAdminPort,
  LinkStore,
  Logger,
  MirrorWriter,
  SourceReader,
} from './types.js';
import { emptyCounters, type Checkpoint, type MigrationState } from './types-state.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Членство в группе по имени или полному пути `/<name>`. */
function hasGroup(groups: KcGroupRef[], name: string): boolean {
  return groups.some(
    (g) => g.name === name || g.path === `/${name}` || g.path.endsWith(`/${name}`),
  );
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ------------------------------- preflight --------------------------------- */

export interface PreflightRunResult {
  report: PreflightReport;
  blocked: boolean;
}

export async function runPreflight(opts: {
  source: SourceReader;
  allowAnomalies: number;
  logger?: Logger;
}): Promise<PreflightRunResult> {
  const users = await opts.source.readUsers();
  const report = analyzePreflight(users);
  const blocked = report.blockers > 0 || report.warnings > opts.allowAnomalies;
  return { report, blocked };
}

/* -------------------------------- import ----------------------------------- */

export interface ImportRunOptions {
  source: SourceReader;
  kc: KeycloakAdminPort;
  links: LinkStore;
  provider: string;
  groupActive: string;
  groupPending: string;
  checkpoint?: Checkpoint;
  approvedMapping?: Record<string, string>;
  batch?: number;
  dryRun?: boolean;
  logger?: Logger;
  now?: () => string;
}

export interface ImportRunReport {
  total: number;
  counters: MigrationState['counters'];
  mismatches: MigrationState['mismatches'];
  errors: { userId: string; email: string; error: string }[];
  stopped: boolean;
  cursor: string | null;
  dryRun: boolean;
}

export async function runImport(opts: ImportRunOptions): Promise<ImportRunReport> {
  const batch = opts.batch ?? 400;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? (() => new Date().toISOString());
  const provider = opts.provider;

  const all = (await opts.source.readUsers()).sort(byId);

  const prev = opts.checkpoint ? await opts.checkpoint.load() : null;
  const counters = prev?.counters ?? emptyCounters();
  const mismatches = prev?.mismatches ?? [];
  const startedAt = prev?.startedAt ?? now();
  let cursor = prev?.cursor ?? null;

  const pending = cursor ? all.filter((u) => u.id > cursor!) : all;
  const errors: { userId: string; email: string; error: string }[] = [];
  let stopped = false;

  const snapshot = (): MigrationState => ({
    version: 1,
    cursor,
    counters,
    mismatches,
    startedAt,
    updatedAt: now(),
  });

  for (let i = 0; i < pending.length && !stopped; i += batch) {
    const slice = pending.slice(i, i + batch);
    const payloads = slice.map(buildUserPayload);

    for (const u of slice) {
      if (!(u.passwordHash && PasswordService.isBcryptHash(u.passwordHash))) {
        counters.nullPassword += 1;
      }
    }

    if (dryRun) {
      counters.processed += slice.length;
      cursor = slice[slice.length - 1]!.id;
      continue;
    }

    try {
      const res = await opts.kc.partialImport(payloads, 'SKIP');
      counters.importedAdded += res.added ?? 0;
      counters.importedSkippedExisting += res.skipped ?? 0;
    } catch (e) {
      for (const u of slice) errors.push({ userId: u.id, email: u.email, error: errMsg(e) });
      counters.errors += slice.length;
      stopped = true;
      break;
    }

    for (const u of slice) {
      try {
        const kcUser = await opts.kc.findUserByEmail(u.email);
        if (!kcUser) {
          errors.push({ userId: u.id, email: u.email, error: 'KC-юзер не найден после import' });
          counters.errors += 1;
          continue;
        }
        const realSub = kcUser.id;

        // Backfill атрибута при SKIP пред-существующего (у созданных он уже проставлен).
        const attrIds = kcUser.attributes?.billhub_user_id ?? [];
        if (!attrIds.includes(u.id)) {
          await opts.kc.mergeUserAttributes(realSub, { billhub_user_id: [u.id] });
          counters.backfilled += 1;
        }

        // sub≠users.id → только через approved-mapping, иначе mismatch+СТОП.
        if (realSub !== u.id && opts.approvedMapping?.[u.id] !== realSub) {
          mismatches.push({ userId: u.id, kcSub: realSub, email: u.email });
          stopped = true;
          break;
        }

        await opts.links.link({ userId: u.id, provider, subject: realSub, emailAtLink: u.email });
        counters.linked += 1;

        await opts.kc.setPortalActive(realSub, u.isActive);
        if (u.isActive) counters.active += 1;
        else counters.pending += 1;

        counters.processed += 1;
        cursor = u.id;
      } catch (e) {
        errors.push({ userId: u.id, email: u.email, error: errMsg(e) });
        counters.errors += 1;
      }
    }

    if (opts.checkpoint) await opts.checkpoint.save(snapshot());
  }

  if (opts.checkpoint) await opts.checkpoint.save(snapshot());
  return { total: all.length, counters, mismatches, errors, stopped, cursor, dryRun };
}

/* -------------------------------- verify ----------------------------------- */

export interface VerifyRunReport {
  total: number;
  linked: number;
  drift: { userId: string; email: string; kind: string }[];
}

export async function runVerify(opts: {
  source: SourceReader;
  kc: KeycloakAdminPort;
  links: LinkStore;
  provider: string;
  groupActive: string;
  groupPending: string;
  logger?: Logger;
}): Promise<VerifyRunReport> {
  const users = await opts.source.readUsers();
  const drift: { userId: string; email: string; kind: string }[] = [];
  let linked = 0;

  for (const u of users) {
    const subject = await opts.links.findSubjectByUserId(opts.provider, u.id);
    if (!subject) {
      drift.push({ userId: u.id, email: u.email, kind: 'no_link' });
      continue;
    }
    linked += 1;
    const kcUser = await opts.kc.getUserById(subject);
    if (!kcUser) {
      drift.push({ userId: u.id, email: u.email, kind: 'kc_user_missing' });
      continue;
    }
    const attrIds = kcUser.attributes?.billhub_user_id ?? [];
    if (!attrIds.includes(u.id)) {
      drift.push({ userId: u.id, email: u.email, kind: 'attr_mismatch' });
    }
    const groups = await opts.kc.getUserGroups(subject);
    if (!hasGroup(groups, opts.groupActive) && !hasGroup(groups, opts.groupPending)) {
      drift.push({ userId: u.id, email: u.email, kind: 'no_portal_group' });
    }
  }
  return { total: users.length, linked, drift };
}

/* ------------------------------ reconcile ---------------------------------- */

export interface ReconcileRunReport {
  total: number;
  linked: number;
  updated: number;
  linksRestored: number;
  unresolved: { userId: string; email: string; kind: string }[];
  retryable: { userId: string; email: string; error: string }[];
  dryRun: boolean;
}

export async function runReconcile(opts: {
  source: SourceReader;
  kc: KeycloakAdminPort;
  links: LinkStore;
  mirror: MirrorWriter;
  provider: string;
  groupActive: string;
  dryRun?: boolean;
  logger?: Logger;
}): Promise<ReconcileRunReport> {
  const dryRun = opts.dryRun ?? false;
  const users = await opts.source.readUsers();
  const unresolved: { userId: string; email: string; kind: string }[] = [];
  const retryable: { userId: string; email: string; error: string }[] = [];
  let linked = 0;
  let updated = 0;
  let linksRestored = 0;

  for (const u of users) {
    try {
      let subject = await opts.links.findSubjectByUserId(opts.provider, u.id);

      // Восстановить недостающий линк ТОЛЬКО при однозначном соответствии (email + billhub_user_id).
      if (!subject) {
        const kcUser = await opts.kc.findUserByEmail(u.email);
        const attrIds = kcUser?.attributes?.billhub_user_id ?? [];
        if (kcUser && attrIds.includes(u.id)) {
          if (!dryRun) {
            await opts.links.link({
              userId: u.id,
              provider: opts.provider,
              subject: kcUser.id,
              emailAtLink: u.email,
            });
          }
          subject = kcUser.id;
          linksRestored += 1;
        } else {
          unresolved.push({ userId: u.id, email: u.email, kind: 'no_link' });
          continue;
        }
      }

      linked += 1;
      const groups = await opts.kc.getUserGroups(subject);
      const kcActive = hasGroup(groups, opts.groupActive);
      if (kcActive !== u.isActive) {
        if (dryRun) updated += 1;
        else if ((await opts.mirror.setActive(u.id, kcActive)) > 0) updated += 1;
      }
    } catch (e) {
      retryable.push({ userId: u.id, email: u.email, error: errMsg(e) });
    }
  }
  return { total: users.length, linked, updated, linksRestored, unresolved, retryable, dryRun };
}

/* -------------------------------- report ----------------------------------- */

export interface StateRunReport {
  total: number;
  linked: number;
  unlinked: number;
  nullPassword: number;
  counterparties: number;
}

export async function runReport(opts: {
  source: SourceReader;
  links: LinkStore;
  provider: string;
  logger?: Logger;
}): Promise<StateRunReport> {
  const users = await opts.source.readUsers();
  let linked = 0;
  let nullPassword = 0;
  let counterparties = 0;
  for (const u of users) {
    if (await opts.links.findSubjectByUserId(opts.provider, u.id)) linked += 1;
    if (u.passwordHash === null) nullPassword += 1;
    if (u.role === 'counterparty_user') counterparties += 1;
  }
  return {
    total: users.length,
    linked,
    unlinked: users.length - linked,
    nullPassword,
    counterparties,
  };
}
