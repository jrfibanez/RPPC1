'use client';
import { openDB } from 'idb';
import type { FieldItem } from '@/lib/validation/schemas';
import { createQueue, type QueueItem, type QueueStore, type SendResult } from './queue';

const db = () => openDB('rppc-ops', 1, { upgrade: (d) => { d.createObjectStore('queue', { keyPath: 'id' }); } });

const idbStore: QueueStore<FieldItem> = {
  all: async () => (await db()).getAll('queue'),
  put: async (item) => { await (await db()).put('queue', item); },
  remove: async (id) => { await (await db()).delete('queue', id); },
};

async function send(item: QueueItem<FieldItem>): Promise<SendResult> {
  const body = new FormData();
  body.set('item', JSON.stringify(item.payload));
  if (item.photo) body.set('photo', item.photo, 'photo.jpg');
  const res = await fetch('/api/field/sync', { method: 'POST', body });   // throws when offline
  if (res.ok) return { ok: true };
  const json = await res.json().catch(() => ({}));
  const error = json.error ?? `Server error ${res.status}`;
  // Sign-in expired or server trouble: keep waiting. A clear refusal: needs attention.
  return { ok: false, retry: res.status === 401 || res.status >= 500, error };
}

export const fieldQueue = createQueue<FieldItem>(idbStore, send);

export type Gps = { lat: number; lng: number; accuracy_m: number | null };

/** Shrinks a camera frame to 1280 px and writes date, time and GPS onto the picture. */
export async function stampedJpeg(source: HTMLVideoElement, at: Date, gps: Gps): Promise<Blob> {
  const scale = Math.min(1, 1280 / Math.max(source.videoWidth, source.videoHeight));
  const w = Math.round(source.videoWidth * scale), h = Math.round(source.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, w, h);
  const when = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'medium' }).format(at);
  const where = `GPS ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} (±${gps.accuracy_m ?? '?'} m)`;
  const size = Math.max(14, Math.round(w / 40));
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h - size * 3.2, w, size * 3.2);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size}px sans-serif`;
  ctx.fillText(`RPPC · ${when} (Manila)`, size * 0.6, h - size * 1.9);
  ctx.fillText(where, size * 0.6, h - size * 0.6);
  for (const quality of [0.7, 0.5, 0.35]) {
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', quality));
    if (blob.size <= 300 * 1024 || quality === 0.35) return blob;
  }
  throw new Error('unreachable');
}
