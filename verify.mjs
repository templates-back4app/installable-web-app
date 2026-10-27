// Proves the two claims this app makes, against a real Chrome, with no test framework:
//   1. it meets every installability criterion, so a browser offers to install it;
//   2. it still renders with the network cut and the server stopped.
//
// Node 22+ only (it uses the built-in WebSocket to speak the DevTools protocol).
//   node verify.mjs
// Set CHROME=/path/to/chrome to point at a different binary.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try { await stat(c); return c; } catch {}
  }
  throw new Error(`No Chrome found. Set CHROME=/path/to/chrome.\nTried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
}

// --- a static server, so the service worker gets a real origin (localhost counts as secure) ---
let served = 0;
function startServer() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      served += body.length;
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// --- the smallest usable DevTools client ---
class CDP {
  #ws; #id = 0; #pending = new Map(); #listeners = new Map();
  static async attach(wsUrl) {
    const c = new CDP();
    c.#ws = new WebSocket(wsUrl);
    await new Promise((ok, err) => { c.#ws.onopen = ok; c.#ws.onerror = () => err(new Error('cannot reach Chrome')); });
    c.#ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.#pending.has(m.id)) {
        const { ok, err } = c.#pending.get(m.id);
        c.#pending.delete(m.id);
        m.error ? err(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) {
        for (const fn of c.#listeners.get(m.method) ?? []) fn(m.params);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, err) => this.#pending.set(id, { ok, err }));
  }
  on(method, fn) { this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), fn]); }
  close() { this.#ws.close(); }
}

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

const server = await startServer();
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = await findChrome();
const profile = await mkdtemp(join(tmpdir(), 'pwa-verify-'));

const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

// Chrome prints the DevTools endpoint on stderr when the port is 0.
const wsBrowser = await new Promise((ok, err) => {
  let buf = '';
  const t = setTimeout(() => err(new Error('Chrome did not report a DevTools endpoint')), 20000);
  proc.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(t); ok(m[0]); }
  });
});

const browser = await CDP.attach(wsBrowser);
const { product } = await browser.send('Browser.getVersion');
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const page = await CDP.attach(wsBrowser.replace(/\/devtools\/browser\/.*/, `/devtools/page/${targetId}`));

await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Network.enable');

let transferred = 0;
page.on('Network.loadingFinished', (p) => { transferred += p.encodedDataLength ?? 0; });

const loaded = () => new Promise((ok) => page.on('Page.loadEventFired', ok));
const evaluate = async (expr) => {
  const r = await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluation failed');
  return r.result.value;
};

// ---- 1. first load ----
const t0 = Date.now();
const firstLoad = loaded();
await page.send('Page.navigate', { url: `${origin}/index.html` });
await firstLoad;
const loadMs = Date.now() - t0;
const firstBytes = transferred;

// ---- 2. the manifest, as Chrome itself parses it ----
const manifest = await page.send('Page.getAppManifest');
const parsed = JSON.parse(manifest.data ?? '{}');
check('manifest parses with no errors', (manifest.errors ?? []).filter((e) => e.critical).length === 0,
  JSON.stringify((manifest.errors ?? []).map((e) => e.message)));
check('name and short_name present', Boolean(parsed.name && parsed.short_name), `${parsed.name} / ${parsed.short_name}`);
check('display is standalone or fullscreen', ['standalone', 'fullscreen', 'minimal-ui'].includes(parsed.display), parsed.display);
check('start_url present', Boolean(parsed.start_url), parsed.start_url);
const sizes = (parsed.icons ?? []).map((i) => i.sizes);
check('icons include 192px and 512px', sizes.some((s) => s?.includes('192')) && sizes.some((s) => s?.includes('512')), sizes.join(' '));
check('a maskable icon is offered', (parsed.icons ?? []).some((i) => (i.purpose ?? '').includes('maskable')), 'purpose=maskable');

// Chrome's own verdict, where the build still exposes it.
try {
  const { installabilityErrors } = await page.send('Page.getInstallabilityErrors');
  check("Chrome reports no installability errors", (installabilityErrors ?? []).length === 0,
    (installabilityErrors ?? []).map((e) => e.errorId).join(', ') || 'none');
} catch {
  results.push({ name: "Chrome's installability verdict", pass: null, detail: 'not exposed by this build' });
}

// ---- 3. the service worker ----
// Bounded, so a page that registers nothing reports a failure instead of hanging here.
// `ready` resolves as soon as there is an active worker, which can still be
// 'activating' for a moment — so poll to 'activated' rather than reading it once.
const swReady = `Promise.race([
  navigator.serviceWorker.ready.then(async (r) => {
    for (let i = 0; i < 100; i++) {
      if (r.active && r.active.state === 'activated') return 'activated';
      await new Promise((d) => setTimeout(d, 50));
    }
    return r.active ? r.active.state : 'no active worker';
  }),
  new Promise(r => setTimeout(() => r('none registered'), 8000)),
])`;
const swState = await evaluate(swReady);
check('a service worker is active', swState === 'activated', `state=${swState}`);
const controlled = await evaluate('Boolean(navigator.serviceWorker.controller)');
check('the page is controlled by it', controlled === true, `controller=${controlled}`);
const cached = await evaluate(`caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys()))).then(a => a.flat().length))`);
check('the shell is in the cache', cached >= 4, `${cached} entries`);

// ---- 4. the real test: no network, no server ----
transferred = 0;
await page.send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});
await new Promise((ok) => server.close(ok));   // the origin is not merely unreachable: it is gone
await sleep(200);

// Prove the server really is down, from outside the browser, so "it worked offline"
// cannot be the server quietly still answering.
let refused = false;
try { await fetch(`${origin}/index.html`); } catch (e) { refused = true; var refusedWith = e.cause?.code ?? e.message; }
check('the origin is genuinely gone', refused, refused ? refusedWith : 'the server still answered');

const offlineLoad = loaded();
await page.send('Page.reload', { ignoreCache: false });
await offlineLoad;

const heading = await evaluate(`document.querySelector('h1') && document.querySelector('h1').textContent`);
check('it still renders with the server stopped', heading === 'Shift Notes', `h1=${JSON.stringify(heading)}`);
const interactive = await evaluate(`Boolean(document.querySelector('#add') && document.querySelector('#list'))`);
check('it is still interactive offline', interactive === true, `form and list present`);
const navOnline = await evaluate('navigator.onLine');
check('the browser agrees it is offline', navOnline === false, `navigator.onLine=${navOnline}`);
const offlineBytes = transferred;

// ---- report ----
await page.send('Browser.close').catch(() => {});
browser.close(); page.close();
proc.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  installable web app — verification (${product})\n`);
for (const r of results) {
  const mark = r.pass === null ? '–' : r.pass ? '✓' : '✗';
  console.log(`  ${mark} ${pad(r.name, 42)} ${r.detail ?? ''}`);
}
console.log(`\n  first load            ${firstBytes} bytes over the wire, ${loadMs} ms to load event`);
console.log(`  served from disk      ${served} bytes`);
console.log(`  offline reload        ${offlineBytes} bytes over the wire\n`);

const failed = results.filter((r) => r.pass === false);
if (failed.length) { console.error(`  ${failed.length} check(s) failed\n`); process.exit(1); }
console.log('  all checks passed\n');
