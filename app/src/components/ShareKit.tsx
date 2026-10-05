import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ShareEvent, ShareKind } from '@shared/models';
import { api } from '../api';
import { useSession } from '../session';
import { useToast } from './Feedback';
import { useQuest } from './Quest';
import { Modal } from './ui';
import { renderMoment, sizeOf, themeOf, type Moment, type MomentFormat } from './momentCard';

/*
 * Sharing out of the app, in one place.
 *
 * Anything worth showing off - a spot booked in a group buy, a haul, a
 * delivery, a sale, a level, a pull, a shop, an invite - opens the same sheet:
 * a picture drawn for it on the spot, and four ways out. WhatsApp sends the
 * link, which unfolds into a preview card in the chat; Share picture hands the
 * image to the phone for a Status or a story; Save keeps it; Copy takes the
 * link alone. Every link carries the sharer's invite or affiliate code, so
 * whoever it reaches - and whatever they buy - counts for them.
 */

/** Where the link should lead. */
export type ShareLink =
  | { to: 'item'; listingId: string; moment?: ShareKind; affiliate?: boolean; own?: boolean }
  | { to: 'page'; handle: string }
  | { to: 'invite'; seller?: boolean };

export interface ShareSpec {
  kind: ShareKind;
  /** Everything the picture says except the link and, optionally, the byline. */
  moment: Omit<Moment, 'link' | 'byline' | 'kind'> & { byline?: string };
  link: ShareLink;
  /** What WhatsApp and the share sheet send with it; the link is added at the end. */
  caption: string;
  /** The item, shop or code, for the share log. */
  target?: string | null;
  /** The shop this counts for, when the sharer runs it. */
  storeId?: string | null;
}

/* ── Links ──────────────────────────────────────────────────────────────── */

let invite: { userId: string; code: Promise<string | null> } | null = null;

/** The signed-in person's invite code, asked for once and kept. */
export function inviteCodeFor(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return Promise.resolve(null);
  if (invite?.userId !== userId) {
    invite = { userId, code: api.myInvite().then((summary) => summary.code).catch(() => null) };
  }
  return invite.code;
}

async function linkFor(link: ShareLink, userId: string | null): Promise<string> {
  const origin = window.location.origin;
  const code = await inviteCodeFor(userId);
  const withInvite = (path: string, extra: Record<string, string | undefined> = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
    if (code) query.set('i', code);
    const suffix = query.toString();
    return `${origin}${path}${suffix ? `?${suffix}` : ''}`;
  };

  if (link.to === 'item') {
    // An item that pays whoever shares it goes out on the sharer's own
    // affiliate link: the same preview, and a sale through it earns.
    if (link.affiliate && userId && !link.own) {
      try {
        const { path } = await api.affiliateLink(link.listingId);
        return `${origin}${path}${link.moment ? `?m=${link.moment}` : ''}`;
      } catch {
        // Fall through to the plain link.
      }
    }
    return withInvite(`/s/l/${encodeURIComponent(link.listingId)}`, { m: link.moment });
  }
  if (link.to === 'page') return withInvite(`/s/p/${encodeURIComponent(link.handle)}`);
  if (!code) return origin;
  return `${origin}/i/${code}${link.seller ? '?as=seller' : ''}`;
}

/** Who it is from, and their level - except on a level-up, which says the level itself. */
function bylineFor(kind: ShareKind, name: string | null, view: { level: number; title: string } | null): string {
  if (!name) return 'On Figmark';
  if (kind === 'level' || !view) return name;
  return `${name} · Level ${view.level} ${view.title}`;
}

/* ── The sheet ──────────────────────────────────────────────────────────── */

function canShareFiles(): boolean {
  try {
    const probe = new File([new Blob()], 'probe.jpg', { type: 'image/jpeg' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

const FORMAT_KEY = 'figmark.shareFormat';

export function ShareSheet({ spec, onClose }: { spec: ShareSpec; onClose: () => void }) {
  const { user } = useSession();
  const { view, refresh } = useQuest();
  const toast = useToast();
  const [format, setFormat] = useState<MomentFormat>(() => {
    try {
      return window.localStorage.getItem(FORMAT_KEY) === 'post' ? 'post' : 'story';
    } catch {
      return 'story';
    }
  });
  const [link, setLink] = useState<string | null>(null);
  const [pictures, setPictures] = useState<Partial<Record<MomentFormat, { blob: Blob; url: string }>>>({});
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const urls = useRef<string[]>([]);
  const files = useMemo(canShareFiles, []);

  const byline = spec.moment.byline ?? bylineFor(spec.kind, user?.displayName ?? null, view);

  useEffect(() => {
    let cancelled = false;
    void linkFor(spec.link, user?.id ?? null).then((value) => !cancelled && setLink(value));
    return () => { cancelled = true; };
  }, [spec.link, user?.id]);

  // The chosen shape first, then the other in the background, so switching
  // is instant. Each is drawn once per opening.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    const order: MomentFormat[] = format === 'story' ? ['story', 'post'] : ['post', 'story'];
    void (async () => {
      for (const shape of order) {
        if (cancelled) return;
        try {
          const blob = await renderMoment({ ...spec.moment, kind: spec.kind, byline, link }, shape);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          setPictures((current) => (current[shape] ? current : { ...current, [shape]: { blob, url } }));
        } catch {
          if (!cancelled && shape === format) setFailed(true);
        }
      }
    })();
    return () => { cancelled = true; };
    // `format` only orders the work; the pictures do not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, byline, spec]);

  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const choose = (next: MomentFormat) => {
    setFormat(next);
    try {
      window.localStorage.setItem(FORMAT_KEY, next);
    } catch {
      // Remembering the shape is a nicety.
    }
  };

  const sent = useCallback((via: ShareEvent['via']) => {
    if (!user) return;
    void api.logShare({ kind: spec.kind, via, target: spec.target ?? null, storeId: spec.storeId ?? null })
      .then(() => refresh())
      .catch(() => undefined);
  }, [user, spec.kind, spec.target, spec.storeId, refresh]);

  const text = link ? `${spec.caption}\n${link}` : spec.caption;
  const picture = pictures[format];
  const fileName = `figmark-${spec.kind}-${format}.jpg`;

  const whatsapp = () => {
    if (!link) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    sent('whatsapp');
  };

  const sharePicture = async () => {
    if (!picture || !link) return;
    try {
      await navigator.share({ files: [new File([picture.blob], fileName, { type: 'image/jpeg' })], text });
      sent('native');
      toast('Shared. Every friend who opens your link counts for your quests.', 'ok');
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') toast('Your phone would not share that picture. Try Save instead.', 'error');
    }
  };

  const save = () => {
    if (!picture) return;
    const anchor = document.createElement('a');
    anchor.href = picture.url;
    anchor.download = fileName;
    anchor.click();
    sent('download');
    toast('Saved. Post it to your Status or story - the link is printed on it.', 'ok');
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
      sent('copy');
    } catch {
      toast('Could not copy. Press and hold the link to copy it.', 'error');
    }
  };

  const theme = themeOf(spec.kind);
  const { w, h } = sizeOf(format);

  return (
    <Modal title="Share" onClose={onClose}>
      <div className="shs">
        <div className="shs__seg" role="tablist" aria-label="Picture shape">
          {(['story', 'post'] as const).map((shape) => (
            <button key={shape} type="button" role="tab" aria-selected={format === shape}
              className={`shs__tab${format === shape ? ' is-on' : ''}`} onClick={() => choose(shape)}>
              {shape === 'story' ? 'Story · Status' : 'Post · Chat'}
            </button>
          ))}
        </div>

        <div className="shs__stage" style={{ aspectRatio: `${w} / ${h}`, background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
          {picture ? (
            <img className="shs__img" src={picture.url} alt={`${spec.moment.headline} - picture to share`} />
          ) : (
            <span className="shs__wait">{failed ? 'Could not draw the picture. The link still works.' : 'Drawing your picture…'}</span>
          )}
        </div>

        <p className="shs__caption">{spec.caption}{link && <><br /><span className="shs__link">{link.replace(/^https?:\/\//, '')}</span></>}</p>

        <div className="shs__acts">
          <button type="button" className="shs__act shs__act--wa" disabled={!link} onClick={whatsapp}>
            <WhatsAppMark /> WhatsApp
          </button>
          {files && (
            <button type="button" className="shs__act shs__act--go" disabled={!picture} onClick={() => void sharePicture()}>
              Share picture
            </button>
          )}
          <button type="button" className="shs__act" disabled={!picture} onClick={save}>Save picture</button>
          <button type="button" className="shs__act" disabled={!link} onClick={() => void copy()}>
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
        {user ? (
          <p className="shs__note">Sharing counts toward today's quest. Every friend who opens your link, joins or buys earns you more.</p>
        ) : (
          <p className="shs__note">Sign in to put your own invite on the link and earn from what you share.</p>
        )}
      </div>
    </Modal>
  );
}

function WhatsAppMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.3Z" />
    </svg>
  );
}

/* ── Doors into the sheet ───────────────────────────────────────────────── */

/** `open(spec)` shows the sheet; render `sheet` anywhere in the component. */
export function useShareSheet(): { open: (spec: ShareSpec) => void; sheet: ReactNode } {
  const [spec, setSpec] = useState<ShareSpec | null>(null);
  const close = useCallback(() => setSpec(null), []);
  return { open: setSpec, sheet: spec ? <ShareSheet spec={spec} onClose={close} /> : null };
}

/** A button that opens the sheet. */
export function ShareButton({ spec, className = 'btn btn--sm', children }: {
  spec: ShareSpec | (() => ShareSpec);
  className?: string;
  children?: ReactNode;
}) {
  const { open, sheet } = useShareSheet();
  return (
    <>
      <button type="button" className={className} onClick={() => open(typeof spec === 'function' ? spec() : spec)}>
        {children ?? 'Share'}
      </button>
      {sheet}
    </>
  );
}

/**
 * The invitation to show something off, with the picture already drawn on it -
 * seeing how good it looks is most of the reason to send it.
 */
export function MomentBanner({ spec, title, note }: { spec: ShareSpec; title: string; note: string }) {
  const { user } = useSession();
  const { view } = useQuest();
  const { open, sheet } = useShareSheet();
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    // Drawn when the page is idle, so it never slows the screen it sits on.
    const start = () => {
      const byline = spec.moment.byline ?? bylineFor(spec.kind, user?.displayName ?? null, view);
      void renderMoment({ ...spec.moment, kind: spec.kind, byline, link: `${window.location.host}` }, 'post')
        .then((blob) => {
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          setThumb(url);
        })
        .catch(() => undefined);
    };
    const idle = (window as Window & { requestIdleCallback?: (fn: () => void) => number }).requestIdleCallback;
    const handle = idle ? idle(start) : window.setTimeout(start, 200);
    return () => {
      cancelled = true;
      if (!idle) window.clearTimeout(handle);
      if (url) URL.revokeObjectURL(url);
    };
    // Drawn once per moment: a level read later should not redraw it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.kind, spec.moment.title, spec.moment.headline]);

  const theme = themeOf(spec.kind);
  return (
    <section className="mshare" style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
      <div className="mshare__inner">
        <button type="button" className="mshare__thumb" onClick={() => open(spec)} aria-label="Open the picture">
          {thumb ? <img src={thumb} alt="" /> : <span aria-hidden="true">{theme.glyph}</span>}
        </button>
        <div className="mshare__body">
          <b>{title}</b>
          <span>{note}</span>
          <div className="mshare__acts">
            <button type="button" className="btn btn--sm mshare__go" onClick={() => open(spec)}>Share the picture</button>
          </div>
        </div>
      </div>
      {sheet}
    </section>
  );
}

