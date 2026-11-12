'use client';
import { useState } from 'react';

type C = { id: string; name: string; code: string };
type S = { id: string; name: string; client_id: string };

/** Client picker with a site picker that follows the chosen client. */
export function ClientSiteSelect({ clients, sites, defaultClient = '', required = false }: {
  clients: C[]; sites: S[]; defaultClient?: string; required?: boolean;
}) {
  const [client, setClient] = useState(defaultClient);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label className="label">Client{required ? ' *' : ''}</label>
        <select className="input" name="client_id" value={client} onChange={(e) => setClient(e.target.value)} required={required}>
          <option value="">{required ? 'Choose a client' : 'Not a client yet / unknown'}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
        </select></div>
      <div><label className="label">Site</label>
        <select className="input" name="site_id" key={client} defaultValue="">
          <option value="">Any / not sure</option>
          {sites.filter((s) => s.client_id === client).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></div>
    </div>
  );
}
