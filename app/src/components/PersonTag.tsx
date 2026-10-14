import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';

interface Person { id: string; name: string; handle: string }

/**
 * A handle field that suggests people as you type.
 *
 * People only: a lot is worked by somebody, and a shop's handle would put it
 * on nobody's My services - the API refuses one, so the suggestions never
 * offer one. Typing a handle by hand still works; the list is a shortcut, not
 * a gate.
 */
export function PersonTag({ value, onChange, placeholder, label }: {
  value: string;
  onChange: (handle: string) => void;
  placeholder?: string;
  /** For the input's accessible name when it sits outside a <label>. */
  label?: string;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  /** The query the shown list answers, so a slow reply cannot overwrite a newer one. */
  const latest = useRef('');

  useEffect(() => {
    const query = value.trim().replace(/^@/, '');
    latest.current = query;
    if (query.length < 1) {
      setPeople([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.suggestPeople(query)
        .then((result) => { if (latest.current === query) { setPeople(result.people); setActive(-1); } })
        .catch(() => { if (latest.current === query) setPeople([]); });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [value]);

  function pick(person: Person) {
    onChange(`@${person.handle}`);
    setOpen(false);
    setPeople([]);
  }

  const showing = open && people.length > 0;

  return (
    <span className="ptag">
      <input
        value={value}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Late enough for a tap on a suggestion to land first.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!showing) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((at) => Math.min(people.length - 1, at + 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((at) => Math.max(0, at - 1)); }
          else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(people[active]!); }
          else if (event.key === 'Escape') setOpen(false);
        }}
      />
      {showing && (
        <ul className="ptag__list" id={listId} role="listbox">
          {people.map((person, index) => (
            <li key={person.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
              className={`ptag__opt${index === active ? ' is-active' : ''}`}
              onMouseDown={(event) => { event.preventDefault(); pick(person); }}>
              <span className="ptag__name">{person.name}</span>
              <span className="ptag__handle">@{person.handle}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
