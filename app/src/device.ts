import { api } from './api';
import type { ClientBrowser, ClientPlatform, ClientPushState } from '@shared/models';

/**
 * What this copy of the site is running on: which kind of device, which
 * browser, and whether it was opened from the home screen.
 *
 * Read from the user agent and the display mode, which is as much as a web
 * page can know and is right for every browser that matters here. Used for
 * two things: picking the right instructions (an iPhone needs Safari's Share
 * menu, an Android phone the browser menu or one tap on Install), and the
 * operators' totals of how people use Figmark.
 */

/** iOS and iPadOS, including an iPad that reports itself as a Mac. */
export function isAppleMobile(): boolean {
  const agent = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(agent) || (agent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Opened from the home screen (or as an installed app) rather than in a browser tab. */
export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function devicePlatform(): ClientPlatform {
  const agent = navigator.userAgent;
  if (isAppleMobile()) return 'ios';
  if (/Android/.test(agent)) return 'android';
  if (/Macintosh/.test(agent)) return 'mac';
  if (/Windows/.test(agent)) return 'windows';
  if (/Linux|CrOS/.test(agent)) return 'linux';
  return 'other';
}

/** A phone or tablet, where Figmark is meant to live on the home screen. */
export function isMobile(): boolean {
  const platform = devicePlatform();
  return platform === 'ios' || platform === 'android';
}

export function deviceBrowser(): ClientBrowser {
  const agent = navigator.userAgent;
  // Most specific first: every one of these also says "Chrome" or "Safari".
  if (/SamsungBrowser/.test(agent)) return 'samsung';
  if (/Edg(A|iOS)?\//.test(agent)) return 'edge';
  if (/OPR\/|OPT\/|Opera/.test(agent)) return 'opera';
  if (/Firefox\/|FxiOS/.test(agent)) return 'firefox';
  if (/CriOS|Chrome\//.test(agent)) return 'chrome';
  // The home-screen copy on an iPhone drops "Safari" from its user agent, but
  // it is Safari underneath.
  if (/Safari\//.test(agent) || isAppleMobile()) return 'safari';
  return 'other';
}

/* ── Android's one-tap install ───────────────────────────────────────────── */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

/**
 * Chrome, Edge and Samsung Internet offer an install prompt the page can show
 * from its own button. Kept from the moment it arrives, so the guide can say
 * "tap Install" instead of walking through a menu.
 */
export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    installListeners.forEach((listener) => listener());
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installListeners.forEach((listener) => listener());
  });
}

export function canPromptInstall(): boolean {
  return installPrompt !== null;
}

export function onInstallPromptChange(listener: () => void): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

/** Show the browser's own install dialog. True when the person said yes. */
export async function promptInstall(): Promise<boolean> {
  const event = installPrompt;
  if (!event) return false;
  installPrompt = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  installListeners.forEach((listener) => listener());
  return outcome === 'accepted';
}

/* ── Reporting ───────────────────────────────────────────────────────────── */

const ID_KEY = 'figmark:device-id';
const SENT_KEY = 'figmark:device-sent';
const RESEND_MS = 12 * 60 * 60 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: it reports once per visit instead.
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing kept to forget.
  }
}

let sessionId: string | null = null;
function deviceId(): string {
  const kept = read(ID_KEY);
  if (kept) return kept;
  sessionId ??= `dev_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  write(ID_KEY, sessionId);
  return sessionId;
}

const HOME_KEY = 'figmark:on-home-screen';

/**
 * Whether this person already has Figmark on this kind of phone's home
 * screen, as the server last said. A Safari tab cannot see its home-screen
 * twin - they keep separate storage - so this is the only way it knows.
 */
export function onHomeScreenElsewhere(userId: string): boolean {
  return read(HOME_KEY) === userId;
}

/**
 * Tell the account where it is being used. Once a day per copy, or straight
 * away when something changed - it was installed, or notifications went on.
 * Resolves to whether this person has Figmark on the home screen of this
 * kind of device, or null when it did not ask.
 */
export async function reportDevice(userId: string, push: ClientPushState): Promise<boolean | null> {
  const body = {
    id: deviceId(),
    platform: devicePlatform(),
    browser: deviceBrowser(),
    installed: isInstalled(),
    push,
  };
  const signature = JSON.stringify({ userId, ...body });
  const sent = read(SENT_KEY);
  if (sent) {
    try {
      const last = JSON.parse(sent) as { signature: string; at: number };
      if (last.signature === signature && Date.now() - last.at < RESEND_MS) return null;
    } catch {
      // Unreadable: send.
    }
  }
  try {
    const { onHomeScreen } = await api.reportDevice(body);
    write(SENT_KEY, JSON.stringify({ signature, at: Date.now() }));
    // Either way: a home-screen copy that has since been deleted (unused for
    // two weeks) turns this back off, and the prompt offers it again.
    if (onHomeScreen) write(HOME_KEY, userId);
    else forget(HOME_KEY);
    return onHomeScreen ?? null;
  } catch {
    // Figures, not function: the next visit tries again.
    return null;
  }
}
