'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fieldQueue, stampedJpeg, type Gps } from '@/lib/offline/browser';
import type { QueueItem } from '@/lib/offline/queue';
import type { FieldItem } from '@/lib/validation/schemas';

type C = { id: string; name: string; code: string };
type S = { id: string; name: string; client_id: string };
const SHIFT_KEY = 'rppc-open-shift';
const LABEL: Record<FieldItem['kind'], string> = { clock_in: 'Clock in', clock_out: 'Clock out', visit: 'Client visit' };
const FRESH_MS = 2 * 60_000;   // a location older than this is not used

type GpsState = { status: 'checking' | 'ok' | 'denied' | 'unavailable'; fix: (Gps & { at: number }) | null };

/** Keeps the phone's location live while the screen is open. Nothing can be recorded without it. */
function useGps(): GpsState {
  const [gps, setGps] = useState<GpsState>({ status: 'checking', fix: null });
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      const t = setTimeout(() => setGps({ status: 'unavailable', fix: null }), 0);
      return () => clearTimeout(t);
    }
    const ok = (p: GeolocationPosition) =>
      setGps({ status: 'ok', fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy), at: Date.now() } });
    const fail = (e: GeolocationPositionError) =>
      setGps((g) => (e.code === e.PERMISSION_DENIED ? { status: 'denied', fix: null } : g.fix ? g : { status: 'unavailable', fix: null }));
    const opts = { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 };
    // Ask now, keep watching, and ask again every 15 seconds: some phones stop a watch silently.
    const ask = () => navigator.geolocation.getCurrentPosition(ok, fail, opts);
    ask();
    const watch = navigator.geolocation.watchPosition(ok, (e) => { if (e.code === e.PERMISSION_DENIED) fail(e); }, opts);
    const timer = setInterval(ask, 15_000);
    return () => { navigator.geolocation.clearWatch(watch); clearInterval(timer); };
  }, []);
  return gps;
}

function HowToAllow({ what }: { what: 'Location' | 'Camera' }) {
  return (
    <div className="rounded-md bg-red-50 p-3 text-left text-sm text-red-900" role="alert">
      <p className="font-semibold">{what} is turned off for this site.</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li><b>iPhone:</b> open Settings, find your browser (Chrome or Safari), and turn on <b>{what}</b>.
          {what === 'Location' && <> Also check Settings → Privacy &amp; Security → Location Services is on, with <b>Precise Location</b> on for the browser.</>}</li>
        <li><b>Android:</b> tap the lock icon beside the address, then Permissions, and allow <b>{what}</b>.</li>
        <li>Come back here and reload the page. Tap <b>Allow</b> when the phone asks.</li>
      </ul>
    </div>
  );
}

function GpsBadge({ gps }: { gps: GpsState }) {
  if (gps.status === 'ok' && gps.fix) return <p className="text-sm font-medium text-green-800">● Location on (accurate to about {gps.fix.accuracy_m ?? '?'} m)</p>;
  if (gps.status === 'checking') return <p className="text-sm font-medium text-amber-700">Finding your location… please wait.</p>;
  if (gps.status === 'denied') return <HowToAllow what="Location" />;
  return <p className="rounded-md bg-red-50 p-3 text-sm text-red-900" role="alert">Your location could not be found. Turn on GPS, move near a window or outside, and wait a few seconds.</p>;
}

export function FieldPanel({ openShift, clients, sites }: { openShift: { id: string; clock_in_at: string } | null; clients: C[]; sites: S[] }) {
  const router = useRouter();
  const gps = useGps();
  // What this phone knows that the server has not confirmed yet (undefined = nothing newer than the server).
  const [local, setShift] = useState<{ id: string; clock_in_at: string } | null | undefined>(undefined);
  // When the server's answer changes, it wins over what the phone assumed.
  const [seen, setSeen] = useState(openShift?.id ?? null);
  if ((openShift?.id ?? null) !== seen) { setSeen(openShift?.id ?? null); setShift(undefined); }
  const shift = local !== undefined ? local : openShift;
  const [queue, setQueue] = useState<QueueItem<FieldItem>[]>([]);
  const [message, setMessage] = useState('');
  const [visitOpen, setVisitOpen] = useState(false);
  const ready = gps.status === 'ok' && !!gps.fix;

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
    const first = setTimeout(refresh, 0);   // send anything left over from last time
    window.addEventListener('online', refresh);
    return () => { clearTimeout(first); window.removeEventListener('online', refresh); };
  }, [openShift, refresh]);

  /** The current location, or null (with a message) when there is no fresh one. */
  function currentFix(): Gps | null {
    if (!gps.fix || Date.now() - gps.fix.at > FRESH_MS) {
      setMessage('Still finding your location. Wait a few seconds and try again.');
      return null;
    }
    return { lat: gps.fix.lat, lng: gps.fix.lng, accuracy_m: gps.fix.accuracy_m };
  }

  async function clock() {
    setMessage('');
    const fix = currentFix();
    if (!fix) return;
    const at = new Date().toISOString();
    if (shift) {
      await fieldQueue.add({ id: crypto.randomUUID(), payload: { kind: 'clock_out', id: crypto.randomUUID(), shift_id: shift.id, at, ...fix } });
      localStorage.removeItem(SHIFT_KEY); setShift(null); setMessage('Clocked out.');
    } else {
      const id = crypto.randomUUID();
      await fieldQueue.add({ id, payload: { kind: 'clock_in', id, at, ...fix } });
      const s = { id, clock_in_at: at };
      localStorage.setItem(SHIFT_KEY, JSON.stringify(s)); setShift(s); setMessage('Clocked in.');
    }
    await refresh();
  }

  const time = (iso: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'short', dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="space-y-4">
      <div className="card space-y-3 text-center">
        <GpsBadge gps={gps} />
        <p className="text-sm text-stone-600">{shift ? <>On shift since <b>{time(shift.clock_in_at)}</b></> : 'You are not clocked in.'}</p>
        <button onClick={clock} disabled={!ready} className={`btn-big ${shift ? 'bg-ink' : 'bg-green-700'}`}>{shift ? 'Clock out' : 'Clock in'}</button>
        <button onClick={() => { setMessage(''); setVisitOpen(true); }} disabled={!ready} className="btn-big bg-brand">Log client visit</button>
        {!ready && <p className="text-xs text-stone-500">The buttons work once your location is on.</p>}
        {message && <p className="text-sm font-medium text-green-800" role="status">{message}</p>}
      </div>

      {visitOpen && <VisitForm clients={clients} sites={sites} getFix={currentFix} onClose={() => setVisitOpen(false)} onSaved={async () => { setVisitOpen(false); setMessage('Visit saved.'); await refresh(); }} />}

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

function VisitForm({ clients, sites, getFix, onClose, onSaved }: { clients: C[]; sites: S[]; getFix: () => Gps | null; onClose: () => void; onSaved: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [client, setClient] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; at: string; gps: Gps } | null>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'blocked' | 'missing'>('starting');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Live camera only: the selfie must be taken now, not picked from the gallery.
  useEffect(() => {
    let stream: MediaStream | undefined; let cancelled = false;
    if (photo) return;
    if (!navigator.mediaDevices?.getUserMedia) { Promise.resolve().then(() => setCamera('missing')); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s; setCamera('on');
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      })
      .catch((e: DOMException) => setCamera(e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'blocked' : 'missing'));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [photo, attempt]);

  async function take() {
    setError('');
    if (!video.current?.videoWidth) return;
    const gps = getFix();
    if (!gps) return setError('Still finding your location. Wait a few seconds and try again.');
    const at = new Date();
    const blob = await stampedJpeg(video.current, at, gps);
    setPhoto({ blob, url: URL.createObjectURL(blob), at: at.toISOString(), gps });
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
      {photo ? (
        <div><img src={photo.url} alt="Visit selfie" className="w-full rounded-md" />
          <button type="button" className="mt-2 text-sm underline" onClick={() => { setCamera('starting'); setPhoto(null); }}>Retake</button></div>
      ) : camera === 'blocked' || camera === 'missing' ? (
        <div className="space-y-2">
          {camera === 'blocked' ? <HowToAllow what="Camera" />
            : <p className="rounded-md bg-red-50 p-3 text-sm text-red-900" role="alert">No camera was found, or another app is using it. Close other camera apps and try again.</p>}
          <button type="button" className="btn-light w-full" onClick={() => { setCamera('starting'); setAttempt((n) => n + 1); }}>Try the camera again</button>
        </div>
      ) : (
        <div><video ref={video} playsInline muted className="w-full rounded-md bg-black" style={{ transform: 'scaleX(-1)' }} />
          <button type="button" onClick={take} disabled={camera !== 'on'} className="btn mt-2 w-full py-3 text-base">{camera === 'on' ? 'Take selfie' : 'Opening camera…'}</button></div>
      )}
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
