'use strict';
// ch-step-report/reportService.assemble: {run, failedJobs, errors, history,
// ownerHint, coverage} -> the result with its summary, in a fixed field order.
const {assembleReport} = require('../../lib/report');

const INPUT = ['run', 'failedJobs', 'errors', 'history', 'ownerHint', 'coverage'];
const VERDICTS = ['new', 'flaky', 'recurring'];
const isObject = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const isSeen = (s) => isObject(s) && typeof s.commit === 'string';
const isHistory = (h) => h === null || (isObject(h) && Number.isInteger(h.count) && h.count >= 1 && Number.isInteger(h.window) && h.window >= 1
  && VERDICTS.includes(h.verdict) && isSeen(h.firstSeen) && isSeen(h.lastSeen)
  && Array.isArray(h.runIds) && h.runIds.length === h.count && (h.verdict !== 'new' || h.count === 1));
// A login's exact shape is ch-step-owner-hint's to check; this step keeps
// only the guarantee that matters at its boundary: no e-mail address and no
// display name ('@' or whitespace) can reach the report.
const NOT_A_NAME_OR_ADDRESS = /^[^@\s]+$/;
// Every count a non-negative integer, capHit a boolean, and the unavailable logs
// at most MAX_UNAVAILABLE, each a run id and a job name with no address in it.
const COUNTS = ['runsListed', 'failedRuns', 'logsFetched', 'logsExpired', 'logsTruncated', 'cacheHits'];
const MAX_UNAVAILABLE = 50;
// Whether `text` holds an e-mail address: a run of non-space, non-@
// characters, an @, and a run holding a dot with a character on either side
// of it. Scanned out from each @, so it is linear in the text's length; the
// regular expression it replaces (/[^\s@]+@[^\s@]+\.[^\s@]+/) was
// quadratic (a 40 KB string took about 3 s; the reviewer, 2026-11-13).
const isPart = (c) => c !== '@' && !/\s/.test(c);
function hasAddress(text) {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at === 0 || !isPart(text[at - 1])) continue;
    let end = at + 1;
    while (end < text.length && isPart(text[end])) end++;
    const domain = text.slice(at + 1, end);
    const dot = domain.indexOf('.', 1);
    if (dot !== -1 && dot < domain.length - 1) return true;
  }
  return false;
}
const ADDRESS = {test: hasAddress};
const isCoverage = (c) => isObject(c) && COUNTS.every((k) => Number.isInteger(c[k]) && c[k] >= 0) && typeof c.capHit === 'boolean'
  && (c.historyRebuilt === undefined || typeof c.historyRebuilt === 'boolean')
  && Array.isArray(c.logsUnavailable) && c.logsUnavailable.length <= MAX_UNAVAILABLE
  && c.logsUnavailable.every((u) => isObject(u) && typeof u.runId === 'string' && typeof u.job === 'string' && !ADDRESS.test(u.job));
// Every failed job of the run (0.4.0, optional): a name, the failing step and
// the first error line, each text (or null for the last two) with no address
// in it; at most a run's jobs (GitHub runs at most 256 per matrix, and a run
// may have several), of which the report lists the first 50.
const MAX_FAILED_JOBS = 1000;
const noAddress = (t) => typeof t === 'string' && !ADDRESS.test(t);
const isFailedJob = (j) => isObject(j) && Object.keys(j).length === 3 && noAddress(j.name)
  && (j.step === null || noAddress(j.step)) && (j.firstError === null || noAddress(j.firstError));
const isFailedJobs = (l) => l === undefined || (Array.isArray(l) && l.length <= MAX_FAILED_JOBS && l.every(isFailedJob));
const isHint = (o) => o === null || (isObject(o) && Array.isArray(o.logins) && Array.isArray(o.why)
  && o.logins.length <= 3 && o.logins.length === o.why.length
  && o.logins.every((l) => typeof l === 'string' && l.length <= LOGIN_MAX && NOT_A_NAME_OR_ADDRESS.test(l)) && o.why.every((w) => typeof w === 'string'));

// Every free-text string the report carries, bounded (the reviewer,
// 2026-11-13): a name (job, step, workflow, branch) at most 200 characters,
// an error line or an owner-hint reason at most 500, cut with "…". The
// schema holds the same bounds. The checks run on the strings as given,
// before the cut: the address check is linear, and a cut can only hide an
// address, never make one. What is not a string is left as it is.
const NAME_MAX = 200;
const LINE_MAX = 500;
// The other strings: ids, a URL, commits and times, cut to their bound too;
// a login is never cut (a cut one would name someone else), and one over
// GitHub's 39 characters is refused. A string taken in may be up to
// IN_MAX (the schema's input bound): the runtime refuses longer before this
// runs, and every check here is linear in it.
const ID_MAX = 32;
const URL_MAX = 500;
const COMMIT_MAX = 64;
const TIME_MAX = 40;
const LOGIN_MAX = 39;
// Cut at `max` with …, never between the two halves of a surrogate pair.
function cut(v, max) {
  if (typeof v !== 'string' || v.length <= max) return v;
  let end = max - 1;
  const c = v.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return `${v.slice(0, end)}…`;
}
function bounded(input) {
  if (!isObject(input)) return input;
  const out = {...input};
  if (isObject(input.run)) {
    out.run = {...input.run, job: cut(input.run.job, NAME_MAX), step: cut(input.run.step, NAME_MAX),
      workflow: cut(input.run.workflow, NAME_MAX), branch: cut(input.run.branch, NAME_MAX),
      id: cut(input.run.id, ID_MAX), url: cut(input.run.url, URL_MAX), commit: cut(input.run.commit, COMMIT_MAX)};
  }
  if (isObject(input.history)) {
    const seen = (s) => (isObject(s) ? {...s, runId: cut(s.runId, ID_MAX), commit: cut(s.commit, COMMIT_MAX), createdAt: cut(s.createdAt, TIME_MAX)} : s);
    out.history = {...input.history, firstSeen: seen(input.history.firstSeen), lastSeen: seen(input.history.lastSeen),
      runIds: Array.isArray(input.history.runIds) ? input.history.runIds.map((r) => cut(r, ID_MAX)) : input.history.runIds};
  }
  if (isObject(input.ownerHint) && Array.isArray(input.ownerHint.why)) out.ownerHint = {...input.ownerHint, why: input.ownerHint.why.map((w) => cut(w, LINE_MAX))};
  if (Array.isArray(input.errors)) out.errors = input.errors.map((e) => cut(e, LINE_MAX));
  if (Array.isArray(input.failedJobs)) {
    out.failedJobs = input.failedJobs.map((j) => (isObject(j) ? {...j, name: cut(j.name, NAME_MAX), step: cut(j.step, NAME_MAX), firstError: cut(j.firstError, LINE_MAX)} : j));
  }
  if (isObject(input.coverage) && Array.isArray(input.coverage.logsUnavailable)) {
    out.coverage = {...input.coverage, logsUnavailable: input.coverage.logsUnavailable.map((u) => (isObject(u) ? {...u, job: cut(u.job, NAME_MAX)} : u))};
  }
  return out;
}

module.exports = async (input) => {
  const ok = isObject(input) && Object.keys(input).every((k) => INPUT.includes(k))
    && isObject(input.run) && typeof input.run.job === 'string' && (input.run.step === null || typeof input.run.step === 'string')
    && isFailedJobs(input.failedJobs)
    && Array.isArray(input.errors) && input.errors.every((e) => typeof e === 'string')
    && isHistory(input.history)
    && isHint(input.ownerHint)
    && isCoverage(input.coverage);
  if (!ok) throw new DeviceError('ARGUMENTS_INVALID', 'expected {run, failedJobs?: {name, step, firstError}[], errors: string[], history|null, ownerHint|null, coverage with logsTruncated and logsUnavailable} in the triage result\'s shapes');
  return {output: assembleReport(bounded(input))};
};

module.exports.hasAddress = hasAddress;
module.exports.bounded = bounded;
