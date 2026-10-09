import type { VerifiedChecks } from '@shared/verification';

/**
 * Email, WhatsApp and Aadhaar, as a row of chips on a person's or a shop's page.
 *
 * A shop's are its owner's: there is one person behind both, and that person
 * is who the checks are about. Only whether each passed - never the values.
 */
export function VerifiedChips({ checks }: { checks: VerifiedChecks | undefined }) {
  if (!checks) return null;
  const items = [['Email', checks.email], ['WhatsApp', checks.phone], ['Aadhaar', checks.aadhaar]] as const;
  const all = checks.email && checks.phone && checks.aadhaar;
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
