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
  assert.deepStrictEqual(Object.keys(out), ['summary', 'run', 'failed_jobs', 'errors', 'history', 'owner_hint', 'coverage']);
  assert.deepStrictEqual(Object.keys(out.run), ['id', 'url', 'branch', 'commit', 'workflow', 'job', 'step']);
  assert.deepStrictEqual(Object.keys(out.history), ['signature', 'count', 'window', 'verdict', 'firstSeen', 'lastSeen', 'runIds']);
  assert.deepStrictEqual(Object.keys(out.coverage), ['runsListed', 'failedRuns', 'logsFetched', 'logsExpired', 'logsTruncated', 'logsUnavailable', 'cacheHits', 'capHit', 'historyRebuilt']);
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

// The scenario's cache rebuilds when ch-step-failure-signature's algorithm
// changed (reviewer, 2026-11-12): the result says so, in coverage and in the
// summary, so a "new" verdict right after an upgrade is read as such.
test('a rebuilt history is in coverage and the summary; absent, it is false and silent', () => {
  const f = fixture();
  const rebuilt = assembleReport({...f, coverage: {...f.coverage, historyRebuilt: true}});
  assert.strictEqual(rebuilt.coverage.historyRebuilt, true);
  assert.strictEqual(rebuilt.summary, "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; 1 log expired; history rebuilt (the failure signature changed).");
  const plain = assembleReport(f);
  assert.strictEqual(plain.coverage.historyRebuilt, false);
  assert.doesNotMatch(plain.summary, /rebuilt/);
  const none = assembleReport({...f, coverage: {...f.coverage, logsExpired: 0, historyRebuilt: true}});
  assert.strictEqual(none.summary, "Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; history rebuilt (the failure signature changed).");
});

test('the handler takes historyRebuilt as a boolean and refuses anything else', async () => {
  const f = fixture();
  const {output} = await assemble({...f, coverage: {...f.coverage, historyRebuilt: true}});
  assert.strictEqual(output.coverage.historyRebuilt, true);
  await assert.rejects(assemble({...f, coverage: {...f.coverage, historyRebuilt: 'yes'}}), (e) => e.code === 'ARGUMENTS_INVALID');
  const Ajv2020 = require('ajv/dist/2020');
  const schema = require('../schema.json').reportService.assemble;
  const ajv = new Ajv2020({strict: false});
  assert.ok(ajv.validate(schema.input, {...f, coverage: {...f.coverage, historyRebuilt: true}}), JSON.stringify(ajv.errors));
  assert.ok(ajv.validate(schema.output, output), JSON.stringify(ajv.errors));
  assert.ok(!ajv.validate(schema.output, {...output, coverage: {...output.coverage, historyRebuilt: undefined}}) || output.coverage.historyRebuilt !== undefined);
});

// Every failed job of the run (dogfood of run 43497750749, the reviewer,
// 2026-11-13): the triage led with one job of nine. Each is listed by name,
// failing step and first error line; the pack cannot tell which ones gate
// the run, and the summary says so when more than one failed.
const JOBS = [
  {name: 'stdio (windows-latest)', step: 'Run stdio tests', firstError: "Error: ENOENT: no such file or directory, realpath 'lib/cli-options.js'"},
  {name: 'test (24)', step: 'Run npm test', firstError: 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:'},
  {name: 'sandbox-floor (22)', step: null, firstError: null}
];

test('every failed job is listed, in the order given, after the run', () => {
  const out = assembleReport({...fixture(), failedJobs: JOBS});
  assert.deepStrictEqual(out.failed_jobs, JOBS.map((j) => ({job: j.name, step: j.step, first_error: j.firstError})));
  assert.deepStrictEqual(Object.keys(out.failed_jobs[0]), ['job', 'step', 'first_error']);
});

test('with more than one failed job, the summary says how many and that the pack cannot tell which ones gate the run', () => {
  assert.strictEqual(assembleReport({...fixture(), failedJobs: JOBS}).summary,
    "3 jobs failed; the pack cannot tell which ones gate the run. Step 'Run npm test' failed with a recurring signature seen 4 times in the last 50 runs, first at a1b2c3d; 1 log expired.");
  assert.strictEqual(assembleReport({...fixture(), failedJobs: JOBS.slice(0, 1)}).summary, assembleReport(fixture()).summary, 'one job: no note');
});

test('an input from before 0.4.0 (no failedJobs) assembles with failed_jobs null (not known) and no note', () => {
  const out = assembleReport(fixture());
  assert.strictEqual(out.failed_jobs, null);
  assert.strictEqual(out.summary.startsWith('Step '), true);
});

test('the handler checks failedJobs: a name, step and first error with no address, the last two text or null, at most 1000', async () => {
  const invalid = (err) => err.code === 'ARGUMENTS_INVALID';
  const f = fixture();
  for (const bad of [{...f, failedJobs: 'x'}, {...f, failedJobs: [{name: 7, step: null, firstError: null}]},
    {...f, failedJobs: [{name: 'j', step: 1, firstError: null}]}, {...f, failedJobs: [{name: 'j', step: null, firstError: 2}]},
    {...f, failedJobs: [{name: 'j', step: null}]}, {...f, failedJobs: [{name: 'j', step: null, firstError: null, extra: 1}]},
    {...f, failedJobs: [{name: 'deploy (alice@example.com)', step: null, firstError: null}]},
    {...f, failedJobs: [{name: 'j', step: 'notify alice@example.com', firstError: null}]},
    {...f, failedJobs: [{name: 'j', step: null, firstError: 'Error: denied for alice@example.com'}]},
    {...f, failedJobs: Array.from({length: 1001}, (_, i) => ({name: `j${i}`, step: null, firstError: null}))}]) {
    await assert.rejects(assemble(bad), invalid, JSON.stringify(bad).slice(0, 80));
  }
  const {output} = await assemble({...f, failedJobs: JOBS});
  assert.deepStrictEqual(output, assembleReport({...f, failedJobs: JOBS}));
});

test('the output matches the declared output schema, with and without failed jobs', () => {
  const Ajv2020 = require('ajv/dist/2020');
  const schema = require('../schema.json').reportService.assemble.output;
  const validate = new Ajv2020({allowUnionTypes: true}).compile(schema);
  for (const input of [fixture(), {...fixture(), failedJobs: JOBS}, {...fixture(), failedJobs: Array.from({length: 60}, (_, i) => ({name: `j${i}`, step: null, firstError: null}))}]) {
    assert.ok(validate(assembleReport(input)), JSON.stringify(validate.errors));
  }
});

test('over 50 failed jobs, the first 50 are listed and the note counts them all', () => {
  const many = Array.from({length: 300}, (_, i) => ({name: `test (${i})`, step: 'Run npm test', firstError: null}));
  const out = assembleReport({...fixture(), failedJobs: many});
  assert.strictEqual(out.failed_jobs.length, 50);
  assert.strictEqual(out.failed_jobs[49].job, 'test (49)');
  assert.ok(out.summary.startsWith('300 jobs failed (the first 50 listed); the pack cannot tell which ones gate the run. '), out.summary);
});

// Bounded strings and a linear address check (the reviewer's review of #3,
// 2026-11-13).
test('every free-text string is bounded before anything else runs: names and steps 200, error lines 500, cut with …', async () => {
  const long = (n, c = 'x') => c.repeat(n);
  const f = fixture();
  const {output} = await assemble({...f, run: {...f.run, job: long(300), step: long(300)}, errors: [long(600)],
    failedJobs: [{name: long(300), step: long(300), firstError: long(600)}],
    coverage: {...f.coverage, logsUnavailable: [{runId: '1', job: long(300)}]}});
  assert.strictEqual(output.run.job, `${long(199)}…`);
  assert.strictEqual(output.run.step, `${long(199)}…`);
  assert.strictEqual(output.errors[0], `${long(499)}…`);
  assert.deepStrictEqual(output.failed_jobs[0], {job: `${long(199)}…`, step: `${long(199)}…`, first_error: `${long(499)}…`});
  assert.strictEqual(output.coverage.logsUnavailable[0].job, `${long(199)}…`);
  assert.ok(output.summary.length < 400, output.summary);
});

test('an address the cut would split is still refused: the check reads the strings as given', async () => {
  const f = fixture();
  for (const at of [480, 485, 490]) {
    const firstError = `${'x'.repeat(at)} bob@corp.example`;
    await assert.rejects(assemble({...f, failedJobs: [{name: 'j', step: null, firstError}]}), (e) => e.code === 'ARGUMENTS_INVALID', String(at));
  }
  await assert.rejects(assemble({...f, failedJobs: [{name: `${'n'.repeat(190)} al@corp.example`, step: null, firstError: null}]}), (e) => e.code === 'ARGUMENTS_INVALID');
});

test('workflow, branch and the owner-hint reasons are bounded too; a cut never splits a surrogate pair', async () => {
  const f = fixture();
  const emoji = '\u{1F600}';
  const {output} = await assemble({...f, run: {...f.run, workflow: 'w'.repeat(300), branch: `${'b'.repeat(198)}${emoji}${'b'.repeat(10)}`},
    ownerHint: {logins: ['octocat'], why: ['y'.repeat(800)]}});
  assert.strictEqual(output.run.workflow, `${'w'.repeat(199)}…`);
  assert.strictEqual(output.run.branch, `${'b'.repeat(198)}…`, 'the pair is not split');
  assert.strictEqual(output.owner_hint.why[0], `${'y'.repeat(499)}…`);
  await assert.rejects(assemble({...f, run: {...f.run, job: 7}}), (e) => e.code === 'ARGUMENTS_INVALID');
});

test('the schema bounds the output; the input\'s strings only at 20000, so a long name is cut, never refused by the runtime', () => {
  const Ajv2020 = require('ajv/dist/2020');
  const a = require('../schema.json').reportService.assemble;
  const i = a.input.properties;
  const o = a.output.properties;
  assert.deepStrictEqual([i.run.properties.job.maxLength, i.run.properties.step.maxLength, i.errors.items.maxLength,
    i.failedJobs.items.properties.name.maxLength, i.failedJobs.items.properties.step.maxLength, i.failedJobs.items.properties.firstError.maxLength], [20000, 20000, 20000, 20000, 20000, 20000]);
  const ofj = o.failed_jobs.anyOf[1].items.properties;
  assert.deepStrictEqual([o.run.properties.job.maxLength, o.run.properties.step.maxLength, o.errors.items.maxLength, ofj.job.maxLength, ofj.step.maxLength, ofj.first_error.maxLength],
    [200, 200, 500, 200, 200, 500]);
  // a 300-character job name passes the input schema (the runtime validates it before the handler)
  const f = fixture();
  const validIn = new Ajv2020({allowUnionTypes: true}).compile(a.input);
  assert.ok(validIn({...f, run: {...f.run, job: 'j'.repeat(300)}, failedJobs: [{name: 'n'.repeat(300), step: 's'.repeat(300), firstError: 'e'.repeat(600)}]}), JSON.stringify(validIn.errors));
});

test('every output string is bounded, and the output validates against the schema with every input string long', async () => {
  const Ajv2020 = require('ajv/dist/2020');
  const validOut = new Ajv2020({allowUnionTypes: true}).compile(require('../schema.json').reportService.assemble.output);
  const L = (n, c) => c.repeat(n);
  const f = fixture();
  const seen = {runId: L(100, '1'), commit: L(100, 'c'), createdAt: L(100, 't')};
  const {output} = await assemble({...f, run: {id: L(100, '9'), url: L(900, 'u'), branch: L(300, 'b'), commit: L(100, 'c'), workflow: L(300, 'w'), job: L(300, 'j'), step: L(300, 's')},
    history: {...f.history, firstSeen: seen, lastSeen: seen, runIds: f.history.runIds.map(() => L(100, '7'))},
    failedJobs: [{name: L(300, 'n'), step: L(300, 's'), firstError: L(900, 'e')}], errors: [L(900, 'x')]});
  assert.ok(validOut(output), JSON.stringify(validOut.errors));
  assert.ok(output.summary.length <= 500);
  assert.deepStrictEqual([output.run.id.length, output.run.url.length, output.run.commit.length, output.history.firstSeen.commit.length, output.history.runIds[0].length],
    [32, 500, 64, 64, 32]);
});

test('a login over 39 characters is refused, never cut; errors over 200 are refused', async () => {
  const f = fixture();
  await assert.rejects(assemble({...f, ownerHint: {logins: ['l'.repeat(40)], why: ['w']}}), (e) => e.code === 'ARGUMENTS_INVALID');
  const schema = require('../schema.json').reportService.assemble;
  assert.strictEqual(schema.input.properties.errors.maxItems, 200);
  assert.strictEqual(schema.output.properties.errors.maxItems, 200);
});

test('the address check is linear: a 40 KB string with many @ takes milliseconds, and it finds what the old pattern found', () => {
  const {hasAddress} = assemble;
  const started = Date.now();
  for (const s of ['a'.repeat(40000), '@'.repeat(40000), `${'a@'.repeat(20000)}`, `${'a@b'.repeat(13000)}`, 'x'.repeat(39999) + '@']) hasAddress(s);
  assert.ok(Date.now() - started < 200, `${Date.now() - started} ms`);
  const OLD = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  for (const s of ['alice@example.com', 'deploy (alice@example.com)', 'a@b.c', '@b.c', 'a@.c', 'a@b.', 'a@b', 'x a @b.c', 'a@@b.c', 'mail a@b.co.uk now',
    'two@ats@x.y', 'a@b .c', 'Error: denied for bob@corp.example', 'no address here', 'a@b.c@d', '.@..', 'a@b..c']) {
    assert.strictEqual(hasAddress(s), OLD.test(s), s);
  }
});

test('an unavailable log\'s run id is cut to 32, and the summary is at most 500 characters', async () => {
  const f = fixture();
  const {output} = await assemble({...f, run: {...f.run, step: 's'.repeat(300)}, failedJobs: Array.from({length: 3}, (_, i) => ({name: `j${i}`, step: null, firstError: null})),
    coverage: {...f.coverage, logsUnavailable: [{runId: '9'.repeat(20000), job: 'j'}]}});
  assert.strictEqual(output.coverage.logsUnavailable[0].runId, `${'9'.repeat(31)}…`);
  assert.ok(output.summary.length <= 500, String(output.summary.length));
  const o = require('../schema.json').reportService.assemble.output.properties;
  assert.deepStrictEqual([o.summary.maxLength, o.coverage.properties.logsUnavailable.items.properties.runId.maxLength], [500, 32]);
});
