import type { VerifiedChecks } from '@shared/verification';

/**
 * Email, WhatsApp and Aadhaar, as a row of chips on a person's or a shop's page.
 *
 * A shop's are its owner's: there is one person behind both, and that person
 * is who the checks are about. Only whether each passed - never the values.
 */
export function VerifiedChips({ checks, passedOnly = false }: {
  checks: VerifiedChecks | undefined;
  /** A public page shows only what passed; your own settings show what is left to do. */
  passedOnly?: boolean;
}) {
  if (!checks) return null;
  const items = ([['Email', checks.email], ['WhatsApp', checks.phone], ['Aadhaar', checks.aadhaar]] as const)
    .filter(([, ok]) => ok || !passedOnly);
  if (items.length === 0) return null;
  const all = fullyVerified(checks);
  return (
    <div className="vfychips" aria-label={all ? 'Verified: email, WhatsApp and Aadhaar' : 'Verification'}>
      {items.map(([label, ok]) => (
        <span key={label} className={`vfychip${ok ? ' is-ok' : ''}`} title={ok ? `${label} verified` : `${label} not verified`}>
          <span aria-hidden="true">{ok ? '✓' : '○'}</span> {label}
        </span>
      ))}
    </div>
  );
}

/** All three passed: email, WhatsApp and Aadhaar. */
export function fullyVerified(checks: VerifiedChecks | null | undefined): boolean {
  return Boolean(checks?.email && checks.phone && checks.aadhaar);
}

/** The blue tick beside a name, once all three checks have passed. Nothing otherwise. */
export function VerifiedTick({ checks, size = 20 }: { checks: VerifiedChecks | null | undefined; size?: number }) {
  if (!fullyVerified(checks)) return null;
  return (
    <span className="vtick" title="Verified: email, WhatsApp and Aadhaar" aria-label="Verified" role="img">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#1D9BF0" d="m12 1.6 2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.1L12 22.4l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.1Z" />
        <path fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" d="m7.8 12.2 2.9 2.9 5.5-5.6" />
      </svg>
    </span>
  );
}
