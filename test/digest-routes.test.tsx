import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

type JsonRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: string;
  lastError: string | null;
  first: string;
  last: string;
};

type JsonDigest = {
  night: string;
  badLines: number;
  rows: JsonRow[];
};

const NIGHT_FULL = '2026-10-28';
const NIGHT_EMPTY = '2026-10-29';
const NIGHT_BAD = '2026-10-30';
const NIGHT_MISSING = '2026-10-31';

const fullLog = [
  { at: '2026-10-28T23:00:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' },
  { at: '2026-10-28T23:00:02+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'lane-07' },
  { at: '2026-10-29T01:30:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-29T01:31:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-29T01:33:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-29T01:37:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' },
  { at: '2026-10-29T04:00:01+01:00', job: 'notes/backup', status: 'fail', owner: 'lane-07', error: 'quota exceeded' },
  { at: '2026-10-29T05:41:09+01:00', job: 'digest/render', status: 'ok', owner: null },
];

const badLog = [
  '{"at":"2026-10-30T23:00:02+01:00","job":"rig/rotate-logs","status":"ok","owner":"lane-07"}',
  '{"at":"2026-10-30T23:00:0',
  '{"at":"2026-10-31T00:00:04+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-31T01:00:05+01:00","job":"digest/render","status":"ok","owner":null}',
].join('\n');

const toJsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// Job names in the order they appear in the HTML. Names are plain (letters, '/', '-'),
// so searching for them verbatim is safe and does not depend on the table markup.
function jobOrderInHtml(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => ({ job, at: html.indexOf(job) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

describe('digest routes', () => {
  let runsDir: string;

  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
    // Written out of job order on purpose, so sorting is actually exercised.
    writeFileSync(join(runsDir, `${NIGHT_FULL}.jsonl`), toJsonl(fullLog));
    writeFileSync(join(runsDir, `${NIGHT_EMPTY}.jsonl`), '');
    writeFileSync(join(runsDir, `${NIGHT_BAD}.jsonl`), badLog + '\n');
  });

  afterAll(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  const app = () =>
    createApp({
      adapter: 'shim',
      installed: 'x',
      beatEverySeconds: 60,
      runsDir,
    });

  describe('GET /digest/:night', () => {
    it('returns 200 HTML for a night with a file', async () => {
      const res = await app().request(`/digest/${NIGHT_FULL}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('lane/sync');
      expect(html).toContain('notes/backup');
    });

    it('returns 404 for a night with no file', async () => {
      const res = await app().request(`/digest/${NIGHT_MISSING}`);
      expect(res.status).toBe(404);
    });

    it('says "nothing ran" for an empty night', async () => {
      const res = await app().request(`/digest/${NIGHT_EMPTY}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('nothing ran');
    });

    it('still renders a night with a bad line, with the other rows present', async () => {
      const res = await app().request(`/digest/${NIGHT_BAD}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('rig/rotate-logs');
      expect(html).toContain('lane/sync');
      expect(html).toContain('digest/render');
    });
  });

  describe('GET /api/digest/:night', () => {
    it('returns 200 JSON with the night, badLines and sorted rows', async () => {
      const res = await app().request(`/api/digest/${NIGHT_FULL}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonDigest;
      expect(body.night).toBe(NIGHT_FULL);
      expect(body.badLines).toBe(0);

      const jobs = body.rows.map((r) => r.job);
      expect(jobs).toEqual(['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs']);

      const refresh = body.rows.find((r) => r.job === 'fixtures/refresh');
      expect(refresh).toMatchObject({ owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', first: '2026-10-29T01:30:00+01:00', last: '2026-10-29T01:37:00+01:00' });

      const render = body.rows.find((r) => r.job === 'digest/render');
      expect(render?.owner).toBeNull();

      const backup = body.rows.find((r) => r.job === 'notes/backup');
      expect(backup).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
    });

    it('returns 404 JSON for a night with no file', async () => {
      const res = await app().request(`/api/digest/${NIGHT_MISSING}`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toBeDefined();
    });

    it('returns an empty rows array for an empty night', async () => {
      const res = await app().request(`/api/digest/${NIGHT_EMPTY}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonDigest;
      expect(body.rows).toEqual([]);
      expect(body.badLines).toBe(0);
    });

    it('counts the bad line and keeps the other rows', async () => {
      const res = await app().request(`/api/digest/${NIGHT_BAD}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonDigest;
      expect(body.badLines).toBe(1);
      expect(body.rows.map((r) => r.job)).toEqual(['digest/render', 'lane/sync', 'rig/rotate-logs']);
    });
  });

  it('page job order equals JSON job order', async () => {
    const json = (await (await app().request(`/api/digest/${NIGHT_FULL}`)).json()) as JsonDigest;
    const jsonJobs = json.rows.map((r) => r.job);

    const html = await (await app().request(`/digest/${NIGHT_FULL}`)).text();
    expect(jobOrderInHtml(html, jsonJobs)).toEqual(jsonJobs);
  });
});
