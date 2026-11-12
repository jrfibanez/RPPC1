import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const cell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;            // stop spreadsheet formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const manila = (v: string | null) => (v ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(v)) : '');
const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);

// RLS decides what comes back: Admin gets everyone, others only their own rows.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const type = request.nextUrl.searchParams.get('type') === 'visits' ? 'visits' : 'shifts';
  let rows: unknown[][];
  if (type === 'shifts') {
    const { data } = await supabase.from('attendance_logs').select('*, who:profiles!attendance_logs_user_id_fkey(full_name)').order('clock_in_at', { ascending: false }).limit(10000);
    rows = [['Person', 'Clock in (Manila)', 'In lat', 'In lng', 'Clock out (Manila)', 'Out lat', 'Out lng', 'Closed by Admin', 'Reason'],
      ...(data ?? []).map((s) => [one(s.who)?.full_name, manila(s.clock_in_at), s.in_lat, s.in_lng, manila(s.clock_out_at), s.out_lat, s.out_lng, s.closed_by ? 'yes' : '', s.close_reason])];
  } else {
    const { data } = await supabase.from('client_visits').select('*, who:profiles!client_visits_user_id_fkey(full_name), client:clients(name, code), site:client_sites(name)').order('captured_at', { ascending: false }).limit(10000);
    rows = [['Person', 'Client code', 'Client', 'Site', 'Purpose', 'Notes', 'Taken (Manila)', 'Lat', 'Lng', 'Accuracy m'],
      ...(data ?? []).map((v) => [one(v.who)?.full_name, one(v.client)?.code, one(v.client)?.name, one(v.site)?.name, v.purpose, v.notes, manila(v.captured_at), v.lat, v.lng, v.accuracy_m])];
  }
  return new NextResponse('﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="rppc-${type}.csv"` },
  });
}
