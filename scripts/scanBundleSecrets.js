/**
 * Bundle secret scan — fails if a credential looks baked into dist/.
 *
 * Why this exists: the SDK authenticates to ingest with an `Authorization: Basic`
 * header built from a write key the *customer* passes at init time
 * (docs/sdk-hardening/BACKEND.md item 1 is the plan to remove that header
 * entirely). The value must therefore arrive at runtime and never be a literal
 * in the shipped file. Nothing enforced that, and the deploy path overwrites a
 * single mutable CDN URL for every customer — so a key committed by accident
 * ships to everyone with no artifact to roll back to.
 *
 * Design constraint: LOW FALSE POSITIVES, because a scanner that cries wolf on
 * a minified bundle gets skipped. Every pattern below was calibrated against the
 * real bundle (measured 2026-08-11, 81.81 kB), and the two things that naively
 * look like secrets in it are explicitly tolerated:
 *
 *   1. The string `Authorization` appears 5 times — it is the header NAME. Only
 *      an `Authorization`/`Basic`/`Bearer` followed by a literal credential VALUE
 *      is a finding; the bare name is not.
 *   2. A 62-character run `ABCDEFG...xyz0123456789` appears — it is the base62
 *      alphabet constant used by the id generator. Sequential alphabets are
 *      excluded by an entropy/ordering check rather than by hardcoding it, so a
 *      real 62-char key in the same place would still be caught.
 *
 * Usage: node scripts/scanBundleSecrets.js [path]   (default dist/intempt.min.js)
 * Exit 0 = clean, 1 = findings, 2 = could not read the bundle.
 */

import { readFileSync, existsSync } from 'node:fs';

const target = process.argv[2] || 'dist/intempt.min.js';

if (!existsSync(target)) {
  console.error(
    `[scan:secrets] ${target} not found. Run \`npm run build\` first.`,
  );
  process.exit(2);
}

const bundle = readFileSync(target, 'utf-8');

/**
 * A long alphanumeric run is only interesting if it looks random. Charset
 * constants, base36 digit tables and repeated padding are long but ordered, and
 * they are the entire false-positive population in a minified bundle.
 */
function looksRandom(s) {
  // A strictly ascending or descending character sequence is a charset table,
  // not a key. Allow a couple of steps backwards so a real key is not excluded
  // by coincidence.
  let descents = 0;
  for (let i = 1; i < s.length; i++) {
    if (s.charCodeAt(i) <= s.charCodeAt(i - 1)) descents++;
  }
  const monotonic = descents <= 2 || descents >= s.length - 3;
  if (monotonic) return false;

  // Shannon entropy per character. Real base64 credentials sit above ~4.0 bits;
  // repetitive or low-variety runs sit well below.
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    entropy -= p * Math.log2(p);
  }
  if (entropy < 4.0) return false;

  // A credential is a mix; a run of only letters or only digits usually is not.
  const hasDigit = /[0-9]/.test(s);
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  return hasDigit && (hasLower || hasUpper);
}

const findings = [];

function report(rule, detail) {
  findings.push({ rule, detail });
}

// --- 1. Vendor key formats. These are unambiguous: no legitimate reason for
// any of them to appear in this SDK, so they are exact-match and zero-tolerance.
const vendorPatterns = [
  ['AWS access key id', /AKIA[0-9A-Z]{16}/g],
  ['AWS secret access key', /aws_secret_access_key\s*[=:]\s*\S{20,}/gi],
  ['GitHub personal access token', /gh[pousr]_[A-Za-z0-9]{36,}/g],
  ['GitHub fine-grained PAT', /github_pat_[A-Za-z0-9_]{60,}/g],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/g],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['Stripe secret key', /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}/g],
  ['PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  [
    'JSON web token',
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  ],
];

for (const [name, re] of vendorPatterns) {
  const hits = bundle.match(re);
  if (hits) report(name, `${hits.length} match(es), first: ${redact(hits[0])}`);
}

// --- 2. An auth scheme followed by a literal value. The header name alone is
// expected and ignored; `Basic <base64>` as a literal is not. The credential in
// this SDK is assembled at runtime, so the bundle only ever contains the bare
// prefix `"Basic "` before a concatenation.
const literalAuth = /(?:Basic|Bearer)\s+([A-Za-z0-9+/=_-]{16,})/g;
for (const m of bundle.matchAll(literalAuth)) {
  report('auth scheme with a literal credential', redact(m[0]));
}

// --- 3. An assignment of a credential-ish name to a non-empty string literal.
// Minified code keeps object keys and string values, so a committed key most
// plausibly appears exactly like this.
const assigned =
  /["'`]?(?:api[_-]?key|apikey|secret|password|passwd|write[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)["'`]?\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi;
for (const m of bundle.matchAll(assigned)) {
  // Placeholders and env-substitution leftovers are not credentials.
  const value = m[1];
  if (
    /^(?:\{\{|\$\{|<|process\.env|undefined|null|xxx+|todo|changeme|example)/i.test(
      value,
    )
  ) {
    continue;
  }
  report('credential-named field assigned a string literal', redact(m[0]));
}

// --- 4. Long high-entropy blobs, entropy-filtered per looksRandom() above.
const blobs = bundle.match(/[A-Za-z0-9+/]{40,}={0,2}/g) || [];
for (const blob of new Set(blobs)) {
  if (looksRandom(blob)) {
    report(
      'long high-entropy string, possible encoded credential',
      `${blob.length} chars: ${redact(blob)}`,
    );
  }
}

function redact(s) {
  const flat = String(s).replace(/\s+/g, ' ');
  if (flat.length <= 16) return flat;
  return `${flat.slice(0, 12)}…${flat.slice(-4)} (${flat.length} chars)`;
}

if (findings.length === 0) {
  console.log(
    `[scan:secrets] clean — no credential patterns in ${target} (${bundle.length} bytes).`,
  );
  process.exit(0);
}

console.error(
  `[scan:secrets] ${findings.length} possible credential(s) in ${target}:\n`,
);
for (const f of findings) {
  console.error(`  • ${f.rule}\n      ${f.detail}`);
}
console.error(
  `
This gate exists because the deploy path overwrites a single mutable CDN URL
(/v1/intempt.min.js) for every customer. If a finding is a false positive, add a
narrow exclusion to scripts/scanBundleSecrets.js and say in the comment why the
value is safe -- do not widen a pattern or delete the rule.`,
);
process.exit(1);
