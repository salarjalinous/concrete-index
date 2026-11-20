#!/usr/bin/env node
// Post-build checks for the static site (PRD 6.12, 9.3, 10.2). Exits 1 on any
// violation and prints file:line for each one.
//
//   HTML   no <script> without src (JSON-LD excepted), no <style>, no style=,
//          no on*= handlers, no em dashes, no banned buzzwords in visible
//          text, no third-party script/style/font/image/manifest sources,
//          CSP present with no 'unsafe-inline' or 'unsafe-eval', connect-src
//          matching the hosts the page's scripts call, skip link first in
//          <body>, one <main id="content">, shared blocks current.
//   CSS    no raw px/rem/em in margin, padding, gap, inset, or
//          scroll-padding/margin outside tokens.css; no third-party url();
//          no @import; no prefers-color-scheme.
//   JS     no em dashes; no style=" or on*=" in markup strings; no
//          third-party hosts other than the two public data APIs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'data', 'tools', 'test']);
const DATA_HOSTS = ['data.cityofnewyork.us', 'data.ny.gov'];
const BUZZ = /\b(unlock\w*|empower\w*|seamless\w*|cutting-edge|leverag\w*|robust\w*|revolutioni[sz]\w*|next-generation|actionable|game-changing|transform\w*|in today's landscape|dive into)\b/i;
const EM = /—/;
const problems = [];
const report = (file, line, msg) => problems.push(`${relative(ROOT, file)}:${line}: ${msg}`);
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const html = files.filter((f) => extname(f) === '.html');
const css = files.filter((f) => extname(f) === '.css');
const js = files.filter((f) => extname(f) === '.js' && !f.includes('/assets/vendor/'));

function each(re, text, fn) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) fn(m);
}

// ------------------------------------------------------------------ HTML
for (const f of html) {
  const t = readFileSync(f, 'utf8');
  each(/<script\b([^>]*)>/gi, t, (m) => {
    if (!/\ssrc=/.test(m[1]) && !/application\/ld\+json/.test(m[1])) report(f, lineOf(t, m.index), 'inline <script>');
  });
  each(/<style\b/gi, t, (m) => report(f, lineOf(t, m.index), 'inline <style>'));
  each(/<[a-z][^>]*?\sstyle\s*=/gi, t, (m) => report(f, lineOf(t, m.index), 'style attribute'));
  each(/<[a-z][^>]*?\son[a-z]+\s*=/gi, t, (m) => report(f, lineOf(t, m.index), 'inline event handler'));
  each(/javascript:/gi, t, (m) => report(f, lineOf(t, m.index), 'javascript: URL'));
  if (EM.test(t)) each(/—/g, t, (m) => report(f, lineOf(t, m.index), 'em dash'));
  // visible text and human-readable attributes
  const visible = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*\s(?:alt|title|aria-label|content|placeholder)="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ');
  const bm = visible.match(BUZZ);
  if (bm) report(f, 0, `banned word "${bm[0]}"`);
  if (/\binsights\b/i.test(visible)) report(f, 0, 'banned word "insights"');
  // third-party subresources (links to other sites are fine; loading from them is not)
  each(/<(script|img|source|iframe|link)\b[^>]*>/gi, t, (m) => {
    const tag = m[0];
    if (/^<link/i.test(tag) && /\brel="(canonical|noopener)"/.test(tag)) return;
    const u = (tag.match(/\s(?:src|href|srcset)="([^"]+)"/i) || [])[1];
    if (u && /^(https?:)?\/\//i.test(u)) report(f, lineOf(t, m.index), `third-party subresource ${u}`);
  });
  each(/url\(\s*['"]?(https?:)?\/\//gi, t, (m) => report(f, lineOf(t, m.index), 'third-party url()'));
  // CSP
  const cspM = t.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  if (!cspM) report(f, 0, 'missing CSP meta');
  else {
    const csp = cspM[1];
    if (/unsafe-inline|unsafe-eval/.test(csp)) report(f, 0, "CSP allows 'unsafe-inline' or 'unsafe-eval'");
    const connect = ((csp.match(/connect-src ([^;]+)/) || [])[1] || '').split(/\s+/).filter((x) => x.startsWith('https://')).map((x) => x.slice(8)).sort();
    // hosts the page's own scripts call
    const used = new Set();
    each(/<script\b[^>]*\ssrc="(\/assets\/pages\/[^"]+)"/g, t, (m) => {
      const src = readFileSync(join(ROOT, m[1]), 'utf8');
      for (const h of DATA_HOSTS) if (src.includes(`https://${h}`)) used.add(h);
    });
    const want = [...used].sort();
    if (JSON.stringify(want) !== JSON.stringify(connect)) report(f, 0, `CSP connect-src hosts [${connect}] do not match the hosts the page fetches [${want}]`);
  }
  if (!/<meta name="referrer" content="same-origin">/.test(t)) report(f, 0, 'referrer policy is not same-origin');
  if (!/<meta name="color-scheme" content="light">/.test(t)) report(f, 0, 'missing color-scheme light');
  const body = t.split(/<body[^>]*>/i)[1] || '';
  const firstTag = body.replace(/<!--[\s\S]*?-->/g, '').match(/<([a-z]+)[^>]*>/i);
  if (!firstTag || !/class="ci-skip"/.test(firstTag[0])) report(f, 0, 'skip link is not the first element in <body>');
  const mains = t.match(/<main\b[^>]*>/gi) || [];
  if (mains.length !== 1 || !/id="content"/.test(mains[0])) report(f, 0, 'expected exactly one <main id="content">');
  if (/LIVE DATA|badge-live/i.test(t)) report(f, 0, 'live badge');
  if (/fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare|unsplash\.com/.test(t)) report(f, 0, 'reference to a retired third-party host');
}

// ------------------------------------------------------------------ CSS
const SPACING = /^(margin|padding|gap|row-gap|column-gap|grid-gap|inset|scroll-padding|scroll-margin)(-[a-z-]+)?$/;
for (const f of css) {
  const t = readFileSync(f, 'utf8');
  const isTokens = f.endsWith('/assets/tokens.css');
  const noComments = t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  if (!isTokens) {
    each(/([a-z-]+)\s*:\s*([^;{}]+)/g, noComments, (m) => {
      if (!SPACING.test(m[1])) return;
      if (/(^|[^\w.-])-?\d*\.?\d+(px|rem|em)\b/.test(m[2])) report(f, lineOf(t, m.index), `raw length in ${m[1]}: ${m[2].trim()}`);
    });
  }
  each(/url\(\s*['"]?(https?:)?\/\//gi, noComments, (m) => report(f, lineOf(t, m.index), 'third-party url()'));
  each(/url\(\s*['"]?data:/gi, noComments, (m) => report(f, lineOf(t, m.index), "data: URL (img-src is 'self')"));
  each(/@import\b/g, noComments, (m) => report(f, lineOf(t, m.index), '@import'));
  each(/prefers-color-scheme/g, noComments, (m) => report(f, lineOf(t, m.index), 'prefers-color-scheme (site is light only)'));
  if (EM.test(t)) each(/—/g, t, (m) => report(f, lineOf(t, m.index), 'em dash'));
}

// ------------------------------------------------------------------ JS
for (const f of js) {
  const t = readFileSync(f, 'utf8');
  if (EM.test(t)) each(/—/g, t, (m) => report(f, lineOf(t, m.index), 'em dash'));
  each(/(?<![\w-])style\s*=\s*\\?["']/g, t, (m) => report(f, lineOf(t, m.index), 'style attribute in markup string'));
  each(/\son[a-z]+\s*=\s*\\?["']/g, t, (m) => report(f, lineOf(t, m.index), 'inline event handler in markup string'));
  each(/https?:\/\/([a-z0-9.-]+)/gi, t, (m) => {
    if (!DATA_HOSTS.includes(m[1].toLowerCase())) report(f, lineOf(t, m.index), `third-party host ${m[1]}`);
  });
  each(/\.setAttribute\(\s*['"]style['"]|\.cssText\s*=/g, t, (m) => report(f, lineOf(t, m.index), 'style set by attribute (blocked by CSP)'));
  each(/\beval\(|new Function\(/g, t, (m) => report(f, lineOf(t, m.index), 'eval'));
}

// ------------------------------------------------------------------ shared blocks current
try {
  execFileSync(process.execPath, [join(ROOT, 'tools', 'stamp.mjs'), '--check'], { stdio: 'pipe' });
} catch (e) {
  problems.push(String(e.stderr || e.stdout || e.message).trim());
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`check: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check: ${html.length} HTML, ${css.length} CSS, ${js.length} JS files clean`);
