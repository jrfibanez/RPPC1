import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fieldItemSchema, firstIssue } from '@/lib/validation/schemas';

const refuse = (error: string, status = 422) => NextResponse.json({ ok: false, error }, { status });
const allowed = 'You are not allowed to do this.';

// Receives one queued field action from a phone. Safe to receive the same item twice.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return refuse('Please sign in again.', 401);

  const form = await request.formData();
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('item'))); } catch { return refuse('Unreadable record.'); }
  const parsed = fieldItemSchema.safeParse(raw);
  if (!parsed.success) return refuse(firstIssue(parsed.error));
  const item = parsed.data;

  if (item.kind === 'clock_in') {
    const { data: existing } = await supabase.from('attendance_logs').select('id').eq('id', item.id).maybeSingle();
    if (existing) return NextResponse.json({ ok: true });
    const { error } = await supabase.from('attendance_logs').insert({
      id: item.id, user_id: user.id, clock_in_at: item.at, in_lat: item.lat, in_lng: item.lng, in_accuracy_m: item.accuracy_m,
    });
    if (!error) return NextResponse.json({ ok: true });
    if (error.code === '23505') return refuse('You are already clocked in. Clock out first.');
    return error.code === '42501' ? refuse(allowed, 403) : refuse(error.message, 500);
  }

  if (item.kind === 'clock_out') {
    const { data: shift } = await supabase.from('attendance_logs').select('id, clock_out_at').eq('id', item.shift_id).maybeSingle();
    if (!shift) return refuse('The clock-in for this shift was not found.');
    if (shift.clock_out_at) return NextResponse.json({ ok: true });
    const { error } = await supabase.from('attendance_logs').update({
      clock_out_at: item.at, out_lat: item.lat, out_lng: item.lng, out_accuracy_m: item.accuracy_m,
    }).eq('id', item.shift_id);
    return error ? refuse(error.message, error.code === '42501' ? 403 : 422) : NextResponse.json({ ok: true });
  }

  // Client visit with selfie.
  const { data: existing } = await supabase.from('client_visits').select('id').eq('id', item.id).maybeSingle();
  if (existing) return NextResponse.json({ ok: true });
  const photo = form.get('photo');
  if (!(photo instanceof Blob) || photo.size === 0) return refuse('The visit photo is missing.');
  if (photo.size > 2 * 1024 * 1024) return refuse('The visit photo is too large.');
  const path = `${user.id}/${item.id}.jpg`;
  const up = await supabase.storage.from('visit-photos').upload(path, photo, { contentType: 'image/jpeg' });
  if (up.error && !/exists/i.test(up.error.message)) {
    return /row-level security|not allowed|unauthorized/i.test(up.error.message) ? refuse(allowed, 403) : refuse(up.error.message, 500);
  }
  const { error } = await supabase.from('client_visits').insert({
    id: item.id, user_id: user.id, client_id: item.client_id, site_id: item.site_id, purpose: item.purpose, notes: item.notes,
    photo_path: path, captured_at: item.at, lat: item.lat, lng: item.lng, accuracy_m: item.accuracy_m,
  });
  if (!error || error.code === '23505') return NextResponse.json({ ok: true });
  return error.code === '42501' ? refuse(allowed, 403) : refuse(error.message, 422);
}
