import type { DigestRow, Night } from '../digest/types.js';

const dash = (s: string | null) => (s === null ? '—' : s);

// Retries of 3 or more, and any job whose last run failed, are the rows to look at.
const needsLook = (r: DigestRow) => r.retries >= 3 || r.lastStatus === 'fail';

export function DigestPage({ night, rows, badLines }: { night: string } & Night) {
  const sorted = [...rows].sort((a, b) => a.job.localeCompare(b.job));
  return (
    <>
      <h1>digest {night}</h1>
      {badLines > 0 && <p class="warn">{badLines} bad {badLines === 1 ? 'line' : 'lines'} skipped</p>}
      {sorted.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr class={needsLook(r) ? 'warn' : undefined}>
                <td>{r.job}</td>
                <td>{dash(r.owner)}</td>
                <td>{r.runs}</td>
                <td>{r.retries}</td>
                <td>{r.lastStatus}</td>
                <td>{dash(r.lastError)}</td>
                <td>{r.first}</td>
                <td>{r.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
