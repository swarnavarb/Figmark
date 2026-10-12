import { CONDITION_MEANINGS, type ConditionTag as Grade } from '@shared/enums';

/**
 * The grade a piece was sold as - MISB, MIB, BIB, LOOSE - as one coloured
 * stamp, so whoever has it in their hands (the shop, the supplier, the
 * handler) sees at a glance whether the seal must stay on.
 */
export function ConditionTag({ condition }: { condition: string | null | undefined }) {
  if (!condition) return null;
  const meaning = CONDITION_MEANINGS[condition as Grade];
  return (
    <span className={`cond cond--${condition.toLowerCase()}`} title={meaning ?? condition}
      aria-label={meaning ? `Condition: ${meaning}` : `Condition: ${condition}`}>
      {condition}
    </span>
  );
}
