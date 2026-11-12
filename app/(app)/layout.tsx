import Link from 'next/link';
import { getSession, ROLE_LABELS } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, can } = await getSession();
  const tickets = can('tickets.read_all') || can('tickets.read_own');
  const links = [
    tickets && { href: '/', label: 'Dashboard' },
    tickets && { href: '/tickets', label: 'Tickets' },
    (can('clients.read_all') || can('clients.read_own')) && { href: '/clients', label: 'Clients' },
    can('field.use') && { href: '/field', label: 'Clock & visits' },
    can('field.read_all') && { href: '/attendance', label: 'Attendance' },
    can('admin.users') && { href: '/admin/users', label: 'Users' },
    can('admin.permissions') && { href: '/admin/permissions', label: 'Permissions' },
    can('audit.read') && { href: '/admin/audit', label: 'Audit log' },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-h-screen">
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold">RPPC Ops</Link>
          <nav className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
            {links.map((l) => <Link key={l.href} href={l.href} className="rounded px-1 py-1 hover:underline">{l.label}</Link>)}
          </nav>
          <form action="/logout" method="post" className="flex items-center gap-3 text-sm">
            <span>{user.name} · <span className="opacity-80">{ROLE_LABELS[user.role]}</span></span>
            <button className="rounded border border-white/60 px-2 py-1 hover:bg-white/10 cursor-pointer">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
