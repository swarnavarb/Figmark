import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LinkPreview } from '../api';

/*
 * A Figmark link in a post, drawn as a card - picture, title and a line - the
 * way WhatsApp draws one. The post stores only the link; the card is read when
 * it is shown, so sharing an item a hundred times keeps no picture a hundred
 * times, and the card is always the item as it is now.
 */

/** The share addresses a card can be drawn for, and an item's own page. */
const PREVIEWABLE = /^\/(r|i|s\/l|s\/p|listing)\/[^/]+\/?$/;

/**
 * The first link into Figmark in some words that has a card: its path, and
 * the words without it - the card says where it goes, so the address need
 * not be spelled out above it as well.
 */
export function figmarkLink(text: string | null | undefined): { path: string; rest: string } | null {
  for (const match of (text ?? '').matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const address = match[0].replace(/[.,!?;:)\]]+$/, '');
    try {
      const url = new URL(address);
      if (url.origin !== window.location.origin || !PREVIEWABLE.test(url.pathname)) continue;
      const rest = `${text!.slice(0, match.index)}${text!.slice(match.index! + address.length)}`.replace(/[ \t]+\n/g, '\n').trim();
      return { path: `${url.pathname}${url.search}`, rest };
    } catch {
      // Not an address after all.
    }
  }
  return null;
}

// One read per link for as long as the page is open; a feed shows the same item often.
const known = new Map<string, Promise<LinkPreview | null>>();
function previewOf(path: string): Promise<LinkPreview | null> {
  let held = known.get(path);
  if (!held) {
    held = api.linkPreview(path).catch(() => null);
    known.set(path, held);
  }
  return held;
}

export function LinkCard({ path, compact = false }: { path: string; compact?: boolean }) {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setPreview(undefined);
    void previewOf(path).then((found) => { if (live) setPreview(found); });
    return () => { live = false; };
  }, [path]);

  if (preview === null) return null;
  if (preview === undefined) return <div className={`linkcard linkcard--loading${compact ? ' linkcard--compact' : ''}`} aria-hidden="true" />;
  return (
    <Link to={preview.href} className={`linkcard${compact ? ' linkcard--compact' : ''}`} onClick={(event) => event.stopPropagation()}>
      <img className="linkcard__img" src={preview.image} alt="" loading="lazy" />
      <span className="linkcard__text">
        <b className="linkcard__title">{preview.title}</b>
        {preview.description && <span className="linkcard__desc">{preview.description}</span>}
        <span className="linkcard__host">Figmark</span>
      </span>
    </Link>
  );
}
