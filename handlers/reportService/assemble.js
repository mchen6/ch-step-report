'use strict';
// ch-step-report/reportService.assemble: {run, failedJobs, errors, history,
// ownerHint, coverage} -> the result with its summary, in a fixed field order.
const {assembleReport} = require('../../lib/report');

const INPUT = ['run', 'failedJobs', 'errors', 'history', 'ownerHint', 'coverage'];
const VERDICTS = ['new', 'flaky', 'recurring'];
const isObject = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
// Machine values are held to their shapes (the sixth medium on the P3 fix:
// an id, a commit or a time is never text, so one that isn't its shape is
// the chain's bug, refused): a run id digits, a commit hex, a time ISO 8601.
const DIGITS = /^\d+$/;
const HEX = /^[0-9a-f]+$/;
const TIME = /^\d{4}-\d\d-\d\dT[0-9:.]+(?:Z|[+-]\d\d:\d\d)$/;
const isSeen = (s) => isObject(s) && typeof s.commit === 'string' && HEX.test(s.commit) && typeof s.runId === 'string' && DIGITS.test(s.runId)
  && typeof s.createdAt === 'string' && TIME.test(s.createdAt);
const isHistory = (h) => h === null || (isObject(h) && Number.isInteger(h.count) && h.count >= 1 && Number.isInteger(h.window) && h.window >= 1
  && VERDICTS.includes(h.verdict) && isSeen(h.firstSeen) && isSeen(h.lastSeen)
  && Array.isArray(h.runIds) && h.runIds.length === h.count && h.runIds.every((r) => typeof r === 'string' && DIGITS.test(r)) && (h.verdict !== 'new' || h.count === 1));
// A login's exact shape is ch-step-owner-hint's to check; this step keeps
// only the guarantee that matters at its boundary: no e-mail address and no
// display name ('@' or whitespace) can reach the report.
const NOT_A_NAME_OR_ADDRESS = /^[^@\s]+$/;
// Every count a non-negative integer, capHit a boolean, and the unavailable logs
// at most MAX_UNAVAILABLE, each a run id and a job name (one holding an
// address is withheld, below).
const COUNTS = ['runsListed', 'failedRuns', 'logsFetched', 'logsExpired', 'logsTruncated', 'cacheHits'];
const MAX_UNAVAILABLE = 50;
// Whether `text` holds an e-mail address: a run of non-space, non-@
// characters, an @, and a run holding a dot with a character on either side
// of it -- broad on purpose: ch-step-redact masks addresses upstream, so one
// reaching here is withheld, and a line that only looks like one (a version
// pin, a MySQL 'user'@'host') costs just its field, never the report (the
// reviewer's pre-work high on pack 1, P3, 2026-11-21, and the four mediums
// on its fix). Three exact shapes are not addresses, so common git errors
// keep their text:
// - an @ right after a redaction tag (://<basicAuth>@, <githubToken>@): the
//   user part is already masked;
// - the @ ending a URL's userinfo: right after "<scheme>://" (a scheme where
//   a user name is normal, starting its run) and only userinfo characters
//   or a whole tag (ssh://git@github.com/o/r.git, postgres://app@db.internal);
// - git's own user before a path or its password prompt: "git" starting its
//   run, then a host and a colon or 's (git@github.com:o/r.git,
//   git@github.com's password).
// Scanned out from each @, each look back bounded by the characters it
// takes, so it is linear in the text's length; the regular expression it
// replaced (/[^\s@]+@[^\s@]+\.[^\s@]+/) was quadratic (a 40 KB string took
// about 3 s; the reviewer, 2026-11-13).
const USER_SCHEMES = new Set(['ssh', 'git', 'git+ssh', 'ssh+git', 'http', 'https', 'ftp', 'ftps', 'sftp', 'postgres', 'postgresql',
  'mysql', 'mariadb', 'mongodb', 'mongodb+srv', 'redis', 'rediss', 'amqp', 'amqps', 'ldap', 'ldaps', 'smtp', 'smtps', 'imap', 'imaps']);
const SCHEME_CHAR = /[A-Za-z0-9+.-]/;
const USERINFO_CHAR = /[A-Za-z0-9._~%:-]/;
const USER_CHAR = /[A-Za-z0-9._-]/;
const SCHEME_START = /[\s"'`(<\[{=,;:>]/;
const GIT_START = /[\s"'`(\[]/;
// ch-step-redact's own tags (the reviewer's high on #7, L7): no other
// <letters> stands for a masked user part
// (every tag ch-step-redact 0.2.3 writes, lib/rules.js; the medium on the
// high round: kept in step with it by hand -- this part takes no dependency
// on redact)
const REDACT_TAGS = new Set(['jwt', 'basicAuth', 'githubToken', 'awsKey', 'token', 'apiKey', 'privateKey', 'secret', 'email', 'phone', 'card', 'ipv4']);
// The text as an address is read (the fifth and sixth mediums on the P3
// fix): one pass over a fixed map, never NFKC (whose expansions cost 60
// times as much on hostile input). A dot's lookalikes (． 。 ｡ ․ ﹒, and the
// cut's own … and ‥ as one dot) and %2E read as a dot; an @ written any
// other way (＠ ﹫ %40, or %2540 encoded twice) reads as ENC_AT, which is
// always an address's @: never a URL's userinfo, a tag's or git's.
const ENC_AT = '\uE000';
const LOOKALIKE = /%25(?:40|2e)|%40|%2e|[\uFF20\uFE6B\uFF0E\u3002\uFF61\u2024\uFE52\u2025\u2026]/gi;
const AS = {'%2540': ENC_AT, '%40': ENC_AT, '\uFF20': ENC_AT, '\uFE6B': ENC_AT};
const plain = (text) => String(text).replace(LOOKALIKE, (m) => AS[m.toLowerCase()] || '.');
const isAt = (c) => c === '@' || c === ENC_AT;
const isPart = (c) => !isAt(c) && !/\s/.test(c);
// A redaction tag of redact's own ending right before `at`, starting its
// run -> true. By character codes, no slice.
const isLetter = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const TAG_START = /[\s"'`(\[:/=,;]/;
function tagBefore(text, at) {
  if (text[at - 1] !== '>') return false;
  let k = at - 2;
  while (k >= 0 && at - 2 - k < 24 && isLetter(text.charCodeAt(k))) k--;
  if (k < 0 || text[k] !== '<' || k === at - 2) return false;
  if (!REDACT_TAGS.has(text.slice(k + 1, at - 1))) return false;
  return k === 0 || TAG_START.test(text[k - 1]);
}
// The host right after the @ at `at` -> whether it is an address's: a run up
// to the first delimiter, @ or space (after an optional quote), trailing
// dots trimmed, with a dot inside and a last label of letters, two or more
// (any script), or an IDN's xn-- (the reviewer's high on #7, L8: a version
// pin, react@16.8.0, is none). A forward scan, so linear in the host.
const HOST_END = /[\s/?#:,;"'()<>[\]`=&!*+|\\{}^]/;
// (the last label is read up to its first character no label takes -- a
// colour code, a quote, a dash, _, $ or a further %XX hides nothing -- and
// is letters with their marks, two or more, in any script, or an IDN's
// xn--: the medium on the high round)
const LABEL_CHAR = /[\p{L}\p{M}\p{N}-]/u;
const LAST_LABEL = /^(?:[\p{L}\p{M}]{2,}|xn--[A-Za-z0-9-]+)$/iu;
// (-> whether it is an address's; with hostEnd, also where the host ended,
// for the password rule below)
function addressHost(text, at, out = null) {
  let i = at + 1;
  if (text[i] === "'" || text[i] === '"') i++;
  const start = i;
  while (i < text.length && !isAt(text[i]) && !HOST_END.test(text[i])) i++;
  if (out != null) out.hostEnd = i;
  let end = i;
  while (end > start && text[end - 1] === '.') end--;
  const host = text.slice(start, end);
  const dot = host.lastIndexOf('.');
  if (dot <= 0) return false;
  let stop = dot + 1;
  while (stop < host.length && LABEL_CHAR.test(host[stop])) stop++;
  return LAST_LABEL.test(host.slice(dot + 1, stop));
}
// One pass. `authority` holds from just after a known scheme's "://" while
// only userinfo characters (or a whole redact tag) follow; the @ ending it is
// a URL's user name, and from there `host` holds to the end of the
// authority, where a second @ is an address's (the reviewer's high on #7,
// H1: postgres://svc@corp.com:pw@db). Each look back (the scheme, the user,
// a tag of at most 24 letters) stops at a character the other does not
// take, and each host scan at the next @ or delimiter, so the whole is
// linear in the text.
const DIGEST = /^sha(?:256:[0-9a-f]{64}|512:[0-9a-f]{128})(?![0-9a-z])/i;
function hasAddress(input) {
  const text = plain(input);
  let authority = false;
  let host = false;
  // (a redact <email> tag earlier in this run of non-space characters: the
  // user part was an address, so an @ after it is one's too -- the
  // reviewer's follow-up on #7: <email>:hunter2@db)
  let emailInRun = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) emailInRun = false;
    else if (c === '<' && text.startsWith('<email>', i)) emailInRun = true;
    if (c === ':' && text[i + 1] === '/' && text[i + 2] === '/') {
      let start = i;
      while (start > 0 && SCHEME_CHAR.test(text[start - 1])) start--;
      const scheme = text.slice(start, i).toLowerCase();
      authority = /^[a-z]/.test(scheme) && USER_SCHEMES.has(scheme) && (start === 0 || SCHEME_START.test(text[start - 1]));
      host = false;
      i += 2;
      continue;
    }
    if (!isAt(c)) {
      if (host && (/\s/.test(c) || c === '/' || c === '?' || c === '#')) host = false;
      if (!authority) continue;
      if (c === '<') {
        let k = i + 1;
        while (k < text.length && k - i <= 24 && isLetter(text.charCodeAt(k))) k++;
        if (text[k] === '>' && k > i + 1 && REDACT_TAGS.has(text.slice(i + 1, k))) { i = k; continue; }
      }
      if (!USERINFO_CHAR.test(c)) authority = false;
      continue;
    }
    // an @ in the host part, after the user name's, or after a masked
    // address in its run: an address
    if (host || emailInRun) return true;
    if (c === ENC_AT) {
      // (an encoded @ is an address's, wherever it is)
      authority = false;
      if (addressHost(text, i)) return true;
      continue;
    }
    const userinfo = authority;
    authority = false;
    if (userinfo) { host = true; continue; }
    if (i === 0 || !isPart(text[i - 1])) continue;
    if (tagBefore(text, i)) continue;
    let u = i;
    while (u > 0 && USER_CHAR.test(text[u - 1])) u--;
    if (text.slice(u, i) === 'git' && (u === 0 || GIT_START.test(text[u - 1])) && /^[A-Za-z0-9.-]+(?::|'s(?![A-Za-z]))/.test(text.slice(i + 1, i + 260))) continue;
    // an image digest, image@sha256:<64 hex> or @sha512:<128 hex>: an image
    // reference, never an address (the reviewer's final pass on the packs,
    // A3: `node:20-slim@sha256:a39f…: not found` withheld every error line)
    if ((text[i + 1] === 's' || text[i + 1] === 'S') && DIGEST.test(text.slice(i + 1, i + 140))) continue;
    const at = {};
    if (addressHost(text, i, at)) return true;
    // a host followed by ':' and a non-digit: a password, not a port
    // (svc@db:hunter2@x), never a port (svc@db:5432)
    const next = text[at.hostEnd + 1];
    if (text[at.hostEnd] === ':' && next != null && !/[\d\s]/.test(next)) return true;
  }
  return false;
}
const ADDRESS = {test: hasAddress};
const isCoverage = (c) => isObject(c) && COUNTS.every((k) => Number.isInteger(c[k]) && c[k] >= 0) && typeof c.capHit === 'boolean'
  && (c.historyRebuilt === undefined || typeof c.historyRebuilt === 'boolean')
  && Array.isArray(c.logsUnavailable) && c.logsUnavailable.length <= MAX_UNAVAILABLE
  && c.logsUnavailable.every((u) => isObject(u) && typeof u.runId === 'string' && DIGITS.test(u.runId) && typeof u.job === 'string');
// Every failed job of the run (0.4.0, optional): a name, the failing step and
// the first error line, each text (or null for the last two; one holding an
// address is withheld); at most a run's jobs (GitHub runs at most 256 per matrix, and a run
// may have several), of which the report lists the first 50.
const MAX_FAILED_JOBS = 1000;
const isFailedJob = (j) => isObject(j) && Object.keys(j).length === 3 && typeof j.name === 'string'
  && (j.step === null || typeof j.step === 'string') && (j.firstError === null || typeof j.firstError === 'string');

// Every text the triage result carries -- a failed job's name, step and
// first error, the run's job, step, workflow and branch, each error line,
// and an unavailable log's job name -- that holds an e-mail address is
// withheld: the note stands in its place and the rest of the report is kept
// (the reviewer's pre-work high on pack 1, P3, and the mediums on its fix).
// Read on the strings as given and again after the cut (bounded): a cut can
// drop what made a line no address (git@host: cut before its colon).
const WITHHELD = '(withheld: it holds an e-mail address)';
const unaddressed = (t) => (typeof t === 'string' && ADDRESS.test(t) ? WITHHELD : t);
// (check: unaddressed for the strings as given; after the cut, only the
// strings it changed, which end in …)
const cutOnly = (t) => (typeof t === 'string' && t.endsWith('…') ? unaddressed(t) : t);
function withheld(input, check = unaddressed) {
  const out = {...input};
  if (isObject(input.run)) {
    out.run = {...input.run, job: check(input.run.job), step: check(input.run.step), workflow: check(input.run.workflow), branch: check(input.run.branch), url: check(input.run.url)};
  }
  if (isObject(input.ownerHint) && Array.isArray(input.ownerHint.why)) out.ownerHint = {...input.ownerHint, why: input.ownerHint.why.map(check)};
  if (Array.isArray(input.errors)) out.errors = input.errors.map(check);
  if (Array.isArray(input.failedJobs)) out.failedJobs = input.failedJobs.map((j) => ({name: check(j.name), step: check(j.step), firstError: check(j.firstError)}));
  if (isObject(input.coverage) && Array.isArray(input.coverage.logsUnavailable)) {
    out.coverage = {...input.coverage, logsUnavailable: input.coverage.logsUnavailable.map((u) => ({...u, job: check(u.job)}))};
  }
  return out;
}
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
    out.coverage = {...input.coverage, logsUnavailable: input.coverage.logsUnavailable.map((u) => (isObject(u) ? {...u, runId: cut(u.runId, ID_MAX), job: cut(u.job, NAME_MAX)} : u))};
  }
  return out;
}

module.exports = async (input, ctx) => {
  const ok = isObject(input) && Object.keys(input).every((k) => INPUT.includes(k))
    && isObject(input.run) && typeof input.run.job === 'string' && (input.run.step === null || typeof input.run.step === 'string')
    && typeof input.run.id === 'string' && DIGITS.test(input.run.id) && typeof input.run.commit === 'string' && HEX.test(input.run.commit)
    && isFailedJobs(input.failedJobs)
    && Array.isArray(input.errors) && input.errors.every((e) => typeof e === 'string')
    && isHistory(input.history)
    && isHint(input.ownerHint)
    && isCoverage(input.coverage);
  if (!ok) throw ctx.error('INPUT_REJECTED', 'expected {run, failedJobs?: {name, step, firstError}[], errors: string[], history|null, ownerHint|null, coverage with logsTruncated and logsUnavailable} in the triage result\'s shapes');
  return {output: assembleReport(withheld(bounded(withheld(input)), cutOnly))};
};

module.exports.hasAddress = hasAddress;
module.exports.WITHHELD = WITHHELD;
module.exports.bounded = bounded;
