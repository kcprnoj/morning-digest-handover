import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, RunStatus } from './types.js';

const STATUSES: readonly string[] = ['ok', 'retry', 'fail'];

type Line = { at: string; job: string; status: RunStatus; owner: string | null; error: string | null };

// Parse at the edge: anything that is not a well-formed line is null.
function parseLine(raw: string): Line | null {
  try {
    const o: unknown = JSON.parse(raw);
    if (typeof o !== 'object' || o === null) return null;
    const r = o as Record<string, unknown>;
    if (typeof r.at !== 'string' || typeof r.job !== 'string') return null;
    if (typeof r.status !== 'string' || !STATUSES.includes(r.status)) return null;
    return {
      at: r.at,
      job: r.job,
      status: r.status as RunStatus,
      owner: typeof r.owner === 'string' ? r.owner : null,
      error: typeof r.error === 'string' ? r.error : null,
    };
  } catch {
    return null;
  }
}

export function readNight(runsDir: string, night: string): Night | null {
  const path = join(runsDir, `${night}.jsonl`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night) || !existsSync(path)) return null;

  const rows = new Map<string, DigestRow>();
  let badLines = 0;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (!line) {
      badLines++;
      continue;
    }
    const row = rows.get(line.job);
    if (!row) {
      rows.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error,
        first: line.at,
        last: line.at,
      });
      continue;
    }
    row.runs++;
    if (line.status === 'retry') row.retries++;
    row.lastStatus = line.status;
    if (line.error) row.lastError = line.error;
    if (line.owner) row.owner = line.owner;
    row.last = line.at;
  }
  return { rows: [...rows.values()], badLines };
}
