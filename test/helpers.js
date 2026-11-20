/* test/helpers.js: shared test utilities (Node 20, no dependencies). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Pages are read from PAGES_ROOT (default: this worktree). After the restructure
// moves page logic into /assets/, point PAGES_ROOT at that build.
const PAGES_ROOT = process.env.PAGES_ROOT || ROOT;

const fixture = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const readRoot = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* A page is its HTML plus its /assets/pages/<module>*.js files (Phase 5 moved
   inline scripts there). `f` is the page path, e.g. 'funnel/index.html' or
   'index.html' (Home's module is 'home'). Single-file builds still work: with
   no module on disk the HTML alone is returned. */
const pageModule = f => (f === 'index.html' ? 'home' : f.split('/')[0]);
function pageModules(f){
  const dir = path.join(PAGES_ROOT, 'assets', 'pages');
  if(!fs.existsSync(dir)) return [];
  const mod = pageModule(f);
  return fs.readdirSync(dir).filter(n => n === mod + '.js' || (n.startsWith(mod + '.') && /^\d+\.js$/.test(n.slice(mod.length + 1))))
    .sort().map(n => path.join(dir, n));
}
const pageExists = f => fs.existsSync(path.join(PAGES_ROOT, f)) || pageModules(f).length > 0;
const readPage = f => {
  const html = path.join(PAGES_ROOT, f);
  const parts = fs.existsSync(html) ? [fs.readFileSync(html, 'utf8')] : [];
  for(const m of pageModules(f)) parts.push(fs.readFileSync(m, 'utf8'));
  if(!parts.length) throw new Error('page not found: ' + f);
  return parts.join('\n');
};

/* Every source file a figure can come from: pages, shared assets, lib, tools, workflows. */
function sourceFiles(){
  const out = [];
  const walk = (dir, depth) => {
    if(depth > 4 || !fs.existsSync(dir)) return;
    for(const e of fs.readdirSync(dir, { withFileTypes: true })){
      if(e.name.startsWith('.') && e.name !== '.github') continue;
      if(['node_modules', 'data', 'test'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if(e.isDirectory()) walk(p, depth + 1);
      else if(/\.(html|js|mjs|yml|yaml|py)$/.test(e.name)) out.push(p);
    }
  };
  walk(PAGES_ROOT, 0);
  if(PAGES_ROOT !== ROOT) for(const d of ['lib', 'tools', '.github']) walk(path.join(ROOT, d), 1);
  return [...new Set(out)];
}

/* Source text of a named function declaration, braces matched while skipping
   strings, template literals and comments. Enough for the page functions the
   tests run; it does not try to parse regex literals that contain braces. */
function extractFunction(src, name){
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if(!m) throw new Error('function ' + name + ' not found');
  let i = src.indexOf('{', src.indexOf(')', m.index));
  const start = m.index; let depth = 0;
  for(; i < src.length; i++){
    const c = src[i], n = src[i+1];
    if(c === '/' && n === '/'){ i = src.indexOf('\n', i); continue; }
    if(c === '/' && n === '*'){ i = src.indexOf('*/', i) + 1; continue; }
    if(c === '"' || c === "'" || c === '`'){
      const q = c; i++;
      while(i < src.length && src[i] !== q){ if(src[i] === '\\') i++; i++; }
      continue;
    }
    if(c === '{') depth++;
    if(c === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced function ' + name);
}
function extractConst(src, name){
  const m = new RegExp('(?:const|var|let)\\s+' + name + '\\s*=\\s*[^;]+;').exec(src);
  if(!m) throw new Error('const ' + name + ' not found');
  return m[0];
}

/* Run page snippets in a sandbox with a fixed clock. */
function sandbox(code, { now, globals = {} } = {}){
  const RealDate = Date;
  const fixed = now == null ? null : new RealDate(now).getTime();
  class FixedDate extends RealDate {
    constructor(...a){ if(a.length === 0 && fixed != null) super(fixed); else super(...a); }
    static now(){ return fixed != null ? fixed : RealDate.now(); }
  }
  const ctx = vm.createContext({ Date: FixedDate, Map, Set, Math, JSON, Number, String, Array, Object, isFinite, isNaN, parseFloat, parseInt, URLSearchParams, Promise, Error, console, ...globals });
  vm.runInContext(code, ctx);
  return ctx;
}

module.exports = { ROOT, PAGES_ROOT, fixture, readRoot, readPage, pageExists, sourceFiles, extractFunction, extractConst, sandbox };
