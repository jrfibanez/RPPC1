'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fieldQueue, getGps, stampedJpeg } from '@/lib/offline/browser';
import type { QueueItem } from '@/lib/offline/queue';
import type { FieldItem } from '@/lib/validation/schemas';

type C = { id: string; name: string; code: string };
type S = { id: string; name: string; client_id: string };
const SHIFT_KEY = 'rppc-open-shift';
const LABEL: Record<FieldItem['kind'], string> = { clock_in: 'Clock in', clock_out: 'Clock out', visit: 'Client visit' };

export function FieldPanel({ openShift, clients, sites }: { openShift: { id: string; clock_in_at: string } | null; clients: C[]; sites: S[] }) {
  const router = useRouter();
  const [shift, setShift] = useState(openShift);
  const [queue, setQueue] = useState<QueueItem<FieldItem>[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [visitOpen, setVisitOpen] = useState(false);

  const refresh = useCallback(async () => {
    await fieldQueue.sync();
    const items = await fieldQueue.list();
    setQueue(items);
    if (navigator.onLine && items.length === 0) router.refresh();
  }, [router]);

  // The phone remembers an open shift, so clock-out works even if the clock-in is still waiting to send.
  useEffect(() => {
    const pending = localStorage.getItem(SHIFT_KEY);
    if (openShift) localStorage.setItem(SHIFT_KEY, JSON.stringify(openShift));
    else if (pending) fieldQueue.list().then((items) => {
      const saved = JSON.parse(pending);
      if (items.some((i) => i.id === saved.id)) setShift(saved); else localStorage.removeItem(SHIFT_KEY);
    });
    refresh();
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [openShift, refresh]);
  useEffect(() => { setShift((s) => openShift ?? (queue.some((i) => i.id === s?.id) ? s : openShift)); }, [openShift, queue]);

  async function clock() {
    setBusy('Getting your location…'); setMessage('');
    const at = new Date().toISOString();
    const gps = await getGps();
    if (shift) {
      await fieldQueue.add({ id: crypto.randomUUID(), payload: { kind: 'clock_out', id: crypto.randomUUID(), shift_id: shift.id, at, ...gps } });
      localStorage.removeItem(SHIFT_KEY); setShift(null); setMessage('Clocked out.');
    } else {
      const id = crypto.randomUUID();
      await fieldQueue.add({ id, payload: { kind: 'clock_in', id, at, ...gps } });
      const s = { id, clock_in_at: at };
      localStorage.setItem(SHIFT_KEY, JSON.stringify(s)); setShift(s); setMessage('Clocked in.');
    }
    if (gps.lat == null) setMessage((m) => m + ' Location was not available, so it was saved without GPS.');
    setBusy('');
    await refresh();
  }

  const time = (iso: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'short', dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="space-y-4">
      <div className="card space-y-3 text-center">
        <p className="text-sm text-stone-600">{shift ? <>On shift since <b>{time(shift.clock_in_at)}</b></> : 'You are not clocked in.'}</p>
        <button onClick={clock} disabled={!!busy} className={`btn-big ${shift ? 'bg-ink' : 'bg-green-700'}`}>{busy || (shift ? 'Clock out' : 'Clock in')}</button>
        <button onClick={() => setVisitOpen(true)} disabled={!!busy} className="btn-big bg-brand">Log client visit</button>
        {message && <p className="text-sm font-medium text-green-800" role="status">{message}</p>}
      </div>

      {visitOpen && <VisitForm clients={clients} sites={sites} onClose={() => setVisitOpen(false)} onSaved={async () => { setVisitOpen(false); setMessage('Visit saved.'); await refresh(); }} />}

      {queue.length > 0 && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between"><h2 className="h2">Not yet sent ({queue.length})</h2>
            <button className="btn-light" onClick={refresh}>Send now</button></div>
          <ul className="divide-y divide-stone-100 text-sm">
            {queue.map((i) => (
              <li key={i.id} className="py-2">
                <b>{LABEL[i.payload.kind]}</b> · {time(i.payload.at)}<br />
                {i.status === 'waiting'
                  ? <span className="text-amber-700">Waiting to send. It will go when there is signal.</span>
                  : <span className="text-red-700">Needs attention: {i.error}{' '}
                      <button className="underline" onClick={async () => { await fieldQueue.retry(i.id); await refresh(); }}>Try again</button>{' · '}
                      <button className="underline" onClick={async () => { if (confirm('Remove this unsent record from the phone?')) { await fieldQueue.discard(i.id); await refresh(); } }}>Remove</button></span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function VisitForm({ clients, sites, onClose, onSaved }: { clients: C[]; sites: S[]; onClose: () => void; onSaved: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [client, setClient] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; at: string; gps: Awaited<ReturnType<typeof getGps>> } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Live camera only: the selfie must be taken now, not picked from the gallery.
  useEffect(() => {
    let stream: MediaStream | undefined;
    if (photo) return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); } })
      .catch(() => setError('The camera could not be opened. Allow camera access for this site and try again.'));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [photo]);

  async function take() {
    if (!video.current?.videoWidth) return;
    setBusy(true);
    const at = new Date();
    const frame = video.current;
    frame.pause();
    const gps = await getGps();
    const blob = await stampedJpeg(frame, at, gps);
    setPhoto({ blob, url: URL.createObjectURL(blob), at: at.toISOString(), gps });
    setBusy(false);
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!photo) return setError('Take the selfie first.');
    const f = new FormData(e.currentTarget);
    const id = crypto.randomUUID();
    await fieldQueue.add({
      id, photo: photo.blob,
      payload: { kind: 'visit', id, at: photo.at, client_id: String(f.get('client_id')), site_id: String(f.get('site_id') || '') || null,
        purpose: String(f.get('purpose')), notes: String(f.get('notes') ?? ''), ...photo.gps },
    });
    onSaved();
  }

  return (
    <form onSubmit={save} className="card space-y-3">
      <div className="flex items-center justify-between"><h2 className="h2">Client visit</h2><button type="button" className="text-sm underline" onClick={onClose}>Cancel</button></div>
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-800" role="alert">{error}</p>}
      {photo
        ? <div>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={photo.url} alt="Visit selfie" className="w-full rounded-md" />
            <button type="button" className="mt-2 text-sm underline" onClick={() => setPhoto(null)}>Retake</button></div>
        : <div><video ref={video} playsInline muted className="w-full rounded-md bg-black" style={{ transform: 'scaleX(-1)' }} />
            <button type="button" onClick={take} disabled={busy} className="btn mt-2 w-full py-3 text-base">{busy ? 'Getting your location…' : 'Take selfie'}</button></div>}
      <div><label className="label">Client *</label>
        <select className="input" name="client_id" required value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Choose a client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-stone-500">New prospect? Add it under Clients first.</p></div>
      <div><label className="label">Site</label>
        <select className="input" name="site_id" key={client}><option value="">Any / not sure</option>
          {sites.filter((s) => s.client_id === client).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div><label className="label">Purpose *</label><input className="input" name="purpose" required maxLength={200} placeholder="e.g. Account visit, pallet audit" /></div>
      <div><label className="label">Notes</label><textarea className="input" name="notes" rows={3} /></div>
      <button className="btn w-full py-3 text-base" disabled={!photo}>Save visit</button>
    </form>
  );
}
