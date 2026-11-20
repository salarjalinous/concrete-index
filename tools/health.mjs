#!/usr/bin/env node
// Scripted site health check (PRD 13, 14, 15). Playwright, Node 20.
//
//   node tools/health.mjs                      serve this checkout locally
//   node tools/health.mjs --mock               ...and answer the two data APIs
//                                              from data/*.json (offline runs)
//   node tools/health.mjs --base https://concreteindex.co
//   options: --external (also request off-site footer links)
//            --json <file> (write the full result)  --pages /a/,/b/ (subset)
//
// Checks, one row per page per check:
//   http       every sitemap URL returns 200; an unknown path returns 404
//   title      "<Page> · The Concrete Index" (Home: its own pattern),
//              60 characters or fewer, unique across the sitemap
//   meta       description 140 to 160 characters and unique (indexable pages)
//   favicon    /favicon.ico, /favicon.svg, /apple-touch-icon.png,
//              /site.webmanifest return 200 and every page links them
//   footer     every footer link returns 200 (off-site only with --external)
//   images     every <img> loads, is 150 KB or less, and is not drawn more
//              than 2x past its natural size
//   csp        0 securitypolicyviolation events, 0 page errors
//   overflow   scrollWidth == clientWidth at 320, 360, 390, 414
//   keyboard   first Tab lands on the skip link and Enter moves focus to
//              #content; below 1024 the menu opens on Enter, Esc closes it
//              and returns focus to the button
//   contrast   every visible text node against its rendered background
//              (4.5:1, or 3:1 at 24px+ or 18.66px+ bold) and every input,
//              select, and button boundary against its surround (3:1)
// Exit status 1 on any failure.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://concreteindex.co';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
const MOCK = !!opt('--mock'), EXTERNAL = !!opt('--external');

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* fall through */ }
  for (const dir of [process.env.PLAYWRIGHT_MODULES, '/opt/npm-tools/node_modules/'].filter(Boolean)) {
    try { return createRequire(path.join(dir, 'x.js'))('playwright'); } catch (e) { /* next */ }
  }
  console.error('health: playwright is not installed (npm install --no-save playwright)');
  process.exit(2);
}
const { chromium } = await loadPlaywright();

// ---------------------------------------------------------------- local server
let server = null, base = opt('--base');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };
if (!base || base === true) {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(ROOT, p);
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (p.endsWith('/')) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(ROOT, '404.html'))); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
base = String(base).replace(/\/$/, '');
const local = (u) => u.replace(SITE, base);

// Offline answers for the two data APIs, cut from the committed data files.
const cache = {};
function mockRows(u) {
  const map = { 'qyyg-4tf5': 'awards.json', 'fb86-vt7u': 'plan-latest.json', '3khw-qi8f': 'solicitations.json' };
  const m = u.pathname.match(/resource\/([a-z0-9-]+)\.json/);
  if (!m || !map[m[1]]) return [];
  let r = cache[m[1]] ||= JSON.parse(fs.readFileSync(path.join(ROOT, 'data', map[m[1]]), 'utf8'));
  const sel = u.searchParams.get('$select') || '', grp = u.searchParams.get('$group') || '', wh = u.searchParams.get('$where') || '';
  if (m[1] === 'fb86-vt7u') {
    const PERIODS = ['202509', '202505', '202501', '202409', '202405', '202401'];
    if (grp.includes('reporting_period') && !sel.includes('sum(')) return PERIODS.map((p) => ({ reporting_period: p }));
    const pm = wh.match(/reporting_period\s*=\s*'(\d+)'/);
    const P = pm ? pm[1] : PERIODS[0], k = 1 - 0.07 * Math.max(0, PERIODS.indexOf(P));
    r = r.map((x) => ({ ...x, reporting_period: P, spend_to_date: String((parseFloat(x.spend_to_date) || 0) * k) }));
  }
  const lim = +(u.searchParams.get('$limit') || 1000), off = +(u.searchParams.get('$offset') || 0);
  return r.slice(off, off + lim);
}

// ---------------------------------------------------------------- results
const rows = [];
const add = (check, page, ok, detail = '') => rows.push({ check, page, ok, detail: String(detail).slice(0, 400) });

async function status(url) {
  try { const r = await fetch(url, { redirect: 'follow' }); return { code: r.status, bytes: +(r.headers.get('content-length') || 0) || (await r.arrayBuffer()).byteLength }; }
  catch (e) { return { code: 0, err: e.message }; }
}

// ---------------------------------------------------------------- sitemap and HTTP
const sm = await (await fetch(base + '/sitemap.xml')).text();
let pages = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
if (opt('--pages')) pages = String(opt('--pages')).split(',');
for (const p of pages) { const s = await status(base + p); add('http', p, s.code === 200, s.code); }
{ const s = await status(base + '/no-such-page/really/'); add('http', '/no-such-page/really/', s.code === 404, s.code); }
for (const f of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/site.webmanifest']) { const s = await status(base + f); add('favicon', f, s.code === 200, s.code); }

// ---------------------------------------------------------------- browser
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : (fs.existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] } : {}));
async function openPage(p, width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  if (MOCK) {
    await page.route(/https:\/\/data\.(cityofnewyork\.us|ny\.gov)\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(mockRows(new URL(route.request().url()))) }));
  }
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  try { await page.goto(base + p, { waitUntil: 'networkidle', timeout: 90000 }); } catch (e) { errors.push('load: ' + e.message.slice(0, 120)); }
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

const CONTRAST = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  function bgOf(el) {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null; // text on an image: not measurable here
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let col = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) col = over(stack[i], col);
    return col;
  }
  const fails = [];
  let n = 0;
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (t) => t.nodeValue.trim() ? 1 : 2 });
  const seen = new Set();
  for (let t = tw.nextNode(); t; t = tw.nextNode()) {
    const el = t.parentElement;
    if (!el || seen.has(el) || el.closest('script,style,noscript,.ci-vh,[aria-hidden="true"],canvas,svg')) continue;
    seen.add(el);
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const bg = bgOf(el), fg = parse(cs.color);
    if (!bg || !fg) continue;
    n++;
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
    const r = ratio(over(fg, bg), bg);
    if (r < need - 0.005) fails.push(`text ${r.toFixed(2)}<${need} "${t.nodeValue.trim().slice(0, 40)}" (${el.tagName.toLowerCase()}.${[...el.classList].join('.')})`);
  }
  document.querySelectorAll('input:not([type=hidden]),select,textarea,button').forEach((el) => {
    if (!el.getClientRects().length) return;
    const cs = getComputedStyle(el);
    const bw = parseFloat(cs.borderTopWidth);
    const own = parse(cs.backgroundColor), around = bgOf(el.parentElement);
    if (!around) return;
    n++;
    // A control is told apart by its border, or else by its own fill.
    const edge = bw > 0 ? parse(cs.borderTopColor) : (own && own.a > 0 ? own : null);
    if (!edge) return;
    const r = ratio(over(edge, around), around);
    if (r < 2.995 && !(own && own.a > 0 && ratio(over(own, around), around) >= 3)) fails.push(`control ${r.toFixed(2)}<3 ${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')} "${(el.textContent || '').trim().slice(0, 20)}"`);
  });
  return { n, fails };
};

const titles = new Map(), descs = new Map();
for (const p of pages) {
  // 1280: head, CSP, images, contrast, footer links
  const { ctx, page, errors } = await openPage(p, 1280);
  const head = await page.evaluate(() => ({
    title: document.title,
    desc: (document.querySelector('meta[name="description"]') || {}).content || '',
    robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
    icons: ['link[rel="icon"][href="/favicon.ico"]', 'link[rel="icon"][href="/favicon.svg"]', 'link[rel="apple-touch-icon"]', 'link[rel="manifest"]'].every((s) => document.querySelector(s)),
    footer: [...document.querySelectorAll('.ci-footer a[href]')].map((a) => a.href),
    imgs: [...document.querySelectorAll('img')].map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0, nw: i.naturalWidth, w: i.getBoundingClientRect().width })),
    csp: window.__csp,
  }));
  const isHome = p === '/';
  const titleOk = (isHome ? head.title === 'The Concrete Index · NYC Public Construction Demand' : / · The Concrete Index$/.test(head.title)) && head.title.length <= 60 && !/—/.test(head.title);
  add('title', p, titleOk, head.title);
  (titles.get(head.title) || titles.set(head.title, []).get(head.title)).push(p);
  if (!/noindex/.test(head.robots)) {
    add('meta', p, head.desc.length >= 140 && head.desc.length <= 160, head.desc.length + ' chars');
    (descs.get(head.desc) || descs.set(head.desc, []).get(head.desc)).push(p);
  }
  add('favicon', p, head.icons, head.icons ? 'linked' : 'missing a favicon link');
  for (const href of [...new Set(head.footer)]) {
    const off = !href.startsWith(base) && !href.startsWith(SITE);
    if (off && !EXTERNAL) continue;
    const s = await status(off ? href : local(href));
    add('footer', p, s.code === 200, `${s.code} ${href}`);
  }
  for (const im of head.imgs) {
    const s = await status(local(im.src));
    add('images', p, im.ok && s.code === 200 && s.bytes <= 150 * 1024 && (!im.nw || im.w <= im.nw * 2 + 1), `${s.code} ${Math.round(s.bytes / 1024)} KB ${im.src}`);
  }
  add('csp', p, !head.csp.length && !errors.length, [...head.csp, ...errors].join(' | ') || '0 violations, 0 errors');
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  const c = await page.evaluate(CONTRAST);
  add('contrast', p, !c.fails.length, c.fails.length ? `${c.fails.length} of ${c.n}: ${c.fails.slice(0, 4).join(' ; ')}` : `${c.n} pairs`);
  // keyboard: skip link
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ci-skip'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const landed = await page.evaluate(() => document.activeElement && document.activeElement.id);
  add('keyboard', p, skip && landed === 'content', `skip link first: ${skip}; focus after Enter: #${landed}`);
  await ctx.close();

  // narrow widths: overflow; 390: menu
  for (const w of [320, 360, 390, 414]) {
    const o = await openPage(p, w, 800);
    await o.page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    await o.page.waitForTimeout(150);
    const ov = await o.page.evaluate(() => {
      const d = document.documentElement, out = [];
      if (d.scrollWidth > d.clientWidth) document.querySelectorAll('body *').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.right <= d.clientWidth + 1 || !e.getClientRects().length) return;
        for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return; }
        out.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')} ${Math.round(r.right)}`);
      });
      return [d.scrollWidth, d.clientWidth, out.slice(0, 4).join(', ')];
    });
    add('overflow', `${p} @${w}`, ov[0] <= ov[1], `scrollWidth ${ov[0]}, clientWidth ${ov[1]}${ov[2] ? '; past the edge: ' + ov[2] : ''}`);
    if (w === 390) {
      const r = await o.page.evaluate(async () => {
        const b = document.querySelector('.ci-menu-btn');
        if (!b || !b.getClientRects().length) return 'no menu button';
        b.focus();
        return 'ok';
      });
      if (r === 'ok') {
        await o.page.keyboard.press('Enter');
        await o.page.waitForTimeout(150);
        const opened = await o.page.evaluate(() => [document.querySelector('.ci-menu-btn').getAttribute('aria-expanded'), !!document.activeElement.closest('#ci-menu')]);
        await o.page.keyboard.press('Escape');
        await o.page.waitForTimeout(150);
        const closed = await o.page.evaluate(() => [document.querySelector('.ci-menu-btn').getAttribute('aria-expanded'), document.activeElement.classList.contains('ci-menu-btn')]);
        add('keyboard', `${p} menu`, opened[0] === 'true' && opened[1] && closed[0] === 'false' && closed[1], `open ${opened.join('/')}; after Esc ${closed.join('/')}`);
      } else add('keyboard', `${p} menu`, false, r);
    }
    await o.ctx.close();
  }
}
for (const [t, ps] of titles) if (ps.length > 1) add('title', ps.join(' '), false, `duplicate title "${t}"`);
for (const [d, ps] of descs) if (ps.length > 1) add('meta', ps.join(' '), false, `duplicate description "${d.slice(0, 60)}"`);
await browser.close();
if (server) server.close();

// ---------------------------------------------------------------- report
const failed = rows.filter((r) => !r.ok);
const byCheck = {};
for (const r of rows) { const b = byCheck[r.check] ||= { pass: 0, fail: 0 }; r.ok ? b.pass++ : b.fail++; }
console.log(`health: ${base}${MOCK ? ' (mocked data APIs)' : ''}, ${pages.length} pages`);
for (const [k, v] of Object.entries(byCheck)) console.log(`  ${k.padEnd(9)} ${v.pass} pass, ${v.fail} fail`);
for (const r of failed) console.log(`FAIL ${r.check} ${r.page}: ${r.detail}`);
if (opt('--json')) fs.writeFileSync(String(opt('--json')), JSON.stringify({ base, mock: MOCK, generated_at: new Date().toISOString(), rows }, null, 1));
process.exit(failed.length ? 1 : 0);
