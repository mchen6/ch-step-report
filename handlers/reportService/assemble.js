'use strict';
// ch-step-report/reportService.assemble: {run, errors, history, ownerHint,
// coverage} -> the result with its summary, in a fixed field order.
const {assembleReport} = require('../../lib/report');

const INPUT = ['run', 'errors', 'history', 'ownerHint', 'coverage'];
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
const ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const isCoverage = (c) => isObject(c) && COUNTS.every((k) => Number.isInteger(c[k]) && c[k] >= 0) && typeof c.capHit === 'boolean'
  && Array.isArray(c.logsUnavailable) && c.logsUnavailable.length <= MAX_UNAVAILABLE
  && c.logsUnavailable.every((u) => isObject(u) && typeof u.runId === 'string' && typeof u.job === 'string' && !ADDRESS.test(u.job));
const isHint = (o) => o === null || (isObject(o) && Array.isArray(o.logins) && Array.isArray(o.why)
  && o.logins.length <= 3 && o.logins.length === o.why.length
  && o.logins.every((l) => typeof l === 'string' && NOT_A_NAME_OR_ADDRESS.test(l)) && o.why.every((w) => typeof w === 'string'));

module.exports = async (input) => {
  const ok = isObject(input) && Object.keys(input).every((k) => INPUT.includes(k))
    && isObject(input.run) && (input.run.step === null || typeof input.run.step === 'string')
    && Array.isArray(input.errors) && input.errors.every((e) => typeof e === 'string')
    && isHistory(input.history)
    && isHint(input.ownerHint)
    && isCoverage(input.coverage);
  if (!ok) throw new DeviceError('ARGUMENTS_INVALID', 'expected {run, errors: string[], history|null, ownerHint|null, coverage with logsTruncated and logsUnavailable} in the triage result\'s shapes');
  return {output: assembleReport(input)};
};
