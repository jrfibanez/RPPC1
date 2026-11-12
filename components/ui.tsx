import Link from 'next/link';

export function Alert({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <p role="alert" className={`mb-4 rounded-md p-3 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
      {error ?? notice}
    </p>
  );
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-red-100 text-red-800', in_progress: 'bg-amber-100 text-amber-800',
  waiting_on_client: 'bg-sky-100 text-sky-800', resolved: 'bg-green-100 text-green-800', closed: 'bg-stone-200 text-stone-700',
  prospect: 'bg-stone-200 text-stone-700', verified: 'bg-sky-100 text-sky-800',
  accredited: 'bg-green-100 text-green-800', suspended: 'bg-red-100 text-red-800',
};
export const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${STATUS_STYLE[value] ?? 'bg-stone-200 text-stone-700'}`}>{pretty(value)}</span>;
}

export function PageHeader({ title, action }: { title: string; action?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="h1">{title}</h1>
      {action && <Link className="btn" href={action.href}>{action.label}</Link>}
    </div>
  );
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', ...opts });
export const fmtDate = (v: string | null) => (v ? fmt({ dateStyle: 'medium' }).format(new Date(v)) : '—');
export const fmtDateTime = (v: string | null) => (v ? fmt({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—');
/** yyyy-mm-dd in Manila, for date inputs. */
export const manilaDateInput = (v: string | null) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(v)) : '');
export const mapLink = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);
