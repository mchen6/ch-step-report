'use strict';
// The triage result, assembled: a summary and the parts in a fixed
// field order, so every answer reads the same way. The receipt is not here:
// the runtime attaches it, from what it counted.

const RUN = ['id', 'url', 'branch', 'commit', 'workflow', 'job', 'step'];
const HISTORY = ['signature', 'count', 'window', 'verdict', 'firstSeen', 'lastSeen', 'runIds'];
const SEEN = ['runId', 'commit', 'createdAt'];
// At most this many failed jobs are listed; the note counts them all.
const MAX_LISTED_JOBS = 50;
const COVERAGE = ['runsListed', 'failedRuns', 'logsFetched', 'logsExpired', 'logsTruncated', 'logsUnavailable', 'cacheHits', 'capHit', 'historyRebuilt'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const short = (sha) => sha.slice(0, 7);

const unavailableOf = (coverage) => (coverage != null && Array.isArray(coverage.logsUnavailable) ? coverage.logsUnavailable : []);

// "; 1 log expired, 2 truncated, 1 unavailable": what the history could not
// see, only when there is any; the first count names "log(s)". Then
// "; history rebuilt (...)" when the cache was rebuilt.
function gapsOf(coverage) {
  const count = (k) => (coverage != null && Number.isInteger(coverage[k]) ? coverage[k] : 0);
  const parts = [[count('logsExpired'), 'expired'], [count('logsTruncated'), 'truncated'], [unavailableOf(coverage).length, 'unavailable']].filter(([n]) => n > 0);
  const logs = parts.length === 0 ? '' : '; ' + parts.map(([n, what], i) => (i === 0 ? `${n} log${n === 1 ? '' : 's'} ${what}` : `${n} ${what}`)).join(', ');
  // The scenario's cache was rebuilt because the failure signature's algorithm
  // changed (0.3.0): a "new" verdict right after an upgrade is read as such.
  return logs + (coverage != null && coverage.historyRebuilt === true ? '; history rebuilt (the failure signature changed)' : '');
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

// Every failed job of the run (0.4.0), listed by the scenario in GitHub's
// order. Which of them gate the run, GitHub's jobs do not say (a
// continue-on-error job fails the same way), so with more than one the
// summary says so first rather than guess (the reviewer, 2026-11-13).
// The summary at most SUMMARY_MAX characters (its parts are bounded; this
// bounds their sum), cut with …, never between a surrogate pair's halves.
const SUMMARY_MAX = 1000;
function cutSummary(t) {
  if (t.length <= SUMMARY_MAX) return t;
  let end = SUMMARY_MAX - 1;
  const c = t.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return `${t.slice(0, end)}…`;
}

function jobsNote(failedJobs) {
  if (failedJobs == null || failedJobs.length < 2) return '';
  const listed = failedJobs.length > MAX_LISTED_JOBS ? ` (the first ${MAX_LISTED_JOBS} listed)` : '';
  return `${failedJobs.length} jobs failed${listed}; the pack cannot tell which ones gate the run. `;
}

// {run, failedJobs?, errors, history, ownerHint, coverage} ->
// {summary, run, failed_jobs, errors, history, owner_hint, coverage}, in that
// order. failed_jobs is null when the caller gave none (a 0.3.0 caller): not
// known, which an empty list would not say.
function assembleReport({run, failedJobs, errors, history, ownerHint, coverage}) {
  return {
    summary: cutSummary(jobsNote(failedJobs) + summaryOf(run, history, coverage)),
    run: pick(run, RUN),
    failed_jobs: failedJobs == null ? null : failedJobs.slice(0, MAX_LISTED_JOBS).map((j) => ({job: j.name, step: j.step, first_error: j.firstError})),
    errors: [...errors],
    history: history == null ? null : {...pick(history, HISTORY), firstSeen: pick(history.firstSeen, SEEN), lastSeen: pick(history.lastSeen, SEEN)},
    owner_hint: ownerHint == null ? null : {logins: [...ownerHint.logins], why: [...ownerHint.why]},
    coverage: {...pick(coverage, COVERAGE), logsUnavailable: unavailableOf(coverage).map((u) => ({runId: u.runId, job: u.job})), historyRebuilt: coverage != null && coverage.historyRebuilt === true}
  };
}

module.exports = {assembleReport, summaryOf, MAX_LISTED_JOBS, FIELDS: {RUN, HISTORY, SEEN, COVERAGE}};
