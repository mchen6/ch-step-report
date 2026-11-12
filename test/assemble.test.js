'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('./support');
const {assembleReport, summaryOf} = require('../lib/report');
const assemble = require('../handlers/reportService/assemble');

const SIG = 'e'.repeat(64);
const fixture = () => ({
  coverage: {runsListed: 50, failedRuns: 6, logsFetched: 4, logsExpired: 1, logsTruncated: 0, logsUnavailable: [], cacheHits: 1, capHit: false},
  ownerHint: {logins: ['octocat'], why: ['octocat: author of a1b2c3d, the commit where this failure first appeared']},
  history: {
    signature: SIG, count: 4, window: 50, verdict: 'recurring', runIds: ['101', '105', '109', '112'],
    firstSeen: {runId: '101', commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', createdAt: '2026-11-01T10:00:00Z'},
    lastSeen: {runId: '112', commit: 'f00ba1200000000000000000000000000000000f', createdAt: '2026-11-11T10:00:00Z'}
  },
  errors: ['  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', '##[error]Process completed with exit code 1.'],
  run: {id: '112', url: 'https://github.com/example/widgets/actions/runs/112', branch: 'main', commit: 'f00ba1200000000000000000000000000000000f', workflow: 'CI', job: 'test (ubuntu-latest, 24)', step: 'Run npm test'}
});

test('assemble writes the summary sentence', () => {
  assert.strictEqual(assembleReport(fixture()).summary,
    "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; 1 log expired.");
});

test('the summary for each verdict and edge', () => {
  const s = (patch) => {
    const f = fixture();
    return summaryOf({...f.run, ...patch.run}, patch.history === null ? null : {...f.history, ...patch.history});
  };
  assert.strictEqual(s({history: {verdict: 'new', count: 1}}), "Step 'Run npm test' failed with a new signature, seen only in this run of the last 50 runs.");
  assert.strictEqual(s({history: {verdict: 'flaky', count: 3}}), "Step 'Run npm test' failed with a flaky signature seen 3 times in the last 50 runs, first at a1b2c3d.");
  assert.strictEqual(s({history: {verdict: 'recurring', count: 1}}), "Step 'Run npm test' failed with a recurring signature seen once in the last 50 runs, at a1b2c3d.");
  assert.strictEqual(s({run: {step: null}}), 'The job failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d.');
  assert.strictEqual(s({history: null}), "Step 'Run npm test' failed; it has no failure history: its log was not read (expired, unavailable or over the log cap).");
  assert.strictEqual(s({run: {step: 'Run a\n  b'}}), "Step 'Run a b' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d.");
});

// From /code-review medium on PR #8.
test('the summary counts the runs that were in the window, not the window asked for', () => {
  const f = fixture();
  f.coverage.runsListed = 12;
  assert.strictEqual(assembleReport(f).summary, "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 12 runs, first at a1b2c3d; 1 log expired.");
});

test('assemble keeps field order', () => {
  const out = assembleReport(fixture());
  assert.deepStrictEqual(Object.keys(out), ['summary', 'run', 'errors', 'history', 'owner_hint', 'coverage']);
  assert.deepStrictEqual(Object.keys(out.run), ['id', 'url', 'branch', 'commit', 'workflow', 'job', 'step']);
  assert.deepStrictEqual(Object.keys(out.history), ['signature', 'count', 'window', 'verdict', 'firstSeen', 'lastSeen', 'runIds']);
  assert.deepStrictEqual(Object.keys(out.coverage), ['runsListed', 'failedRuns', 'logsFetched', 'logsExpired', 'logsTruncated', 'logsUnavailable', 'cacheHits', 'capHit']);
  assert.deepStrictEqual(out.owner_hint, fixture().ownerHint);
  assert.deepStrictEqual(out.errors, fixture().errors);
  assert.strictEqual(JSON.stringify(out).includes('receipt'), false, 'the runtime adds the receipt, not this module');
});

test("the report passes owner-hint's logins through: their shape is owner-hint's to check", async () => {
  const hint = {logins: ['legacy-'], why: ['legacy-: author of a1b2c3d, the commit where this failure first appeared']};
  const {output} = await assemble({...fixture(), ownerHint: hint});
  assert.deepStrictEqual(output.owner_hint, hint);
});

test('an absent owner hint is null', () => {
  assert.strictEqual(assembleReport({...fixture(), ownerHint: null}).owner_hint, null);
});

test('handler validates its input', async () => {
  const invalid = (err) => err.code === 'ARGUMENTS_INVALID';
  const f = fixture();
  for (const bad of [{}, null, {...f, run: null}, {...f, run: {...f.run, step: 7}}, {...f, errors: [1]}, {...f, history: {...f.history, verdict: 'odd'}},
    {...f, history: {...f.history, count: 0}}, {...f, coverage: null}, {...f, extra: 1},
    {...f, history: {...f.history, count: 3}}, {...f, history: {...f.history, verdict: 'new'}},
    {...f, ownerHint: {logins: [7], why: ['x']}}, {...f, ownerHint: {logins: ['octo@example.com'], why: ['x']}}, {...f, ownerHint: {logins: ['Octo Cat'], why: ['x']}}, {...f, ownerHint: {logins: ['a', 'b'], why: ['a: x']}},
    {...f, ownerHint: {logins: ['a', 'b', 'c', 'd'], why: ['1', '2', '3', '4']}},
    {...f, coverage: {...f.coverage, logsTruncated: -1}}, {...f, coverage: {...f.coverage, logsTruncated: '2'}},
    {...f, coverage: {...f.coverage, logsUnavailable: 1}}, {...f, coverage: {...f.coverage, logsUnavailable: [{runId: '1'}]}}, {...f, coverage: {...f.coverage, logsUnavailable: [{runId: 1, job: 'j'}]}},
    // From /code-review medium on #1: every coverage field is checked, job names carry no address, the list is bounded.
    {...f, coverage: {...f.coverage, logsFetched: 'x'}}, {...f, coverage: {...f.coverage, cacheHits: -1}}, {...f, coverage: {...f.coverage, capHit: 'no'}},
    {...f, coverage: {...f.coverage, runsListed: undefined}},
    {...f, coverage: {...f.coverage, logsUnavailable: [{runId: '1', job: 'deploy (alice@example.com)'}]}},
    {...f, coverage: {...f.coverage, logsUnavailable: Array.from({length: 51}, (_, i) => ({runId: String(i), job: 'j'}))}}]) {
    await assert.rejects(assemble(bad), invalid, JSON.stringify(bad).slice(0, 80));
  }
  const {output} = await assemble(f);
  assert.deepStrictEqual(output, assembleReport(f));
});

test('the module is a part: never listed', () => {
  assert.deepStrictEqual(require('../package.json').countinghouse, {role: 'part'});
});

// Task 9 (reviewer, 2026-11-11): coverage states truncated and unavailable logs, not only expired ones.
test('the summary says how many logs were truncated or unavailable, only when there were any', () => {
  const f = fixture();
  assert.strictEqual(assembleReport(f).summary, "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; 1 log expired.");
  const s = (logsTruncated, unavailable) => assembleReport({...f, coverage: {...f.coverage, logsTruncated, logsUnavailable: unavailable}}).summary;
  // the fixture has one expired log
  assert.strictEqual(s(2, [{runId: '7', job: 'test (24)'}]), "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; 1 log expired, 2 truncated, 1 unavailable.");
  assert.strictEqual(s(1, []), "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; 1 log expired, 1 truncated.");
  const none = (patch) => assembleReport({...f, coverage: {...f.coverage, logsExpired: 0, ...patch}}).summary;
  assert.strictEqual(none({}), "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d.");
  assert.strictEqual(none({logsUnavailable: [{runId: '7', job: 'a'}, {runId: '8', job: 'b'}]}), "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; 2 logs unavailable.");
});

test('the unavailable logs are listed by run and job, in the order given', () => {
  const f = fixture();
  const unavailable = [{runId: '8', job: 'lint'}, {runId: '7', job: 'test (24)'}];
  assert.deepStrictEqual(assembleReport({...f, coverage: {...f.coverage, logsUnavailable: unavailable}}).coverage.logsUnavailable, unavailable);
});

// From /code-review medium on #1.
test('with no history the sentence still says what could not be seen', () => {
  const f = fixture();
  const out = assembleReport({...f, history: null, coverage: {...f.coverage, logsExpired: 0, logsTruncated: 3, logsUnavailable: [{runId: '9', job: 'test'}]}});
  assert.strictEqual(out.summary, "Step 'Run npm test' failed; it has no failure history: its log was not read (expired, unavailable or over the log cap); 3 logs truncated, 1 unavailable.");
});

test('a coverage from before 0.2.0 assembles, with no unavailable logs, rather than crashing', () => {
  const f = fixture();
  const old = {runsListed: 50, failedRuns: 6, logsFetched: 4, logsExpired: 1, cacheHits: 1, capHit: false};
  assert.deepStrictEqual(assembleReport({...f, coverage: old}).coverage.logsUnavailable, []);
});
