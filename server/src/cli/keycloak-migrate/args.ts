/** Ф3 — разбор режима и флагов CLI `migrate-to-keycloak`. */

export type Mode = 'preflight' | 'import' | 'verify' | 'reconcile' | 'report';

export const MODES: readonly Mode[] = ['preflight', 'import', 'verify', 'reconcile', 'report'];

export interface CliArgs {
  mode?: Mode;
  databaseUrl?: string;
  dryRun: boolean;
  allowAnomalies: number;
  state?: string;
  reportFile?: string;
  approvedMapping?: string;
  batch: number;
  ackBackup: boolean;
  json: boolean;
}

function isMode(v: string | undefined): v is Mode {
  return !!v && (MODES as readonly string[]).includes(v);
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    dryRun: false,
    allowAnomalies: 0,
    batch: 400,
    ackBackup: false,
    json: false,
  };
  // Режим — первый позиционный аргумент (не начинается с '--').
  let i = 0;
  if (argv[0] && !argv[0].startsWith('--')) {
    if (isMode(argv[0])) out.mode = argv[0];
    else out.mode = undefined;
    i = 1;
  }
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--database-url':
        out.databaseUrl = next;
        i += 1;
        break;
      case '--state':
        out.state = next;
        i += 1;
        break;
      case '--report-file':
        out.reportFile = next;
        i += 1;
        break;
      case '--approved-mapping':
        out.approvedMapping = next;
        i += 1;
        break;
      case '--allow-anomalies':
        out.allowAnomalies = Number.parseInt(next ?? '0', 10) || 0;
        i += 1;
        break;
      case '--batch':
        out.batch = Number.parseInt(next ?? '400', 10) || 400;
        i += 1;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--ack-backup':
        out.ackBackup = true;
        break;
      case '--json':
        out.json = true;
        break;
      default:
        break;
    }
  }
  return out;
}
