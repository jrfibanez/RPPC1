type Values = { name?: string; trade_name?: string | null; tin?: string | null; billing_address?: string | null; billing_cutoff_day?: number };

export function ClientFields({ v = {}, disabled = false }: { v?: Values; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <div><label className="label">Registered name *</label><input className="input" name="name" defaultValue={v.name ?? ''} required /></div>
      <div><label className="label">Trade name</label><input className="input" name="trade_name" defaultValue={v.trade_name ?? ''} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">TIN</label><input className="input" name="tin" defaultValue={v.tin ?? ''} /></div>
        <div><label className="label">Billing cutoff day (1–28)</label><input className="input" name="billing_cutoff_day" type="number" min={1} max={28} defaultValue={v.billing_cutoff_day ?? 10} /></div>
      </div>
      <div><label className="label">Billing address</label><textarea className="input" name="billing_address" rows={2} defaultValue={v.billing_address ?? ''} /></div>
    </fieldset>
  );
}
