import { getSession } from '@/lib/auth';
import { Alert, PageHeader, pretty } from '@/components/ui';
import { ClientSiteSelect } from '@/components/client-site-select';
import { CHANNELS } from '@/lib/validation/schemas';
import { createTicketAction } from '../actions';

export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ error?: string; client?: string }> }) {
  const { error, client = '' } = await searchParams;
  const { supabase, user } = await getSession();
  const [{ data: clients }, { data: sites }, { data: cats }, { data: people }] = await Promise.all([
    supabase.from('clients').select('id, name, code').order('name'),
    supabase.from('client_sites').select('id, name, client_id').eq('is_active', true).order('name'),
    supabase.from('ticket_categories').select('id, name').eq('is_active', true).order('sort_order'),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true).in('role', ['admin', 'sales', 'deployment_officer', 'finance']).order('full_name'),
  ]);
  return (
    <>
      <PageHeader title="New ticket" />
      <Alert error={error} />
      <form action={createTicketAction} className="card max-w-2xl space-y-3">
        <ClientSiteSelect clients={clients ?? []} sites={sites ?? []} defaultClient={client} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Came in through *</label>
            <select className="input" name="channel" required>{CHANNELS.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</select></div>
          <div><label className="label">Category *</label>
            <select className="input" name="category_id" required>{(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        <div><label className="label">Subject *</label><input className="input" name="subject" required maxLength={200} placeholder="Short summary of the concern" /></div>
        <div><label className="label">Details</label><textarea className="input" name="description" rows={4} placeholder="What the client said. You can attach the chat screenshot after saving." /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Owner</label>
            <select className="input" name="owner_id" defaultValue={user.id}>
              <option value="">No owner yet</option>
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name} ({pretty(p.role)})</option>)}
            </select></div>
          <div><label className="label">Due date</label><input className="input" type="date" name="due_at" /></div>
        </div>
        <button className="btn">Save ticket</button>
      </form>
    </>
  );
}
