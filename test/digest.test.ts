import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night).not.toBeNull();
    expect(night!.rows).toHaveLength(5);
    expect(night!.badLines).toBe(1);
    const refresh = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(refresh).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    const backup = night!.rows.find((r) => r.job === 'notes/backup');
    expect(backup).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps a row whose owner is null', () => {
    const row = readNight('runs', '2026-10-28')!.rows.find((r) => r.job === 'digest/render');
    expect(row).toBeDefined();
    expect(row!.owner).toBeNull();
  });

  it('keeps the offset from the log', () => {
    const row = readNight('runs', '2026-10-28')!.rows.find((r) => r.job === 'rig/rotate-logs');
    expect(row!.first).toBe('2026-10-28T23:00:02+01:00');
  });

  it('returns null for a night with no file', () => {
    expect(readNight('runs', '2020-01-01')).toBeNull();
  });

  it('counts bad lines and does not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rig-'));
    writeFileSync(join(dir, '2026-01-01.jsonl'), 'not json\n{"at":1}\n[]\n');
    expect(readNight(dir, '2026-01-01')).toEqual({ rows: [], badLines: 3 });
  });
});
