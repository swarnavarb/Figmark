/**
 * The questions a category asks, drawn as a form.
 *
 * Choices are tags rather than a dropdown wherever the list is short: every
 * answer is visible without opening anything, one tap sets it, and on a phone a
 * tag is a bigger target than a native select row. A long list (forty shoe
 * sizes) is the exception and becomes a menu, because forty tags is a wall.
 *
 * Nothing here knows what a sneaker is. The questions come from the category's
 * definition in shared/category-specs, so a new category or a new option is an
 * edit there and this file does not change.
 */
import {
  optionsOf, pruneAttributes, splitMulti, visibleFields,
  type Attributes, type CategoryField,
} from '@shared/catalog';
import { Select } from './Select';

/** More options than this and a row of tags stops being a row. */
const MENU_ABOVE = 9;

export function CategoryFields({ category, value, onChange, showMissing }: {
  category: string;
  value: Attributes;
  onChange: (next: Attributes) => void;
  /** After a first publish attempt: highlight what is still unanswered. */
  showMissing?: boolean;
}) {
  const fields = visibleFields(category, value);

  /** Set one answer, then drop whatever it made irrelevant. */
  function set(key: string, answer: string) {
    const next = { ...value };
    if (answer) next[key] = answer;
    else delete next[key];
    onChange(pruneAttributes(category, next));
  }

  return (
    <div className="attrs">
      {fields.map((field) => (
        <FieldInput key={field.key} field={field} attributes={value}
          missing={Boolean(showMissing && field.required && !value[field.key]?.trim())}
          onSet={(answer) => set(field.key, answer)} />
      ))}
    </div>
  );
}

function FieldInput({ field, attributes, missing, onSet }: {
  field: CategoryField;
  attributes: Attributes;
  missing: boolean;
  onSet: (answer: string) => void;
}) {
  const current = attributes[field.key] ?? '';
  const options = optionsOf(field, attributes);
  const chosen = options.find((option) => option.value === current);
  // Say why a choice list is empty instead of rendering nothing: card
  // conditions depend on the card type, and "pick a type first" is the answer.
  const waitingOnType = field.kind === 'choice' && options.length === 0 && Boolean(field.options?.length);

  const label = (
    <span className="attr__label">
      {field.label}
      {field.required ? <span className="attr__req" aria-hidden="true"> *</span> : <span className="faint"> (optional)</span>}
    </span>
  );

  if (field.kind === 'text') {
    return (
      <label className={`attr${missing ? ' is-missing' : ''}`}>
        {label}
        <input value={current} maxLength={80} placeholder={field.placeholder}
          onChange={(event) => onSet(event.target.value)} />
        {field.hint && <span className="field__hint">{field.hint}</span>}
      </label>
    );
  }

  if (field.kind === 'choice' && (field.display === 'menu' || options.length > MENU_ABOVE)) {
    return (
      <label className={`attr${missing ? ' is-missing' : ''}`}>
        {label}
        <Select value={current} onChange={(event) => onSet(event.target.value)}>
          <option value="">Choose…</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        {field.hint && <span className="field__hint">{field.hint}</span>}
      </label>
    );
  }

  const picked = field.kind === 'multi' ? splitMulti(current) : [current];

  function toggle(optionValue: string) {
    if (field.kind === 'multi') {
      const next = picked.includes(optionValue)
        ? picked.filter((part) => part !== optionValue)
        : [...picked, optionValue];
      onSet(next.join(', '));
    } else {
      // Tapping the chosen tag clears it: an optional answer has to be
      // un-pickable, and a required one is simply asked for again.
      onSet(current === optionValue ? '' : optionValue);
    }
  }

  return (
    <div className={`attr${missing ? ' is-missing' : ''}`} role="group" aria-label={field.label}>
      {label}
      {waitingOnType ? (
        <span className="field__hint">Pick what kind it is first.</span>
      ) : (
        <div className="tags">
          {options.map((option) => (
            <button key={option.value} type="button"
              className={`tag${picked.includes(option.value) ? ' is-on' : ''}`}
              aria-pressed={picked.includes(option.value)}
              onClick={() => toggle(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      )}
      {/* The hint of what is chosen, else the field's own: "MIB" means nothing
          to somebody who has never sold a figure until this line says so. */}
      {(chosen?.hint ?? field.hint) && <span className="field__hint">{chosen?.hint ?? field.hint}</span>}
      {missing && <span className="attr__ask">Choose one to publish.</span>}
    </div>
  );
}
