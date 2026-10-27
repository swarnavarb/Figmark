/**
 * The hands and eyes for human-style QA.
 *
 * One Chromium, one browser context per persona (Arjun the shop, Meera the
 * buyer, a brand-new signup...), kept alive between commands so a tester can
 * work the app a step at a time the way a person does: look at the screen,
 * decide, tap, look again. Each persona has its own cookies, so the buyer and
 * the seller of one order are two different people at two different phones.
 *
 * Commands arrive as JSON on POST /run from act.mjs. Nothing here knows about
 * Figmark's API: it only ever touches what is on screen.
 *
 *   node .claude/skills/qa-buy-sell/driver/server.mjs
 *
 * Env: QA_BASE_URL (default http://127.0.0.1:5173), QA_DRIVER_PORT (9333),
 * QA_OUT (screenshot folder, default qa-runs/<timestamp>), QA_HEADED=1,
 * QA_SLOWMO (ms between actions, default 120), QA_DEVICE=phone|desktop.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const PORT = Number(process.env.QA_DRIVER_PORT ?? 9333);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(process.env.QA_OUT ?? join('qa-runs', stamp));
mkdirSync(OUT, { recursive: true });

/** Playwright from the repo if it has it, else the copy installed globally. */
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return createRequire(join(root, 'noop.js'))('playwright');
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  headless: process.env.QA_HEADED !== '1',
  slowMo: Number(process.env.QA_SLOWMO ?? 120),
  ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}),
});

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 } };

/** persona -> { context, page, log: [] } */
const people = new Map();
// Carry on numbering after a driver restart rather than overwrite earlier shots.
let shotCount = readdirSync(OUT).filter((name) => name.endsWith('.png')).length;

async function person(name, device) {
  let entry = people.get(name);
  if (entry) return entry;
  const context = await browser.newContext({
    ...(device === 'desktop' || process.env.QA_DEVICE === 'desktop' ? DESKTOP : PHONE),
    baseURL: BASE,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  entry = { context, page, log: [] };
  // What a person would notice going wrong: the page throwing, or a request failing.
  page.on('pageerror', (err) => entry.log.push(`[pageerror] ${err.message}`));
  // "Failed to load resource" says nothing about which; the response line below names it.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) entry.log.push(`[console] ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) entry.log.push(`[http ${res.status()}] ${res.request().method()} ${res.url().replace(BASE, '')}`);
  });
  // QA_TRACE=1: every API call this persona makes, into the driver log - for debugging the driver itself.
  if (process.env.QA_TRACE === '1') {
    page.on('request', (r) => { if (r.url().includes('/api/')) console.log(`[${name}] ${r.method()} ${r.url().replace(BASE, '')}`); });
  }
  page.on('dialog', (dialog) => { entry.log.push(`[dialog] ${dialog.message()}`); void dialog.accept(); });
  people.set(name, entry);
  return entry;
}

/**
 * What a person sees: the address, the headings, any notice, and every thing
 * they could press or type into, numbered so the next command can say "@7".
 */
async function look(page, { full = false } = {}) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(250);
  const seen = await page.evaluate((full) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const clean = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
    const nameOf = (el) => clean(
      el.getAttribute('aria-label')
      || (el.labels && el.labels[0] && el.labels[0].innerText)
      || el.closest('label')?.querySelector('span')?.innerText
      || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || '',
    ).slice(0, 90);
    document.querySelectorAll('[data-qa-ref]').forEach((el) => el.removeAttribute('data-qa-ref'));
    const controls = [];
    const selector = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], [role=switch], [role=checkbox], [role=option], [role=menuitem]';
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      const ref = controls.length + 1;
      el.setAttribute('data-qa-ref', String(ref));
      const tag = el.tagName.toLowerCase();
      const kind = el.getAttribute('role') || (tag === 'input' ? `input:${el.type}` : tag);
      const bits = [];
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') bits.push('disabled');
      if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.checked) bits.push('on');
      if (el.getAttribute('aria-selected') === 'true') bits.push('selected');
      if ((tag === 'input' || tag === 'textarea') && el.value) bits.push(`value="${clean(el.value).slice(0, 40)}"`);
      if (tag === 'select') bits.push(`chosen="${clean(el.selectedOptions[0]?.innerText)}" options=[${[...el.options].map((o) => clean(o.innerText)).slice(0, 12).join(' | ')}]`);
      if (tag === 'a') bits.push(`→ ${el.getAttribute('href')}`);
      controls.push(`@${ref} ${kind} "${nameOf(el)}"${bits.length ? ' ' + bits.join(' ') : ''}`);
    }
    const headings = [...document.querySelectorAll('h1,h2,h3,[role=heading]')].filter(visible).map((h) => `${h.tagName} ${clean(h.innerText)}`).slice(0, 25);
    const notices = [...document.querySelectorAll('.notice,[role=alert],[role=status],.badge,[class*=toast]')]
      .filter(visible).map((n) => clean(n.innerText)).filter(Boolean).slice(0, 15);
    const dialog = [...document.querySelectorAll('[role=dialog],.modal')].filter(visible).map((d) => clean(d.innerText).slice(0, 600));
    const text = clean(document.querySelector('main')?.innerText ?? document.body.innerText);
    // Panels that float over the page from outside <main> - the bell, a
    // sheet, a menu - are on screen for the person even though main is not them.
    const main = document.querySelector('main');
    const overlays = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (main && (main.contains(el) || el.contains(main))) continue;
      if (overlays.some((o) => o.contains(el))) continue;
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'absolute') && visible(el) && el.getBoundingClientRect().height > 120 && clean(el.innerText).length > 40) overlays.push(el);
    }
    const overlay = overlays.map((el) => clean(el.innerText).slice(0, 1200));
    // The browser's own "Please enter a valid value" bubble is not in the page,
    // but a person sees it: name every field the browser would refuse.
    const invalid = [...document.querySelectorAll('input, textarea, select')]
      .filter((el) => visible(el) && el.willValidate && !el.checkValidity())
      .map((el) => `"${nameOf(el)}": ${el.validationMessage}`).slice(0, 10);
    return { title: document.title, headings, notices, dialog, overlay, invalid, controls, text: full ? text.slice(0, 8000) : text.slice(0, 1800) };
  }, full);
  return [
    `URL: ${page.url().replace(BASE, '') || '/'}   TITLE: ${seen.title}`,
    seen.headings.length ? `HEADINGS:\n  ${seen.headings.join('\n  ')}` : '',
    seen.notices.length ? `NOTICES:\n  ${seen.notices.join('\n  ')}` : '',
    seen.dialog.length ? `DIALOG OPEN:\n  ${seen.dialog.join('\n  ')}` : '',
    seen.overlay.length ? `PANEL OVER THE PAGE:\n  ${seen.overlay.join('\n  ')}` : '',
    seen.invalid.length ? `FIELD PROBLEMS (browser would refuse):\n  ${seen.invalid.join('\n  ')}` : '',
    `SCREEN TEXT${full ? '' : ' (first 1800 chars; `look full` for all)'}:\n  ${seen.text}`,
    `CONTROLS:\n  ${seen.controls.join('\n  ')}`,
  ].filter(Boolean).join('\n');
}

/**
 * "@7", or words a person would use: a button's text, a field's label.
 * Tried in this order - a button before a tab or plain text with the same
 * words - and the first one actually visible wins, the way a person reads.
 */
async function target(page, what) {
  if (/^@\d+$/.test(what)) return page.locator(`[data-qa-ref="${what.slice(1)}"]`);
  const exact = what.startsWith('=');
  const name = exact ? what.slice(1) : what;
  const options = { name, exact };
  const candidates = [
    page.getByRole('button', options),
    page.getByRole('link', options),
    page.getByRole('radio', options),
    page.getByRole('tab', options),
    page.getByRole('switch', options),
    page.getByRole('checkbox', options),
    page.getByRole('menuitem', options),
    page.getByLabel(name, { exact }),
    page.getByText(name, { exact }),
    // What `look` printed, when the accessible name differs (an icon hidden from it, say).
    // Spacing ignored: look joins "+" and "Upload" with a space the DOM may not have.
    page.locator('[data-qa-ref]').filter({
      hasText: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i'),
    }),
  ];
  for (const candidate of candidates) {
    const visible = candidate.filter({ visible: true });
    if (await visible.count().catch(() => 0)) return visible.first();
  }
  return candidates[0].first();
}

/** A box to type in or a list to choose from - never a button that shares its label. */
async function field(page, what) {
  if (/^@\d+$/.test(what)) return page.locator(`[data-qa-ref="${what.slice(1)}"]`);
  const inputs = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select';
  const candidates = [
    page.getByLabel(what).and(page.locator(inputs)),
    page.getByPlaceholder(what),
    page.getByRole('textbox', { name: what }),
    page.getByRole('spinbutton', { name: what }),
    page.getByRole('combobox', { name: what }),
    page.getByLabel(what),
  ];
  for (const candidate of candidates) {
    const visible = candidate.filter({ visible: true });
    if (await visible.count().catch(() => 0)) return visible.first();
  }
  return candidates[0].first();
}

async function shot(page, name) {
  shotCount += 1;
  const file = join(OUT, `${String(shotCount).padStart(3, '0')}-${(name || 'screen').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

const commands = {
  /** open <path> */
  async open(p, [path = '/']) { await p.goto(path.startsWith('http') ? path : BASE + (path.startsWith('/') ? path : `/${path}`)); return look(p); },
  async look(p, [mode]) { return look(p, { full: mode === 'full' }); },
  /** click <@ref | text> */
  async click(p, [what]) { await (await target(p, what)).click({ timeout: 8000 }); await p.waitForTimeout(400); return look(p); },
  /** double <@ref | text> - an impatient double tap. */
  async double(p, [what]) { await (await target(p, what)).dblclick({ timeout: 8000 }); await p.waitForTimeout(800); return look(p); },
  /** type <@ref | label> <text> - typed key by key, as a person would. */
  async type(p, [what, ...rest]) {
    const box = await field(p, what);
    await box.click({ timeout: 8000 });
    await box.fill('');
    await box.pressSequentially(rest.join(' '), { delay: 35 });
    return look(p);
  },
  /** choose <@ref | label> <option text> */
  async choose(p, [what, ...rest]) { await (await field(p, what)).selectOption({ label: rest.join(' ') }); return look(p); },
  /** press <key> e.g. Enter, Escape */
  async press(p, [key]) { await p.keyboard.press(key); await p.waitForTimeout(300); return look(p); },
  /** upload <@ref | button text | label> <file> */
  async upload(p, [what, file]) {
    const el = await target(p, what);
    const isFileInput = await el.evaluate((node) => node instanceof HTMLInputElement && node.type === 'file').catch(() => false);
    if (isFileInput) await el.setInputFiles(resolve(file));
    else {
      // The button a person taps opens a hidden file input beside it; hand
      // the file to that input, which is what the chooser would do.
      const handle = await el.evaluateHandle((node) => {
        for (let up = node; up && up !== document.body; up = up.parentElement) {
          const input = up.querySelector('input[type=file]');
          if (input) return input;
        }
        return null;
      });
      const input = handle.asElement();
      if (!input) throw new Error(`no file input near "${what}"`);
      await input.setInputFiles(resolve(file));
    }
    await p.waitForTimeout(1200);
    return look(p);
  },
  async scroll(p, [dir = 'down']) { await p.mouse.wheel(0, dir === 'up' ? -700 : 700); await p.waitForTimeout(300); return look(p); },
  async back(p) { await p.goBack(); return look(p); },
  async reload(p) { await p.reload(); return look(p); },
  /** wait <text> - until it shows, up to 10s. */
  async wait(p, words) { await p.getByText(words.join(' ')).first().waitFor({ timeout: 10000 }); return look(p); },
  /** expect <text> - pass/fail line, never throws. */
  async expect(p, words) {
    const text = words.join(' ');
    const ok = await p.getByText(text).first().isVisible().catch(() => false);
    return `${ok ? 'PASS' : 'FAIL'}: "${text}" ${ok ? 'is' : 'is NOT'} on screen at ${p.url().replace(BASE, '')}`;
  },
  /** absent <text> - the opposite check. */
  async absent(p, words) {
    const text = words.join(' ');
    const seen = await p.getByText(text).first().isVisible().catch(() => false);
    return `${seen ? 'FAIL' : 'PASS'}: "${text}" ${seen ? 'IS' : 'is not'} on screen at ${p.url().replace(BASE, '')}`;
  },
  async shot(p, words) { return `saved ${await shot(p, words.join('-'))}`; },
  /** login <email|phone> <password> - through the real sign-in screen. */
  async login(p, [who, password]) {
    await p.goto(`${BASE}/me`);
    await p.waitForTimeout(500);
    const tab = p.getByRole('tab', { name: 'Sign in' });
    if (!(await tab.isVisible().catch(() => false))) {
      await p.getByRole('button', { name: 'Log in or sign up' }).click();
    }
    await tab.waitFor({ state: 'visible' });
    await tab.click();
    await p.locator('input[type=password]').first().waitFor({ state: 'visible' });
    const idBox = p.locator('input[autocomplete=username]:visible').first();
    await idBox.fill(who);
    await p.locator('input[type=password]').first().fill(password);
    await p.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await p.waitForTimeout(1200);
    return look(p);
  },
  /** errors - what went wrong under the hood since the last call to errors. */
  async errors(_p, _a, entry) { const out = entry.log.splice(0); return out.length ? out.join('\n') : 'no page errors, console errors or 4xx/5xx responses'; },
  async logout(_p, _a, entry, name) { await entry.context.close(); people.delete(name); return `${name} signed out (context closed)`; },
};

createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(body); };
  if (req.method === 'GET' && req.url === '/people') return send(200, [...people.keys()].join('\n') || '(nobody yet)');
  if (req.method === 'POST' && req.url === '/quit') { send(200, 'bye'); await browser.close(); process.exit(0); }
  if (req.method !== 'POST' || req.url !== '/run') return send(404, 'POST /run');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const { persona = 'buyer', command, args = [], device } = JSON.parse(raw || '{}');
  const fn = commands[command];
  if (!fn) return send(400, `unknown command "${command}". Known: ${Object.keys(commands).join(', ')}`);
  const entry = await person(persona, device);
  try {
    const out = await fn(entry.page, args, entry, persona);
    const trouble = entry.log.length ? `\n\n⚠ ${entry.log.length} new page/console/4xx/5xx error(s) - run \`errors\` to read them.` : '';
    send(200, `[${persona}] ${out}${trouble}`);
  } catch (err) {
    const file = await shot(entry.page, `error-${persona}-${command}`).catch(() => null);
    send(200, `[${persona}] ✖ ${command} ${args.join(' ')} failed: ${String(err.message).split('\n')[0]}${file ? `\n  screenshot: ${file}` : ''}\n\n${await look(entry.page).catch(() => '')}`);
  }
}).listen(PORT, '127.0.0.1', () => {
  writeFileSync(join(OUT, 'README.txt'), `QA run against ${BASE}, started ${new Date().toISOString()}\n`);
  console.log(`qa driver on http://127.0.0.1:${PORT} -> ${BASE}; screenshots in ${OUT}`);
});
