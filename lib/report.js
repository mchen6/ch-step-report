'use strict';
// The triage result, assembled: one summary sentence and the parts in a fixed
// field order, so every answer reads the same way. The receipt is not here:
// the runtime attaches it, from what it counted.

const RUN = ['id', 'url', 'branch', 'commit', 'workflow', 'job', 'step'];
const HISTORY = ['signature', 'count', 'window', 'verdict', 'firstSeen', 'lastSeen', 'runIds'];
const SEEN = ['runId', 'commit', 'createdAt'];
const COVERAGE = ['runsListed', 'failedRuns', 'logsFetched', 'logsExpired', 'logsTruncated', 'logsUnavailable', 'cacheHits', 'capHit'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const short = (sha) => sha.slice(0, 7);

const unavailableOf = (coverage) => (coverage != null && Array.isArray(coverage.logsUnavailable) ? coverage.logsUnavailable : []);

// "; 1 log expired, 2 truncated, 1 unavailable": what the history could not
// see, only when there is any; the first count names "log(s)".
function gapsOf(coverage) {
  const count = (k) => (coverage != null && Number.isInteger(coverage[k]) ? coverage[k] : 0);
  const parts = [[count('logsExpired'), 'expired'], [count('logsTruncated'), 'truncated'], [unavailableOf(coverage).length, 'unavailable']].filter(([n]) => n > 0);
  if (parts.length === 0) return '';
  return '; ' + parts.map(([n, what], i) => (i === 0 ? `${n} log${n === 1 ? '' : 's'} ${what}` : `${n} ${what}`)).join(', ');
}

// One sentence: the step, the verdict, how often in the window, since when,
// and what the history could not see.
// The window is the runs that were in it (a repository with 12 runs is not
// "the last 50"), and the step's name is put on one line.
function summaryOf(run, history, coverage) {
  const who = run.step == null ? 'The job' : `Step '${run.step.replace(/\s+/g, ' ').trim()}'`;
  if (history == null) return `${who} failed; it has no failure history: its log was not read (expired, unavailable or over the log cap)${gapsOf(coverage)}.`;
  const {verdict, count, firstSeen} = history;
  const listed = coverage != null && Number.isInteger(coverage.runsListed) && coverage.runsListed > 0 ? coverage.runsListed : history.window;
  const window = Math.min(history.window, listed);
  const gaps = gapsOf(coverage);
  if (verdict === 'new') return `${who} failed with a new signature, seen only in this run of the last ${window} runs${gaps}.`;
  if (count === 1) return `${who} failed with a ${verdict} signature seen once in the last ${window} runs, at ${short(firstSeen.commit)}${gaps}.`;
  return `${who} failed with a ${verdict} signature seen ${count} times in the last ${window} runs, first at ${short(firstSeen.commit)}${gaps}.`;
}

// {run, errors, history, ownerHint, coverage} ->
// {summary, run, errors, history, owner_hint, coverage}, in that order.
function assembleReport({run, errors, history, ownerHint, coverage}) {
  return {
    summary: summaryOf(run, history, coverage),
    run: pick(run, RUN),
    errors: [...errors],
    history: history == null ? null : {...pick(history, HISTORY), firstSeen: pick(history.firstSeen, SEEN), lastSeen: pick(history.lastSeen, SEEN)},
    owner_hint: ownerHint == null ? null : {logins: [...ownerHint.logins], why: [...ownerHint.why]},
    coverage: {...pick(coverage, COVERAGE), logsUnavailable: unavailableOf(coverage).map((u) => ({runId: u.runId, job: u.job}))}
  };
}

module.exports = {assembleReport, summaryOf, FIELDS: {RUN, HISTORY, SEEN, COVERAGE}};
