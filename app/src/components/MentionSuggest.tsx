import { useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import { Avatar } from './ui';
import '../styles/MentionSuggest.css';

/** The @word being typed right before the caret, read the way a mention is (see MENTION in shared/feed). */
const TYPING = /(^|[^\p{L}\p{N}_@./])@([a-z0-9][a-z0-9_.]{0,29})$/iu;
/** Enough to pick from without covering the post being written. */
const SHOWN = 6;

interface Match {
  id: string;
  name: string;
  handle: string;
  shop: boolean;
}

/**
 * Who you might mean, while you type an @mention.
 *
 * The server already tells whoever is @mentioned and the post links them; what
 * was missing is finding the handle - nobody remembers whether it is
 * @kaiju_imports or @kaijuimports. People and shops come up as you type,
 * arrows move, Enter or Tab picks, Escape closes, and the text box keeps its
 * own Enter for everything else.
 */
export function MentionSuggest({ field, value, onChange }: {
  field: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  const [caret, setCaret] = useState<number | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [at, setAt] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);

  // Where the caret is: typing, clicking and arrowing all move it.
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    const read = () => setCaret(document.activeElement === node ? node.selectionStart : null);
    const away = () => window.setTimeout(() => setCaret(null), 150);
    const events = ['input', 'keyup', 'click', 'focus'] as const;
    events.forEach((name) => node.addEventListener(name, read));
    node.addEventListener('blur', away);
    return () => {
      events.forEach((name) => node.removeEventListener(name, read));
      node.removeEventListener('blur', away);
    };
  }, [field]);

  const typed = caret === null ? null : TYPING.exec(value.slice(0, caret));
  const query = typed ? typed[2]! : null;
  const open = query !== null && query !== closed && matches.length > 0;

  useEffect(() => {
    if (!query) {
      setMatches([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      api.socialSearch(query).then((found) => {
        if (!live) return;
        const all = [
          ...found.people.filter((row) => row.handle).map((row) => ({ id: row.id, name: row.name, handle: row.handle!, shop: false })),
          ...found.shops.filter((row) => row.handle).map((row) => ({ id: row.id, name: row.name, handle: row.handle!, shop: true })),
        ];
        // What is being typed is a handle: one that starts with it first, then
        // a name with a word that does, then whatever else the search found.
        const word = query.toLowerCase();
        const rank = (match: Match) => match.handle.toLowerCase().startsWith(word) ? 0
          : match.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(word)) ? 1 : 2;
        setMatches(all.map((match, index) => ({ match, index }))
          .sort((a, b) => rank(a.match) - rank(b.match) || a.index - b.index)
          .map(({ match }) => match)
          .slice(0, SHOWN));
        setAt(0);
      }).catch(() => live && setMatches([]));
    }, 160);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const pick = useRef<(match: Match) => void>(() => undefined);
  pick.current = (match: Match) => {
    const node = field.current;
    if (!node || caret === null || !typed) return;
    const start = caret - typed[2]!.length - 1;
    const inserted = `@${match.handle} `;
    onChange(value.slice(0, start) + inserted + value.slice(caret));
    const next = start + inserted.length;
    setMatches([]);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(next, next);
      setCaret(next);
    });
  };

  // Keys go to the list while it is open, before the box's own Enter-to-send.
  const keys = useRef({ open, matches, at, query });
  keys.current = { open, matches, at, query };
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => {
      const { open: showing, matches: rows, at: index, query: word } = keys.current;
      if (!showing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setAt((index + step + rows.length) % rows.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        pick.current(rows[index]!);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setClosed(word);
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [field]);

  if (!open) return null;
  return (
    <ul className="mentions" role="listbox" aria-label="People and shops to mention">
      {matches.map((match, index) => (
        <li key={match.id} role="option" aria-selected={index === at}>
          {/* Down before the box loses focus, so the pick lands where the caret was. */}
          <button type="button" className={`mentions__row${index === at ? ' is-on' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault();
              pick.current(match);
            }}>
            <Avatar name={match.name} size={26} />
            <span className="mentions__name">{match.name}</span>
            <span className="faint">@{match.handle}{match.shop ? ' · Shop' : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
