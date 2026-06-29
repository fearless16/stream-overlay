// Offline test harness — exercises the parsers against saved HTML files
// and prints structured results. Run as: node test-parser.js
const fs = require('fs');
const path = require('path');

const pollerPath = path.join(__dirname, 'live-score-poller.js');
const poller = require(pollerPath);

const TESTS = [
  {
    name: 'Crex — ENG vs NZ 1st Test (Day 1 Stumps)',
    file: '/tmp/crex_eng_nz.html',
    url: 'https://crex.com/cricket-live-score/eng-vs-nz-1st-test-new-zealand-tour-of-england-2026-match-updates-VSC',
    expect: {
      format: 'Test',
      batTeam: 'New Zealand',
      batScore: '61/6',
      batOvers: '19.2',
      oppTeam: 'England',
      oppScore: '140/10',
      oppOvers: '39.4',
      statusContains: 'Stumps',
      leadTrailContains: 'trail by 79',
      bowlerName: 'Ben Stokes',
    },
  },
  {
    name: 'Cricbuzz — ENG vs NZ 1st Test (Day 1 Stumps)',
    file: '/tmp/cb_eng_nz.html',
    url: 'https://www.cricbuzz.com/live-cricket-scores/129552/eng-vs-nz-1st-test-new-zealand-tour-of-england-2026',
    expect: {
      format: 'Test',
      batTeamAbbr: 'NZ',
      batScore: '61/6',
      batOvers: '19.2',
      oppTeamAbbr: 'ENG',
      oppScore: '140',
      statusContains: 'Stumps',
      leadTrailContains: 'trail by 79',
    },
  },
  {
    name: 'CFLL — PAK vs AUS 3rd ODI',
    file: '/tmp/cfl_pak_aus.html',
    url: 'https://cricketfastliveline.in/live-score/pak-vs-aus-3rd-match-one-day-australia-tour-of-pakistan-2026/a-rz--cricket--dU2053078607550640131',
    expect: {
      format: 'ODI',
      batTeamAbbr: 'PAK',
      batScore: '161/6',
      batOvers: '41.5',
    },
  },
];

const api = poller;

let allPass = true;
for (const t of TESTS) {
  console.log(`\n━━━ ${t.name} ━━━`);
  if (!fs.existsSync(t.file)) {
    console.log(`  ✗ File missing: ${t.file}`);
    allPass = false;
    continue;
  }
  const html = fs.readFileSync(t.file, 'utf8');
  const title = api.extractTitle(html);
  const result = api.tryParse(html, t.url, title);

  if (!result) {
    console.log('  ✗ tryParse returned null');
    allPass = false;
    continue;
  }

  console.log('  parsed:', JSON.stringify(result, null, 2).split('\n').map(l => '    ' + l).join('\n'));

  // Validate expectations
  for (const [k, v] of Object.entries(t.expect || {})) {
    if (k === 'statusContains') {
      const ok = (result.status || '').includes(v);
      console.log(`  ${ok ? '✓' : '✗'} status contains "${v}": "${result.status}"`);
      if (!ok) allPass = false;
    } else if (k === 'leadTrailContains') {
      const ok = (result.leadTrail || '').includes(v);
      console.log(`  ${ok ? '✓' : '✗'} leadTrail contains "${v}": "${result.leadTrail}"`);
      if (!ok) allPass = false;
    } else if (k === 'target') {
      const ok = result.target && result.target.total === v;
      console.log(`  ${ok ? '✓' : '✗'} target total = ${v}: ${result.target ? result.target.total : 'none'}`);
      if (!ok) allPass = false;
    } else if (k === 'bowlerName') {
      const ok = result.bowler && result.bowler.name.includes(v);
      console.log(`  ${ok ? '✓' : '✗'} bowler name contains "${v}": ${result.bowler ? result.bowler.name : 'none'}`);
      if (!ok) allPass = false;
    } else if (k === 'batTeam') {
      const ok = result.teams[0]?.name === v;
      console.log(`  ${ok ? '✓' : '✗'} team1 name = "${v}": "${result.teams[0]?.name}"`);
      if (!ok) allPass = false;
    } else if (k === 'batTeamAbbr') {
      const ok = result.teams[0]?.abbr === v || result.teams[0]?.name === v;
      console.log(`  ${ok ? '✓' : '✗'} team1 abbr = "${v}": "${result.teams[0]?.abbr || result.teams[0]?.name}"`);
      if (!ok) allPass = false;
    } else if (k === 'batScore') {
      const ok = result.teams[0]?.score === v;
      console.log(`  ${ok ? '✓' : '✗'} team1 score = "${v}": "${result.teams[0]?.score}"`);
      if (!ok) allPass = false;
    } else if (k === 'batOvers') {
      const ok = result.teams[0]?.overs === v;
      console.log(`  ${ok ? '✓' : '✗'} team1 overs = "${v}": "${result.teams[0]?.overs}"`);
      if (!ok) allPass = false;
    } else if (k === 'oppTeam') {
      const ok = result.teams[1]?.name === v;
      console.log(`  ${ok ? '✓' : '✗'} team2 name = "${v}": "${result.teams[1]?.name}"`);
      if (!ok) allPass = false;
    } else if (k === 'oppTeamAbbr') {
      const ok = result.teams[1]?.abbr === v || result.teams[1]?.name === v;
      console.log(`  ${ok ? '✓' : '✗'} team2 abbr = "${v}": "${result.teams[1]?.abbr || result.teams[1]?.name}"`);
      if (!ok) allPass = false;
    } else if (k === 'oppScore') {
      const ok = result.teams[1]?.score === v || result.teams[1]?.score?.startsWith(v);
      console.log(`  ${ok ? '✓' : '✗'} team2 score = "${v}": "${result.teams[1]?.score}"`);
      if (!ok) allPass = false;
    } else if (k === 'oppOvers') {
      const ok = result.teams[1]?.overs === v;
      console.log(`  ${ok ? '✓' : '✗'} team2 overs = "${v}": "${result.teams[1]?.overs}"`);
      if (!ok) allPass = false;
    } else if (k === 'format') {
      const ok = result.format === v;
      console.log(`  ${ok ? '✓' : '✗'} format = "${v}": "${result.format}"`);
      if (!ok) allPass = false;
    }
  }
}

const SYNTHETIC_TESTS = [
  {
    name: 'Cricbuzz compact scorecard infers completed innings wickets',
    html: `
      <html><head><title>ENG vs NZ 1st Test Live Cricket Score</title></head>
      <body>
        <div class="miniscore-branding-container">
          <div>ENG 140 (39.4)</div>
          <div>NZ 61/6 (19.2)</div>
        </div>
        <div>Day 1: Stumps - New Zealand trail by 79 runs</div>
      </body></html>
    `,
    url: 'https://www.cricbuzz.com/live-cricket-scores/129552/eng-vs-nz-1st-test-new-zealand-tour-of-england-2026',
    check: (result) => result?.teams?.[0]?.abbr === 'NZ' && result?.teams?.[1]?.score === '140/10',
  },
  {
    name: 'CFLL does not render unknown opponent innings as 0/0',
    html: '<html><head><title>PAK: 161/6 (41.5) | PAK vs AUS Live score, 3rd Match | CFLL</title></head><body></body></html>',
    url: 'https://cricketfastliveline.in/live-score/pak-vs-aus-3rd-match-one-day-australia-tour-of-pakistan-2026/a-rz--cricket--dU2053078607550640131',
    check: (result) => result?.teams?.[0]?.score === '161/6' && result?.teams?.[1]?.score === '' && result?.teams?.[1]?.note === 'Yet to bat',
  },
  {
    name: 'CFLL supports score titles with no wicket separator',
    html: '<html><head><title>IND 42 (6.3) | IND vs SL Live score | CFLL</title></head><body></body></html>',
    url: 'https://cricketfastliveline.in/live-score/ind-vs-sl-1st-t20i/a-rz--cricket--demo',
    check: (result) => result?.teams?.[0]?.score === '42/0' && result?.teams?.[0]?.overs === '6.3',
  },
];

for (const t of SYNTHETIC_TESTS) {
  console.log(`\n━━━ ${t.name} ━━━`);
  const result = api.tryParse(t.html, t.url, api.extractTitle(t.html));
  const ok = t.check(result);
  console.log('  parsed:', JSON.stringify(result, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  console.log(`  ${ok ? '✓' : '✗'} regression check`);
  if (!ok) allPass = false;
}

console.log(`\n━━━ Overall: ${allPass ? 'ALL PASS' : 'FAILURES'} ━━━\n`);
process.exit(allPass ? 0 : 1);
