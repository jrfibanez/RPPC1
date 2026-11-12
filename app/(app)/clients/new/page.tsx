import { Alert, PageHeader } from '@/components/ui';
import { createClientAction } from '../actions';
import { ClientFields } from '../fields';

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title="New client" />
      <Alert error={error} />
      <form action={createClientAction} className="card max-w-xl space-y-3">
        <ClientFields />
        <p className="text-sm text-stone-500">The client starts as a <b>Prospect</b> with you as the account owner.</p>
        <button className="btn">Save client</button>
      </form>
    </>
  );
}
