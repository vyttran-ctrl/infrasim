// Before vs after, in four numbers and one sentence.

import type { MetricsSummary, Scenario } from '../sim/types';
import { Disclosure } from './controls';
import { num } from './format';
import { IconClose } from './icons';
import { ResultsTable } from './ResultsTable';
import { trafficLabel } from './RunBar';
import { startOver } from './session';
import { change, changedArea, HEADLINES, LOCAL_HEADLINES, localChange, localSentence, localStats, verdictSentence, type Tone } from './headline';
import { closeResults, runTest, useTest } from './testRun';

const signedWhole = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? '0%' : `${r > 0 ? '+' : '-'}${Math.abs(r)}%`;
};

/** "Better: queues are 2% shorter, and ..." -> "Across the whole city, queues are 2% shorter, and ..." */
function citySentence(s: string): string {
  const body = s.replace(/^(Better|Worse|Mixed|About the same): /, '');
  return `Across the whole city, ${body[0].toLowerCase()}${body.slice(1)}`;
}

const TONE_WORD: Record<Tone, string> = { good: 'Better', bad: 'Worse', same: 'Same' };

export function TestResults() {
  const t = useTest();
  if (!t.open || t.status === 'idle' || t.status === 'running') return null;

  return (
    <aside className="results-panel panel" aria-label="Test results">
      <header className="card-head">
        <div className="card-titles">
          <span className="caps">Test results</span>
          <h2 className="card-title">Before and after your {t.edits.length === 1 ? 'change' : `${t.edits.length} changes`}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Close results" onClick={closeResults}>
          <IconClose />
        </button>
      </header>

      {t.status === 'error' || !t.before || !t.after ? (
        <div className="card-body">
          <p className="msg msg-bad">The test could not finish: {t.error ?? 'unknown error'}.</p>
          <button type="button" className="btn btn-primary" onClick={() => void runTest()}>
            Try again
          </button>
        </div>
      ) : (
        <Body before={t.before} after={t.after} />
      )}
    </aside>
  );
}

function Body({ before, after }: { before: MetricsSummary; after: MetricsSummary }) {
  const t = useTest.getState();
  const cfg = t.config;
  const sentence = verdictSentence(before, after);
  const area = t.original && t.edited ? changedArea(t.original, t.edited) : null;
  const localBefore = area ? localStats(before, area.edgeIds) : null;
  const localAfter = area ? localStats(after, area.edgeIds) : null;
  const scenarios: Scenario[] = [
    { id: 'before', name: 'Before', network: null!, config: cfg!, result: before, createdAt: 0 },
    { id: 'after', name: 'After', network: null!, config: cfg!, result: after, createdAt: 0 },
  ];

  return (
    <div className="card-body">
      {area && localBefore && localAfter ? (
        <>
          <p className="verdict">{localSentence(area, localBefore, localAfter)}</p>
          <p className="verdict-city">{citySentence(sentence)}</p>
        </>
      ) : (
        <p className="verdict">{sentence}</p>
      )}
      {after.unroutable > before.unroutable && (
        <p className="msg">
          {num(after.unroutable - before.unroutable)} more trip{after.unroutable - before.unroutable === 1 ? '' : 's'} could not reach their
          destination after your changes, because no open road leads there.
        </p>
      )}

      {area && localBefore && localAfter && (
        <>
          <h3 className="caps table-head">At {area.label === 'the places you changed' ? 'the places you changed' : area.label}</h3>
          <table className="headline">
            <thead>
              <tr>
                <th scope="col" className="sr-only">Measure</th>
                <th scope="col" className="caps">Before</th>
                <th scope="col" className="caps">After</th>
                <th scope="col" className="caps">Change</th>
              </tr>
            </thead>
            <tbody>
              {LOCAL_HEADLINES.map((h) => {
                const c = localChange(h, localBefore, localAfter);
                return (
                  <tr key={h.key}>
                    <th scope="row">
                      {h.label}
                      <span className="unit">{h.unit}</span>
                    </th>
                    <td className="mono">{num(h.get(localBefore), h.digits)}</td>
                    <td className="mono strong">{num(h.get(localAfter), h.digits)}</td>
                    <td className={`delta-cell tone-${c.tone}`}>
                      <span className="mono">{signedWhole(c.pct)}</span>
                      <span className="tone-word">{TONE_WORD[c.tone]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3 className="caps table-head">Whole city</h3>
        </>
      )}

      <table className="headline">
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              Measure
            </th>
            <th scope="col" className="caps">
              Before
            </th>
            <th scope="col" className="caps">
              After
            </th>
            <th scope="col" className="caps">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {HEADLINES.map((h) => {
            const c = change(h, before, after);
            return (
              <tr key={h.key}>
                <th scope="row">
                  {h.label}
                  <span className="unit">{h.unit}</span>
                </th>
                <td className="mono">{num(h.get(before), h.digits)}</td>
                <td className="mono strong">{num(h.get(after), h.digits)}</td>
                <td className={`delta-cell tone-${c.tone}`}>
                  <span className="mono">{signedWhole(c.pct)}</span>
                  <span className="tone-word">{TONE_WORD[c.tone]}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {cfg && (
        <p className="card-note">
          Both runs used exactly the same traffic: {trafficLabel(cfg.demand).toLowerCase()} traffic, {num(cfg.duration / 60)} minutes,
          up to {num(cfg.maxVehicles)} cars, seed {cfg.seed}. Only the map differs.
        </p>
      )}

      <Disclosure label="See all metrics" className="card-more">
        <ResultsTable scenarios={scenarios} subLabels={false} />
        <h3 className="caps changes-head">What you changed</h3>
        <ol className="edits">
          {t.edits.map((e, i) => (
            <li key={i}>
              <span className="mono muted">{i + 1}</span>
              <span>{e}</span>
            </li>
          ))}
        </ol>
      </Disclosure>

      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={closeResults}>
          Keep testing
        </button>
        <button type="button" className="btn btn-secondary" onClick={startOver}>
          Start over
        </button>
      </div>
    </div>
  );
}
