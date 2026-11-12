import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { fmtDateTime, mapLink } from '@/components/ui';
import { FieldPanel } from './panel';

export default async function FieldPage() {
  const { supabase, user, can } = await getSession();
  if (!can('field.use')) redirect('/');
  const [{ data: open }, { data: clients }, { data: sites }, { data: shifts }, { data: visits }] = await Promise.all([
    supabase.from('attendance_logs').select('id, clock_in_at').eq('user_id', user.id).is('clock_out_at', null).maybeSingle(),
    supabase.from('clients').select('id, name, code').order('name'),
    supabase.from('client_sites').select('id, name, client_id').eq('is_active', true).order('name'),
    supabase.from('attendance_logs').select('id, clock_in_at, clock_out_at, in_lat, in_lng').eq('user_id', user.id).order('clock_in_at', { ascending: false }).limit(7),
    supabase.from('client_visits').select('id, purpose, captured_at, lat, lng, client:clients(name)').eq('user_id', user.id).order('captured_at', { ascending: false }).limit(7),
  ]);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="h1">Hello, {user.name.split(' ')[0]}</h1>
      <FieldPanel openShift={open ?? null} clients={clients ?? []} sites={sites ?? []} />
      <div className="card">
        <h2 className="h2 mb-2">My last shifts</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {(shifts ?? []).map((s) => (
            <li key={s.id} className="py-1.5">In {fmtDateTime(s.clock_in_at)} · Out {s.clock_out_at ? fmtDateTime(s.clock_out_at) : <b className="text-brand">still on shift</b>}
              {mapLink(s.in_lat, s.in_lng) && <> · <a className="text-brand underline" href={mapLink(s.in_lat, s.in_lng)!} target="_blank" rel="noreferrer">map</a></>}</li>
          ))}
          {!shifts?.length && <li className="py-1.5 text-stone-500">No shifts yet.</li>}
        </ul>
      </div>
      <div className="card">
        <h2 className="h2 mb-2">My last visits</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {(visits ?? []).map((v) => (
            <li key={v.id} className="py-1.5"><b>{(Array.isArray(v.client) ? v.client[0] : v.client)?.name}</b> — {v.purpose}<br /><span className="text-stone-500">{fmtDateTime(v.captured_at)}</span>
              {mapLink(v.lat, v.lng) && <> · <a className="text-brand underline" href={mapLink(v.lat, v.lng)!} target="_blank" rel="noreferrer">map</a></>}</li>
          ))}
          {!visits?.length && <li className="py-1.5 text-stone-500">No visits yet.</li>}
        </ul>
      </div>
    </div>
  );
}
