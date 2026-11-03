import { Link } from 'react-router-dom';
import type { PostTemplate } from '@shared/templates';

/** Where quick fills are written: their own tab in the shop console. */
export const QUICK_FILL_HOME = '/shop?tab=templates';

/**
 * The shop's quick fills, one tap each, and the way to write or change one.
 *
 * The same list on a listing and on a live drop: a quick fill is written once,
 * in Sell → Quick fill, and used from either. Nothing is edited here - the
 * Add / edit button goes to where they are written, so there is one form for
 * them and not three slightly different ones.
 */
export function QuickFillPicker({ templates, value, onPick, onNone, newTab = false }: {
  templates: PostTemplate[];
  /** The template picked, or '' for none. */
  value: string;
  onPick: (template: PostTemplate) => void;
  onNone: () => void;
  /** Open the editor in a new tab, so a form that cannot keep a draft is not lost. */
  newTab?: boolean;
}) {
  const target = newTab ? { target: '_blank', rel: 'noopener' } : {};
  return (
    <div className="qfill" role="radiogroup" aria-label="Quick fill">
      {templates.map((template) => (
        <button key={template.id} type="button" role="radio" aria-checked={value === template.id}
          className={`qfill__chip${value === template.id ? ' is-on' : ''}`}
          onClick={() => onPick(template)}>
          {template.name}
        </button>
      ))}
      {templates.length > 0 && (
        <button type="button" role="radio" aria-checked={!value}
          className={`qfill__chip qfill__chip--none${value ? '' : ' is-on'}`} onClick={onNone}>
          None
        </button>
      )}
      <Link to={value ? `${QUICK_FILL_HOME}&edit=${encodeURIComponent(value)}` : QUICK_FILL_HOME}
        className="qfill__chip qfill__chip--edit" {...target}>
        {templates.length === 0 ? '+ Add a quick fill' : '✎ Add / edit'}
      </Link>
    </div>
  );
}
