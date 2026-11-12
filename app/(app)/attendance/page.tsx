import { redirect } from 'next/navigation';
import { explain, getSession } from '@/lib/auth';
import { Alert, PageHeader, fmtDateTime, mapLink } from '@/components/ui';

async function closeShiftAction(form: FormData) {
  'use server';
  const { supabase } = await getSession();
  const id = String(form.get('id'));
  const reason = String(form.get('close_reason') ?? '').trim();
  if (!reason) redirect('/attendance?error=' + encodeURIComponent('A reason is required to close a shift.'));
  const { data, error } = await supabase.from('attendance_logs')
    .update({ clock_out_at: new Date().toISOString(), close_reason: reason }).eq('id', id).select('id');
  if (error || !data?.length) redirect('/attendance?error=' + encodeURIComponent(error ? explain(error) : 'You are not allowed to do this.'));
  redirect('/attendance?notice=Shift+closed');
}

const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);
const Map = ({ lat, lng }: { lat: number | null; lng: number | null }) =>
  mapLink(lat, lng) ? <a className="text-brand underline" href={mapLink(lat, lng)!} target="_blank" rel="noreferrer">map</a> : <span className="text-stone-400">no GPS</span>;

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const { supabase, can } = await getSession();
  if (!can('field.read_all')) redirect('/');
  const [{ data: shifts }, { data: visits }] = await Promise.all([
    supabase.from('attendance_logs').select('*, who:profiles!attendance_logs_user_id_fkey(full_name)').order('clock_in_at', { ascending: false }).limit(200),
    supabase.from('client_visits').select('*, who:profiles!client_visits_user_id_fkey(full_name), client:clients(name), site:client_sites(name)').order('captured_at', { ascending: false }).limit(200),
  ]);
  const signed = visits?.length ? (await supabase.storage.from('visit-photos').createSignedUrls(visits.map((v) => v.photo_path), 300)).data ?? [] : [];
  const photo = (p: string) => signed.find((s) => s.path === p)?.signedUrl ?? undefined;

  return (
    <>
      <PageHeader title="Attendance and visits" />
      <Alert error={error} notice={notice} />
      <div className="mb-3 flex gap-2">
        <a className="btn-light" href="/api/attendance/export?type=shifts">Download shifts (CSV)</a>
        <a className="btn-light" href="/api/attendance/export?type=visits">Download visits (CSV)</a>
      </div>
      <h2 className="h2 mb-2">Clock in / clock out</h2>
      <div className="card mb-6 overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-stone-200"><tr><th className="th">Person</th><th className="th">Clock in</th><th className="th">Clock out</th><th className="th">Note</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {(shifts ?? []).map((s) => (
              <tr key={s.id}>
                <td className="td">{one(s.who)?.full_name}</td>
                <td className="td whitespace-nowrap">{fmtDateTime(s.clock_in_at)} · <Map lat={s.in_lat} lng={s.in_lng} /></td>
                <td className="td whitespace-nowrap">{s.clock_out_at ? <>{fmtDateTime(s.clock_out_at)} · {s.closed_by ? <span className="text-stone-500">closed by Admin</span> : <Map lat={s.out_lat} lng={s.out_lng} />}</> : <b className="text-brand">Still on shift</b>}</td>
                <td className="td">{s.close_reason ?? (!s.clock_out_at && can('field.close_shift') && (
                  <form action={closeShiftAction} className="flex gap-2"><input type="hidden" name="id" value={s.id} />
                    <input className="input" name="close_reason" placeholder="Reason" required /><button className="btn-light whitespace-nowrap">Close shift</button></form>))}</td>
              </tr>
            ))}
            {!shifts?.length && <tr><td className="td text-stone-500" colSpan={4}>No records yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2 className="h2 mb-2">Client visits</h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-stone-200"><tr><th className="th">Person</th><th className="th">Client</th><th className="th">Purpose</th><th className="th">When and where</th><th className="th">Selfie</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {(visits ?? []).map((v) => (
              <tr key={v.id}>
                <td className="td">{one(v.who)?.full_name}</td>
                <td className="td">{one(v.client)?.name}<div className="text-xs text-stone-500">{one(v.site)?.name}</div></td>
                <td className="td">{v.purpose}<div className="text-xs text-stone-500">{v.notes}</div></td>
                <td className="td whitespace-nowrap">{fmtDateTime(v.captured_at)} · <Map lat={v.lat} lng={v.lng} /></td>
                <td className="td"><a className="text-brand underline" href={photo(v.photo_path)} target="_blank" rel="noreferrer">View photo</a></td>
              </tr>
            ))}
            {!visits?.length && <tr><td className="td text-stone-500" colSpan={5}>No visits yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
