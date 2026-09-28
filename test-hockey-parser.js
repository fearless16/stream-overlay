'use strict';
// Parser contract tests for hockey-score-poller.js
// Run: node test-hockey-parser.js

const assert = require('assert');
const { parseFixtureWidget, normalizeMatch, buildPayload, extractClock } = require('./hockey-score-poller');

const SAMPLE_WIDGET = JSON.stringify({
  matches: [
    {
      sport: 'hockey',
      series_name: 'FIH Hockey Pro League (M)',
      parent_series_name: 'Pro League',
      match_date: '2026-08-21',
      time: '20:30',
      event_state: 'L',
      event_status: 'In Progress',
      event_sub_status: 'Q2',
      pool: 'Pool A',
      venue_name: 'Wagener Stadium, NED',
      event_name: 'Match 10',
      game_id: '22499',
      participants: [
        { name: 'Germany', short_name: 'GER', value: '2', is_home: '1' },
        { name: 'Spain', short_name: 'ESP', value: '1', is_home: '0' },
      ],
    },
    {
      sport: 'hockey',
      series_name: 'FIH Hockey World Cup 2026 (W)',
      match_date: '2026-08-21',
      time: '18:00',
      event_state: 'U',
      event_status: '',
      pool: 'Pool C',
      venue_name: 'Belfius Hockey Arena, BEL',
      event_name: 'Match 25',
      game_id: '22500',
      participants: [
        { name: 'India', short_name: 'IND', value: '', is_home: '1' },
        { name: 'Netherlands', short_name: 'NED', value: '', is_home: '0' },
      ],
    },
    {
      sport: 'hockey',
      series_name: 'FIH Hockey World Cup 2026 (W)',
      match_date: '2026-08-20',
      time: '20:30',
      event_state: 'R',
      event_status: 'Match Completed',
      result_code: 'NORMAL',
      winning_margin: '1 Goal',
      pool: 'Pool C',
      venue_name: 'Belfius Hockey Arena, BEL',
      event_name: 'Match 24',
      game_id: '22407',
      participants: [
        { name: 'Belgium', short_name: 'BEL', value: '2', is_home: '0' },
        { name: 'Ireland', short_name: 'IRL', value: '1', is_home: '1' },
      ],
    },
  ],
});

const SAMPLE_HTML = `<html><head><title>FIH</title></head><body>
<script>window.fixtureWidgetData = '${SAMPLE_WIDGET.replace(/(["\\])/g, '\\$1')}';</script>
</body></html>`;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('parseFixtureWidget');
test('extracts embedded widget JSON from HTML', () => {
  const matches = parseFixtureWidget(SAMPLE_HTML);
  assert.strictEqual(matches.length, 3);
});
test('returns empty array when widget is missing', () => {
  assert.deepStrictEqual(parseFixtureWidget('<html><body>nope</body></html>'), []);
});
test('returns empty array for null/undefined input', () => {
  assert.deepStrictEqual(parseFixtureWidget(null), []);
  assert.deepStrictEqual(parseFixtureWidget(undefined), []);
});
test('handles FIH-style JS escaping of braces, brackets and dashes', () => {
  const inner = SAMPLE_WIDGET.replace(/(["\\\[\]\{\}\-\+])/g, '\\$1');
  const html = `<script>window.fixtureWidgetData = '${inner}';</script>`;
  const matches = parseFixtureWidget(html);
  assert.strictEqual(matches.length, 3);
});
test("escaped apostrophe in team name does not truncate the blob", () => {
  // Simulate the raw FIH page: single-quoted JS literal, so an embedded
  // apostrophe arrives as \' and every double quote as \".
  const inner = SAMPLE_WIDGET
    .replace('"Ireland"', '"Cote d\\\'Ivoire"')
    .replace(/"/g, '\\"');
  const html = `<script>window.fixtureWidgetData = '${inner}';</script>`;
  const matches = parseFixtureWidget(html);
  assert.strictEqual(matches.length, 3);
  assert.strictEqual(matches[2].participants[1].name, "Cote d'Ivoire");
});
test('double-quoted widget literal also parses', () => {
  const html = `<script>window.fixtureWidgetData = "${SAMPLE_WIDGET.replace(/"/g, '\\"')}";</script>`;
  assert.strictEqual(parseFixtureWidget(html).length, 3);
});
test('corrupt JSON returns empty array instead of throwing', () => {
  const html = `<script>window.fixtureWidgetData = '{"matches":[{"sport":"hockey", BROKEN}';</script>`;
  assert.deepStrictEqual(parseFixtureWidget(html), []);
});
test('non-hockey rows are filtered out (data isolation)', () => {
  const mixed = JSON.parse(SAMPLE_WIDGET);
  mixed.matches.push({
    sport: 'football', series_name: 'Some League', match_date: '2026-08-21',
    event_state: 'L', participants: [{ name: 'A', value: '1' }, { name: 'B', value: '0' }],
  });
  const html = `<script>window.fixtureWidgetData = '${JSON.stringify(mixed).replace(/"/g, '\\"')}';</script>`;
  const matches = parseFixtureWidget(html);
  assert.strictEqual(matches.length, 3);
  assert.ok(matches.every((m) => m.sport === 'hockey'));
});
test('unicode escapes decode correctly', () => {
  const inner = SAMPLE_WIDGET.replace('"Germany"', '"G\\u00e9rmany"').replace(/"/g, '\\"');
  const html = `<script>window.fixtureWidgetData = '${inner}';</script>`;
  const [m] = parseFixtureWidget(html);
  assert.strictEqual(m.participants[0].name, 'Gérmany');
});

console.log('normalizeMatch');
test('live match: teams, scores, status, quarter', () => {
  const [m] = parseFixtureWidget(SAMPLE_HTML);
  const n = normalizeMatch(m);
  assert.strictEqual(n.state, 'L');
  assert.strictEqual(n.live, true);
  assert.strictEqual(n.home.name, 'Germany');
  assert.strictEqual(n.home.score, 2);
  assert.strictEqual(n.away.name, 'Spain');
  assert.strictEqual(n.away.score, 1);
  assert.strictEqual(n.status, 'In Progress');
  assert.strictEqual(n.period, 'Q2');
  assert.strictEqual(n.tournament, 'FIH Hockey Pro League (M)');
});
test('upcoming match: zero scores, not live', () => {
  const [, m] = parseFixtureWidget(SAMPLE_HTML);
  const n = normalizeMatch(m);
  assert.strictEqual(n.live, false);
  assert.strictEqual(n.home.score, null);
  assert.strictEqual(n.away.score, null);
  assert.strictEqual(n.startTime, '18:00');
});
test('completed match keeps final score and winner margin', () => {
  const [, , m] = parseFixtureWidget(SAMPLE_HTML);
  const n = normalizeMatch(m);
  assert.strictEqual(n.finished, true);
  assert.strictEqual(n.home.score, 2);
  assert.strictEqual(n.away.score, 1);
});
test('missing participants do not crash normalization', () => {
  const n = normalizeMatch({ participants: [], event_state: 'U' });
  assert.strictEqual(n.home, null);
  assert.strictEqual(n.away, null);
});
test('non-numeric score values become null, never NaN', () => {
  const n = normalizeMatch({
    participants: [{ name: 'A', value: '' }, { name: 'B', value: 'x' }],
  });
  assert.strictEqual(n.home.score, null);
  assert.strictEqual(n.away.score, null);
});

console.log('buildPayload');
function mkMatch(state, date, time, id) {
  return {
    sport: 'hockey', game_id: id, series_name: 'T', match_date: date, time,
    event_state: state, event_status: '', participants: [
      { name: 'A', short_name: 'AAA', value: state === 'U' ? '' : '1' },
      { name: 'B', short_name: 'BBB', value: state === 'U' ? '' : '0' },
    ],
  };
}
test('partitions into live / upcoming / results', () => {
  const p = buildPayload([
    mkMatch('R', '2026-08-19', '20:00', '1'),
    mkMatch('L', '2026-08-21', '20:30', '2'),
    mkMatch('U', '2026-08-22', '18:00', '3'),
  ]);
  assert.strictEqual(p.liveMatches.length, 1);
  assert.strictEqual(p.upcoming.length, 1);
  assert.strictEqual(p.results.length, 1);
  assert.strictEqual(p.total, 3);
  assert.strictEqual(p.type, 'hockey');
});
test('upcoming sorted by date+time ascending and capped at 15', () => {
  const matches = [];
  for (let i = 1; i <= 20; i++) {
    matches.push(mkMatch('U', `2026-09-${String(i).padStart(2, '0')}`, '18:00', String(i)));
  }
  const p = buildPayload(matches);
  assert.strictEqual(p.upcoming.length, 15);
  assert.strictEqual(p.upcoming[0].date, '2026-09-01');
  assert.strictEqual(p.upcoming[14].date, '2026-09-15');
});
test('results sorted newest first', () => {
  const p = buildPayload([
    mkMatch('R', '2026-08-10', '20:00', '1'),
    mkMatch('R', '2026-08-20', '20:00', '2'),
    mkMatch('R', '2026-08-15', '20:00', '3'),
  ]);
  assert.deepStrictEqual(p.results.map((m) => m.date), ['2026-08-20', '2026-08-15', '2026-08-10']);
});

console.log('extractClock (TMS match page)');
test('parses running clock from entity-encoded TMS HTML', () => {
  const html =
    '&quot;minute&quot;:23,&quot;seconds&quot;:1410,&quot;plus&quot;:false,' +
    '&quot;statusminute&quot;:&quot;Q2 8:15&quot;,&quot;ladder&quot;';
  const c = extractClock(html);
  assert.strictEqual(c.minute, 23);
  assert.strictEqual(c.seconds, 1410);
  assert.strictEqual(c.status, 'Q2 8:15');
});
test('decodes apostrophe entities in status text', () => {
  const html =
    '&quot;minute&quot;:30,&quot;seconds&quot;:1800,&quot;plus&quot;:true,' +
    '&quot;statusminute&quot;:&quot;Half Time 30&#039;+&quot;,&quot;ladder&quot;';
  const c = extractClock(html);
  assert.strictEqual(c.status, "Half Time 30'+");
  assert.strictEqual(c.plus, true);
});
test('returns null when no clock data present', () => {
  assert.strictEqual(extractClock('<html>nothing here</html>'), null);
});
test('picks the furthest-ahead clock when page embeds multiple blobs', () => {
  const stale = '&quot;minute&quot;:0,&quot;seconds&quot;:0,&quot;plus&quot;:false,&quot;statusminute&quot;:&quot;3rd Interval 0&#039;&quot;';
  const live = '&quot;minute&quot;:45,&quot;seconds&quot;:2700,&quot;plus&quot;:true,&quot;statusminute&quot;:&quot;3rd Quarter 45&#039;+&quot;';
  const html = '<div>' + stale + '</div><div>' + live + '</div>';
  const c = extractClock(html);
  assert.strictEqual(c.seconds, 2700);
  assert.strictEqual(c.status, "3rd Quarter 45'+");
});

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES' : ''}`);
if (!process.exitCode) console.log('All hockey parser tests passed');
