#!/usr/bin/env node
// Stamps the shared <head>, masthead (skip link, home link, utility links,
// section rail and disclosure menu), and footer into every page, between
// marker comments:
//
//   <!-- ci:head -->   ... <!-- /ci:head -->     inside <head>
//   <!-- ci:header --> ... <!-- /ci:header -->   first thing in <body>
//   <!-- ci:footer --> ... <!-- /ci:footer -->   last thing in <body>
//
// Everything between a pair of markers is generated: edit this file, not the
// pages, then run `node tools/stamp.mjs`. Idempotent. No runtime injection:
// the markup is in the HTML, so the nav and footer work without JavaScript.
//
//   node tools/stamp.mjs          stamp every page
//   node tools/stamp.mjs --check  exit 1 if any page is out of date

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://concreteindex.co';
const REPO = 'https://github.com/salarjalinous/concrete-index';
const FIRST_PUBLISH_YEAR = 2026;
const BUILD_YEAR = new Date().getUTCFullYear();

// ---------------------------------------------------------------- routes
// Current routes. Phase 5 renames (/bidding/, /contractors/, /agencies/) are
// approved but not promoted yet: change the href here when they are.
const R = {
  pipeline: '/pipeline/', bidding: '/solicitations/', awarded: '/awarded/', contracts: '/contracts/', funnel: '/funnel/',
  agencies: '/agency/', contractors: '/competitive/', regional: '/regional/',
  analysis: '/analysis/', briefing: '/briefing/',
  methodology: '/methodology/', about: '/about/', sources: '/sources/', privacy: '/privacy/', terms: '/terms/',
};
// Section rail, in funnel order (PRD 8.1).
const RAIL = [
  { label: 'Stages', links: [['Pipeline', R.pipeline], ['Bidding', R.bidding], ['Awarded', R.awarded], ['Contracts', R.contracts], ['Funnel', R.funnel]] },
  { label: 'Entities', links: [['Agencies', R.agencies], ['Contractors', R.contractors], ['Regional', R.regional]] },
  { label: 'Synthesis', links: [['Analysis', R.analysis], ['Briefing', R.briefing]] },
];
const UTILITY = [['Methodology', R.methodology], ['About', R.about]];

// ---------------------------------------------------------------- CSP (PRD 10.2)
const CSP_BASE = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src CONNECT; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; upgrade-insecure-requests";
const CONNECT = {
  editorial: "'self'",
  nyc: "'self' https://data.cityofnewyork.us",
  'nyc+ny': "'self' https://data.cityofnewyork.us https://data.ny.gov",
  self: "'self'",
};
export const csp = (type) => CSP_BASE.replace('CONNECT', CONNECT[type]);

// ---------------------------------------------------------------- pages
// file: path from the repo root. title: the nav label. type: CSP connect set.
// chart: loads Chart.js and the chart grammar. js: page modules in order.
// export: the PNG/CSV/PDF export controls the page had before Phase 5.
export const PAGES = [
  { file: 'index.html', route: '/', current: null, title: 'The Concrete Index · NYC Public Construction Demand', ogTitle: 'The Concrete Index',
    desc: 'The Concrete Index tracks NYC public construction capital, which agencies are awarding work, to whom, and how fast. Built on NYC Open Data, refreshed daily.',
    ogDesc: 'NYC public construction capital, tracked end to end.', type: 'nyc', css: 'home', js: ['home'], export: true },
  { file: 'pipeline/index.html', route: R.pipeline, current: R.pipeline, title: 'Pipeline',
    desc: 'The forward pipeline of NYC public construction: capital dollars funded but not yet spent, by phase, agency, and borough. Built on NYC Open Data.',
    ogDesc: 'NYC capital dollars funded but not yet spent.', type: 'nyc', chart: true, css: 'pipeline', js: ['pipeline'], export: true },
  { file: 'solicitations/index.html', route: R.bidding, current: R.bidding, title: 'Bidding',
    desc: "Every open NYC construction solicitation in one place, what's bidding right now, from the City Record, refreshed on every load.",
    ogDesc: 'NYC construction work bidding right now.', type: 'nyc', css: 'solicitations', js: ['solicitations'], export: true },
  { file: 'awarded/index.html', route: R.awarded, current: R.awarded, title: 'Awarded',
    desc: 'The Concrete Index tracks NYC public construction capital, which agencies are awarding work, to whom, and how fast. Built on NYC Open Data, refreshed daily.',
    ogDesc: 'NYC public construction capital, tracked end to end.', type: 'nyc', chart: true, css: 'awarded', js: ['awarded'], export: true },
  { file: 'contracts/index.html', route: R.contracts, current: R.contracts, title: 'Contracts',
    desc: "Search New York City construction contracts by ID, vendor, agency, or category, then open one contract to read its dates, amounts, payment velocity, and spend curve from the City's registered-contract and Checkbook spending records.",
    ogDesc: 'Search registered NYC construction contracts and open one to read its dates, amounts, payment velocity, and spend curve.', type: 'self', chart: true, css: 'contracts', js: ['contracts'], export: false },
  { file: 'funnel/index.html', route: R.funnel, current: R.funnel, title: 'Funnel',
    desc: 'NYC public construction capital from budget to payment: how committed dollars become awards and spending, and how fast each agency moves money.',
    ogDesc: 'How fast NYC capital commitments become cash.', type: 'nyc', chart: true, css: 'funnel', js: ['funnel'], export: true },
  { file: 'agency/index.html', route: R.agencies, current: R.agencies, title: 'Agencies',
    desc: 'Pick a New York City agency and read its construction demand: committed capital plan against awarded contracts, the trades it buys, the firms it pays, and a dollar-weighted borough footprint.',
    ogDesc: 'One agency at a time: committed versus awarded, top trades, top recipients, and where the work lands across the five boroughs.', type: 'nyc', chart: true, css: 'agency', js: ['agency'], export: true },
  { file: 'competitive/index.html', route: R.contractors, current: R.contractors, title: 'Contractors',
    desc: "Look up any NYC public-construction contractor's award record across City, Checkbook, and MTA/State data, then read the market structure of those awards by award value: count share, dollar share, top-N share, and an HHI-style concentration reading.",
    ogDesc: "Read one contractor's public award record across City and State construction, then see how award dollars and counts distribute across the market by size band.", type: 'nyc+ny', chart: true, css: 'competitive', js: ['competitive', 'competitive.2'], export: true },
  { file: 'regional/index.html', route: R.regional, current: R.regional, title: 'Regional',
    desc: "NYC public construction demand beyond City agencies: the School Construction Authority's active program and the MTA capital plan, from the public record.",
    ogDesc: 'The SCA and MTA demand pools, measured live.', type: 'nyc+ny', chart: true, css: 'regional', js: ['regional'], export: true },
  { file: 'analysis/index.html', route: R.analysis, current: R.analysis, title: 'Analysis',
    desc: 'The Concrete Index: a composite measure of NYC public construction demand since 2004, plus seasonality, budget escalation, and pipeline conversion analysis.',
    ogDesc: 'Two decades of NYC construction demand, in one number.', type: 'nyc', chart: true, css: 'analysis', js: ['analysis'], export: true },
  { file: 'briefing/index.html', route: R.briefing, current: R.briefing, title: 'Briefing',
    desc: 'The state of NYC public construction demand, written from the live public record every time the page loads.',
    ogDesc: 'The state of NYC construction demand, generated from the live public record.', type: 'nyc', css: 'briefing', js: ['briefing'], export: true },
  { file: 'about/index.html', route: R.about, current: R.about, title: 'About',
    desc: 'Who builds The Concrete Index and why: closing the information gap in NYC public construction.',
    ogDesc: 'Closing the information gap in NYC public construction.', type: 'editorial', css: 'about', js: ['about'], export: true },
  { file: '404.html', route: null, current: null, title: 'Page not found', robots: 'noindex',
    desc: 'This page is not part of The Concrete Index. Every section of the site is listed here.', type: 'editorial', css: '404', js: [] },
  { file: 'vendors/index.html', route: '/vendors/', current: null, title: 'Vendor Lookup has moved', robots: 'noindex,follow', refresh: R.contractors, canonical: R.contractors,
    desc: 'The contractor lookup now lives on the Contractors page of The Concrete Index.', type: 'editorial', css: 'vendors', js: [] },
  { file: 'velocity/index.html', route: '/velocity/', current: null, title: 'Agency Velocity has moved', robots: 'noindex,follow', refresh: R.agencies, canonical: R.agencies,
    desc: 'Agency velocity now lives on the Agencies page of The Concrete Index.', type: 'editorial', css: 'velocity', js: [] },
];

// ---------------------------------------------------------------- markup
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fullTitle = (p) => (p.title.includes('The Concrete Index') ? p.title : `${p.title} · The Concrete Index`);

const MARK = (size) => `<svg class="ci-mark" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path d="M60 39 A25 25 0 1 0 60 81" fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round"/><rect x="74" y="38" width="24" height="9.5" rx="1.5" fill="currentColor"/><rect x="74" y="72.5" width="24" height="9.5" rx="1.5" fill="currentColor"/><rect x="82.4" y="38" width="7.2" height="44" fill="currentColor"/><circle class="ci-mark__dot" cx="101" cy="84" r="5.6"/></svg>`;
const HOME_LINK = (size) => `<a class="ci-home" href="/" aria-label="The Concrete Index, home">${MARK(size)}<span class="ci-wordmark" aria-hidden="true">The Concrete Index<span class="ci-tick">.</span></span></a>`;
const ICON_MENU = '<svg class="ci-i-menu" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_CLOSE = '<svg class="ci-i-close" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function link(label, href, p) {
  const cur = p.current && href === p.current ? ' aria-current="page"' : '';
  return `<a href="${href}"${cur}>${label}</a>`;
}

function head(p) {
  const L = [];
  const canonical = p.canonical || p.route;
  L.push('<meta charset="utf-8">');
  L.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  L.push(`<meta http-equiv="Content-Security-Policy" content="${csp(p.type)}">`);
  L.push('<meta name="referrer" content="same-origin">');
  L.push('<meta name="color-scheme" content="light">');
  if (p.refresh) L.push(`<meta http-equiv="refresh" content="0; url=${p.refresh}">`);
  L.push(`<title>${esc(fullTitle(p))}</title>`);
  L.push(`<meta name="description" content="${esc(p.desc)}">`);
  if (p.robots) L.push(`<meta name="robots" content="${p.robots}">`);
  if (canonical) L.push(`<link rel="canonical" href="${SITE}${canonical}">`);
  if (!p.robots) {
    L.push('<meta property="og:type" content="website">');
    L.push(`<meta property="og:site_name" content="The Concrete Index">`);
    L.push(`<meta property="og:title" content="${esc(p.ogTitle || fullTitle(p))}">`);
    L.push(`<meta property="og:description" content="${esc(p.ogDesc || p.desc)}">`);
    L.push(`<meta property="og:url" content="${SITE}${p.route}">`);
    L.push(`<meta property="og:image" content="${SITE}/og-image.png">`);
    L.push('<meta property="og:image:width" content="1200">');
    L.push('<meta property="og:image:height" content="630">');
    L.push('<meta name="twitter:card" content="summary_large_image">');
    L.push(`<meta name="twitter:image" content="${SITE}/og-image.png">`);
  }
  L.push('<link rel="icon" href="/favicon.ico" sizes="32x32">');
  L.push('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  L.push('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  L.push('<link rel="manifest" href="/site.webmanifest">');
  L.push('<link rel="preload" href="/assets/fonts/public-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>');
  L.push('<link rel="preload" href="/assets/fonts/source-serif-4-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>');
  L.push('<link rel="stylesheet" href="/assets/tokens.css">');
  L.push('<link rel="stylesheet" href="/assets/ci.css">');
  if (p.css) L.push(`<link rel="stylesheet" href="/assets/pages/${p.css}.css">`);
  if (p.export) L.push('<meta name="ci:export" content="on">');
  L.push('<script src="/assets/ci.js" defer></script>');
  if (p.chart) {
    L.push('<script src="/assets/vendor/chart.umd.min.js" defer></script>');
    L.push('<script src="/assets/ci-chart.js" defer></script>');
  }
  for (const m of p.js) L.push(`<script src="/assets/pages/${m}.js" defer></script>`);
  return L.join('\n');
}

function header(p) {
  const groups = RAIL.map((g, i) => {
    const id = `ci-g-${g.label.toLowerCase()}`;
    return `<div class="ci-rail__group"><p class="ci-rail__label" id="${id}">${g.label}</p><ul class="ci-rail__list" aria-labelledby="${id}">${g.links.map(([l, h]) => `<li>${link(l, h, p)}</li>`).join('')}</ul></div>`;
  }).join('\n      ');
  const util = UTILITY.map(([l, h]) => link(l, h, p)).join('');
  return `<a class="ci-skip" href="#content">Skip to content</a>
<header class="ci-masthead">
  <div class="wrap ci-masthead__bar">
    ${HOME_LINK(26)}
    <nav class="ci-utility" aria-label="Site">${util}<a href="${REPO}" rel="noopener">Source</a></nav>
    <button class="ci-menu-btn" type="button" aria-expanded="false" aria-controls="ci-menu">${ICON_MENU}${ICON_CLOSE}<span class="ci-menu-btn__label">Menu</span></button>
  </div>
  <nav class="ci-rail" id="ci-menu" aria-label="Sections">
    <div class="wrap ci-rail__inner">
      ${groups}
      <div class="ci-rail__group ci-rail__group--utility"><p class="ci-rail__label" id="ci-g-site">Site</p><ul class="ci-rail__list" aria-labelledby="ci-g-site">${UTILITY.map(([l, h]) => `<li>${link(l, h, p)}</li>`).join('')}<li><a href="${REPO}" rel="noopener">Source</a></li></ul></div>
    </div>
  </nav>
</header>`;
}

function footer() {
  const years = BUILD_YEAR > FIRST_PUBLISH_YEAR ? `${FIRST_PUBLISH_YEAR}–${BUILD_YEAR}` : `${FIRST_PUBLISH_YEAR}`;
  const links = [['Methodology', R.methodology], ['Sources', R.sources], ['Privacy', R.privacy], ['Terms', R.terms]]
    .map(([l, h]) => `<li><a href="${h}">${l}</a></li>`).join('');
  return `<footer class="ci-footer">
  <div class="wrap ci-footer__inner">
    <div class="ci-footer__brand">
      ${HOME_LINK(22)}
      <p class="ci-footer__tag">NYC public construction capital, tracked end to end.</p>
    </div>
    <nav class="ci-footer__links" aria-label="Site information">
      <ul>${links}<li><a href="${REPO}" rel="noopener">Source on GitHub</a></li><li><a href="${REPO}/issues" rel="noopener">Report a correction</a></li></ul>
    </nav>
    <div class="ci-footer__meta">
      <p>Not affiliated with the City or State of New York or any employer.</p>
      <p><a href="${R.about}">© <span data-ci-year="${FIRST_PUBLISH_YEAR}">${years}</span> The Concrete Index</a></p>
    </div>
  </div>
</footer>`;
}

// ---------------------------------------------------------------- stamp
function replaceBlock(html, name, content, file) {
  const re = new RegExp(`<!-- ci:${name} -->[\\s\\S]*?<!-- /ci:${name} -->`);
  if (!re.test(html)) throw new Error(`${file}: missing <!-- ci:${name} --> markers`);
  return html.replace(re, () => `<!-- ci:${name} -->\n${content}\n<!-- /ci:${name} -->`);
}

const checkOnly = process.argv.includes('--check');
let stale = 0;
for (const p of PAGES) {
  const path = join(ROOT, p.file);
  if (!existsSync(path)) throw new Error(`missing page ${p.file}`);
  const before = readFileSync(path, 'utf8');
  let html = before;
  html = replaceBlock(html, 'head', head(p), p.file);
  html = replaceBlock(html, 'header', header(p), p.file);
  html = replaceBlock(html, 'footer', footer(), p.file);
  if (html !== before) {
    stale++;
    if (!checkOnly) writeFileSync(path, html);
  }
}
if (checkOnly && stale) { console.error(`stamp: ${stale} page(s) out of date; run node tools/stamp.mjs`); process.exit(1); }
console.log(checkOnly ? 'stamp: all pages current' : `stamp: ${PAGES.length} pages stamped (${stale} changed)`);
