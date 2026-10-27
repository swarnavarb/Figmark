/**
 * What happens to the stock of an order being cancelled. Only the seller
 * knows whether the unit is still sellable, so nothing is assumed: neither
 * answer starts picked, and cancelling waits until one is.
 */
export function RestockChoice({ quantity, value, onChange }: {
  quantity: number;
  value: boolean | null;
  onChange: (restock: boolean) => void;
}) {
  const units = quantity === 1 ? 'it' : `all ${quantity}`;
  const options = [
    { id: true, title: 'Put back on sale', note: `Add ${units} to stock again` },
    { id: false, title: 'Keep off sale', note: 'Damaged, lost or sold elsewhere' },
  ];
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ padding: 0 }}>What about the stock?</legend>
      {options.map((option) => (
        <label key={option.title} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
          <input type="radio" name="restock" checked={value === option.id} onChange={() => onChange(option.id)} />
          <span><b>{option.title}</b> <span className="muted">— {option.note}</span></span>
        </label>
      ))}
    </fieldset>
  );
}
