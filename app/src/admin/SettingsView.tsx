import { useEffect, useState } from 'react';
import { SETTING_RULES, type MarketSettings } from '@shared/settings';
import { ApiRequestError, admin } from './api';
import { formatMoney, timeAgo } from '../format';

type Editable = Exclude<keyof MarketSettings, 'updatedAt' | 'updatedBy'>;

/** How each number is typed in: rupees, percent or days, stored as minor units, basis points or days. */
const FIELDS: { key: Editable; unit: 'rupees' | 'percent' | 'days'; hint: string }[] = [
  { key: 'protectionFeeMinor', unit: 'rupees', hint: 'A flat amount per protected order, paid by the buyer on top of it (never more than the order). Covers round one of any dispute on the purchase.' },
  { key: 'disputeFeeMinor', unit: 'rupees', hint: 'Paid by whoever raises a dispute (round one). Not charged on a purchase still under buyer protection.' },
  { key: 'escalationFeeMinor', unit: 'rupees', hint: 'Paid by whoever escalates to round two.' },
  { key: 'secondEscalationFeeMinor', unit: 'rupees', hint: 'Paid by whoever escalates to round three.' },
  { key: 'commissionBasisPoints', unit: 'percent', hint: 'Figmark\'s cut of every fee above. The rest goes to the community manager on the case.' },
  { key: 'autoReleaseDays', unit: 'days', hint: 'After an item leaves for the buyer, a protected payment goes to the seller if the buyer neither confirms nor disputes. Applies to clocks that start from now on.' },
  { key: 'responseDays', unit: 'days', hint: 'How long the other party has to answer a new dispute before the manager may decide without them.' },
  { key: 'decisionDays', unit: 'days', hint: 'How long a community manager has to decide a round. Past it the round is flagged here; two days later it is reassigned automatically.' },
  { key: 'escalationWindowDays', unit: 'days', hint: 'How long the losing side has to escalate a decision before it is final.' },
];

const toInput = (unit: string, value: number) => String(unit === 'days' ? value : value / 100);
const fromInput = (unit: string, text: string) => (unit === 'days' ? Number(text) : Math.round(Number(text) * 100));

/**
 * Marketplace rules and every fee, managed centrally.
 *
 * Buyer protection, raising a dispute, each escalation and Figmark's
 * commission are set here and nowhere else - community managers do not set
 * their own. Every fee is paid through the gateway and never refunded. A
 * change applies from now on; orders and disputes keep the terms they started
 * with.
 */
export function SettingsView() {
  const [settings, setSettings] = useState<MarketSettings | null>(null);
  const [draft, setDraft] = useState<Partial<Record<Editable, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fill = (current: MarketSettings) => {
    setSettings(current);
    setDraft(Object.fromEntries(FIELDS.map(({ key, unit }) => [key, toInput(unit, current[key])])));
  };

  useEffect(() => {
    void admin.settings().then(fill)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the settings.'));
  }, []);

  if (!settings && !error) return <p className="muted">Loading…</p>;

  const values = Object.fromEntries(FIELDS.map(({ key, unit }) => [key, fromInput(unit, draft[key] ?? '')])) as Record<Editable, number>;
  const invalid = FIELDS.filter(({ key }) => {
    const rule = SETTING_RULES[key];
    const value = values[key];
    return !Number.isInteger(value) || value < rule.min || value > rule.max;
  });
  const changed = settings !== null && FIELDS.some(({ key }) => values[key] !== settings[key]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      fill(await admin.saveSettings(values));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const group = (title: string, keys: Editable[]) => (
    <div className="card card--pad stack">
      <h2>{title}</h2>
      {FIELDS.filter(({ key }) => keys.includes(key)).map(({ key, unit, hint }) => {
        const rule = SETTING_RULES[key];
        const bad = invalid.some((entry) => entry.key === key);
        return (
          <label key={key} className="field">
            <span>{rule.label} ({unit === 'rupees' ? '₹' : unit === 'percent' ? '%' : 'days'})</span>
            <input type="number" inputMode="decimal" step={unit === 'days' ? 1 : 0.01} value={draft[key] ?? ''}
              onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setSaved(false); }} style={{ maxWidth: 160 }} />
            <span className="field__hint" style={bad ? { color: 'var(--danger-text)' } : undefined}>
              {hint}{unit === 'rupees' ? ` Currently ${formatMoney(settings?.[key] ?? 0)}.` : ''}
              {bad && ` Must be between ${toInput(unit, rule.min)} and ${toInput(unit, rule.max)}.`}
            </span>
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="stack">
      {group('Fees', ['protectionFeeMinor', 'disputeFeeMinor', 'escalationFeeMinor', 'secondEscalationFeeMinor', 'commissionBasisPoints'])}
      {group('Buyer protection', ['autoReleaseDays'])}
      {group('Dispute deadlines', ['responseDays', 'decisionDays', 'escalationWindowDays'])}
      <div className="card card--pad stack">
        <p className="field__hint" style={{ margin: 0 }}>
          Every fee goes through the payment gateway and is not refunded, whatever the outcome. Changes apply from now
          on: a purchase keeps the protection fee it was bought at, and a dispute round keeps the fee it was paid.
        </p>
        {settings?.updatedAt && (
          <p className="faint">Last changed {timeAgo(settings.updatedAt)}{settings.updatedBy ? ` by ${settings.updatedBy}` : ''}.</p>
        )}
        {error && <p className="notice notice--error">{error}</p>}
        {saved && <p className="notice notice--ok">Saved.</p>}
        <button className="btn" style={{ justifySelf: 'start' }} disabled={busy || invalid.length > 0 || !changed}
          onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
