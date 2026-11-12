// Seeds the LOCAL database with fake users, clients and tickets.
// Run: npm run db:seed   (after npm run db:reset)
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { CLIENTS, DEMO_PASSWORD, TICKET_SUBJECTS, USERS } from './seed-data';

config({ path: '.env.local' });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error('Refusing to seed: NEXT_PUBLIC_SUPABASE_URL is not a local database.');
}
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// 1x1 JPEG used as a placeholder visit photo.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
const daysAgo = (n: number, hour = 9) => new Date(Date.now() - n * 86_400_000 + hour * 60_000).toISOString();

async function main() {
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const { data, error } = await db.auth.admin.createUser({ email: u.email, password: DEMO_PASSWORD, email_confirm: true });
    if (error) throw new Error(`${u.email}: ${error.message}`);
    ids[u.key] = data.user.id;
    must(await db.from('profiles').insert({ id: data.user.id, full_name: u.name, login_email: u.email, role: u.role }).select());
  }

  const clients: { id: string; owner: string; sites: string[] }[] = [];
  for (const c of CLIENTS) {
    const [row] = must(await db.from('clients').insert({
      name: c.name, account_owner: ids[c.owner], accreditation_status: c.status,
      billing_address: 'Sample address, Philippines', created_by: ids[c.owner],
    }).select('id'));
    const sites = must(await db.from('client_sites').insert(
      c.sites.map((s) => ({
        client_id: row.id, name: s, address: `${s}, Philippines`,
        island_group: /Cebu|Iloilo/.test(s) ? 'visayas' : /Davao|CDO/.test(s) ? 'mindanao' : 'luzon',
      })),
    ).select('id'));
    must(await db.from('contacts').insert({
      client_id: row.id, site_id: sites[0].id, name: `${c.name.split(' ')[0]} Warehouse Supervisor`,
      position: 'Warehouse Supervisor', mobile: '0917 000 0000', preferred_channel: 'viber',
    }).select('id'));
    clients.push({ id: row.id, owner: ids[c.owner], sites: sites.map((s) => s.id) });
  }

  const categories = must(await db.from('ticket_categories').select('id').order('sort_order'));
  const channels = ['messenger', 'viber', 'whatsapp', 'email', 'call', 'visit'];
  const statuses = ['open', 'open', 'in_progress', 'waiting_on_client', 'resolved', 'closed'];
  const ages = [0, 1, 2, 4, 6, 9, 12, 16, 22, 30];
  for (let i = 0; i < 40; i++) {
    const c = clients[i % clients.length];
    const age = ages[i % ages.length];
    const owner = i % 9 === 0 ? null : i % 4 === 0 ? ids.deployment_officer : c.owner;
    const [t] = must(await db.from('tickets').insert({
      client_id: c.id, site_id: c.sites[0], channel: channels[i % channels.length],
      category_id: categories[i % categories.length].id,
      subject: TICKET_SUBJECTS[i % TICKET_SUBJECTS.length],
      description: 'Sample concern copied from the client chat.',
      status: statuses[i % statuses.length], owner_id: owner,
      due_at: daysAgo(age - 3), created_by: c.owner, created_at: daysAgo(age),
    }).select('id'));
    if (i % 3 === 0) {
      must(await db.from('ticket_comments').insert({
        ticket_id: t.id, author_id: c.owner, body: 'Called the client. Waiting for their confirmation.',
        created_at: daysAgo(Math.max(age - 1, 0)),
      }).select('id'));
    }
  }

  for (const key of ['sales1', 'sales2'] as const) {
    const mine = clients.filter((c) => c.owner === ids[key]);
    for (let d = 3; d >= 1; d--) {
      must(await db.from('attendance_logs').insert({
        user_id: ids[key], clock_in_at: daysAgo(d, 0), clock_out_at: daysAgo(d, 540),
        in_lat: 14.3306, in_lng: 121.0835, in_accuracy_m: 12, out_lat: 14.3306, out_lng: 121.0835, out_accuracy_m: 15,
      }).select('id'));
      const visitId = crypto.randomUUID();
      const path = `${ids[key]}/${visitId}.jpg`;
      const up = await db.storage.from('visit-photos').upload(path, TINY_JPEG, { contentType: 'image/jpeg' });
      if (up.error) throw new Error(up.error.message);
      must(await db.from('client_visits').insert({
        id: visitId, user_id: ids[key], client_id: mine[d % mine.length].id, site_id: mine[d % mine.length].sites[0],
        purpose: 'Account visit', notes: 'Checked pallet condition with the supervisor.',
        photo_path: path, captured_at: daysAgo(d, 180), lat: 14.2794, lng: 121.1244, accuracy_m: 18,
      }).select('id'));
    }
  }
  console.log(`Seeded ${USERS.length} users, ${CLIENTS.length} clients, 40 tickets. Password for all: ${DEMO_PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
