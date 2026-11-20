#!/usr/bin/env node
// Proves ci.fmt reproduces every number and date format the pages print.
// Each page formatter is read straight out of its module in assets/pages/,
// run in a sandbox, and compared with ci.fmt(value, kind) over a fixture set:
// boundary values for every rounding step, a few thousand log-spaced values,
// signed values, empties, dates across 2003 to 2027, and period strings.
// Exit 1 on the first mismatch per pairing.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ciSrc = readFileSync(join(ROOT, 'assets', 'ci.js'), 'utf8');
const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(ciSrc, sandbox);
const ci = sandbox.ci;

// Pull `function name(...){...}` (or a one-line arrow/const) out of a page module.
function extract(file, name) {
  const src = readFileSync(join(ROOT, 'assets', 'pages', file), 'utf8');
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (start < 0) throw new Error(`${file}: ${name} not found`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
const PRELUDE = `
  var EN = '\\u2013';
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTH_NAMES = MONTHS, MN = MONTHS;
  var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function esc(s){ return String(s==null?'':s).replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }`;
function pageFn(file, name, prelude = PRELUDE) {
  return vm.runInNewContext(`${prelude}\n${extract(file, name)}\n${name}`, {});
}

// ---------------------------------------------------------------- fixtures
const money = [0, 0.4, 0.5, 1, 499.5, 999.4, 999.5, 999.9, 1000, 1499.9, 1500, 9999, 99999, 999499, 999500, 999999,
  1e6, 1049999, 1.05e6, 9.95e6, 99.94e6, 99.95e6, 99.99e6, 100e6, 100.5e6, 999.4e6, 999.5e6, 999.99e6,
  1e9, 2.84e9, 2.845e9, 9.994e9, 9.995e9, 9.999e9, 10e9, 10.05e9, 107.9e9, 107.95e9, 1e12, -1, -1500, -2.5e6];
for (let e = -1; e <= 12; e += 0.0037) money.push(Math.pow(10, e), Math.round(Math.pow(10, e)));
const empties = [null, undefined, NaN];
const ratios = []; for (let x = -2; x <= 2; x += 0.00137) ratios.push(x);
ratios.push(0, 0.1, 0.0995, 0.09949, 0.1049, 1, -0.0004, 0.00049);
const pcts = []; for (let x = -120; x <= 120; x += 0.137) pcts.push(x);
pcts.push(0, -0, 0.4, 0.5, -0.4, -0.5, 99.5);
const dates = []; for (let t = Date.UTC(2003, 0, 1); t < Date.UTC(2027, 11, 31); t += 86400000 * 3.7) dates.push(new Date(t));
const dateStrings = ['2024-03-05', '2024-03-05T12:00:00.000', '2024-12-31T23:59:59.000', '2020-02-29', 'not a date', '<b>&', ''];
for (const d of dates.slice(0, 400)) dateStrings.push(d.toISOString().slice(0, 10), d.toISOString().slice(0, 19) + '.000');
const ym = []; for (let y = 2003; y <= 2027; y++) for (let m = 1; m <= 12; m++) ym.push(`${y}-${String(m).padStart(2, '0')}`);
const periods = ym.map((s) => s.replace('-', ''));

// ---------------------------------------------------------------- pairings
const P = [
  ['pipeline.js', 'fmtMoney', 'money', money],
  ['awarded.js', 'fmtMoney', 'money', money],
  ['funnel.js', 'fmtMoney', 'money', money],
  ['agency.js', 'fmtMoney', 'money', money],
  ['briefing.js', 'fmtMoney', 'money', money],
  ['regional.js', 'fmtMoney', 'money', money],
  ['competitive.2.js', 'fmtMoney', 'money', money],
  ['competitive.js', 'fmtMoney', 'money-b2', money],
  ['analysis.js', 'fmtMoney', 'money-k', money],
  ['contracts.js', 'fmtMoney', 'money?', money.concat(empties)],
  ['contracts.js', 'fmtMoneyFull', 'money-full?', money.concat(empties)],
  ['home.js', 'fmtMoney', 'money-compact', money.concat(empties, ['12', 'x', Infinity])],
  ['pipeline.js', 'fmtInt', 'int', money],
  ['competitive.js', 'fmtInt', 'int0', money.concat([0, null, undefined])],
  ['contracts.js', 'fmtInt', 'int?', money.concat(empties)],
  ['home.js', 'fmtInt', 'int-compact', money.concat(empties, ['12', 'x'])],
  ['agency.js', 'fmtPct', 'pct', ratios],
  ['contracts.js', 'fmtPct', 'pct?', ratios.concat(empties)],
  ['analysis.js', 'fmtPct', 'pct0', ratios],
  ['competitive.2.js', 'fmtPct', 'pct1-html?', ratios.concat([null])],
  ['briefing.js', 'fmtPct', 'pct-abs', pcts],
  ['analysis.js', 'fmtSignedPct', 'pct-signed', pcts],
  ['contracts.js', 'fmtDays', 'days?', money.concat(empties)],
  ['awarded.js', 'fmtDate', 'date', dates],
  ['solicitations.js', 'fmtDate', 'date', dates],
  ['regional.js', 'fmtDay', 'date', dates],
  ['contracts.js', 'fmtDate', 'date-utc?', dateStrings.concat([null, undefined])],
  ['contracts.js', 'fmtMonthTick', 'month-tick', ym.concat(['', null, '2024'])],
  ['awarded.js', 'fmtMonthLabel', 'month-label', ym],
  ['analysis.js', 'fmtYM', 'ym-short', ym],
  ['analysis.js', 'fmtPeriodLong', 'period-long', periods],
  ['agency.js', 'fmtPeriodLong', 'period-long', periods],
  ['funnel.js', 'fmtPeriodLong', 'period-long', periods],
  ['briefing.js', 'fmtPeriodLong', 'period-long', periods],
  ['pipeline.js', 'fmtPeriod', 'period-long?', periods.concat(['', null])],
  ['home.js', 'fmtMonth', 'month-long', ym.concat(['', null, '2026-13'])],
  // Home prints the index inline as Number(val).toFixed(1) (showIndex, fillAdjust).
  ['home.js', '<inline> Number(v).toFixed(1)', 'index', money.concat(pcts, [80.27, 80.25, 80.35, 66.45, '80.27'])],
];

const run = (f, v) => { try { return f(v); } catch (e) { return 'THROW ' + e.constructor.name; } };
let fail = 0, n = 0;
for (const [file, name, kind, values] of P) {
  const ref = name.startsWith('<inline>') ? (v) => Number(v).toFixed(1) : pageFn(file, name);
  if (name.startsWith('<inline>') && !readFileSync(join(ROOT, 'assets', 'pages', file), 'utf8').includes('Number(val).toFixed(1)')) throw new Error('home.js no longer formats the index inline');
  let bad = null;
  for (const v of values) {
    n++;
    // Dates cross the sandbox boundary; rebuild them inside each realm's Date.
    const a = run(ref, v), b = run((x) => ci.fmt(x, kind), v);
    if (a !== b) { bad = { v, a, b }; break; }
  }
  if (bad) { fail++; console.error(`FAIL ${file} ${name} vs ci.fmt(·,'${kind}'): ${String(bad.v)} -> "${bad.a}" vs "${bad.b}"`); }
  else console.log(`ok   ${file} ${name} == ci.fmt(·,'${kind}') over ${values.length} values`);
}
const unused = ci.fmt.kinds.filter((k) => !P.some((p) => p[2] === k));
if (unused.length) { fail++; console.error('kinds with no fixture: ' + unused.join(', ')); }
console.log(fail ? `test-fmt: ${fail} failure(s)` : `test-fmt: ${P.length} pairings, ${n} comparisons, all identical`);
process.exit(fail ? 1 : 0);
