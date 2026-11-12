import { login } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={login} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-2 text-xl font-bold text-brand">RPPC Ops</h1>
          <p className="text-sm text-stone-500">Red Pallet Provider Co.</p>
        </div>
        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-800" role="alert">{error}</p>}
        <div>
          <label className="label" htmlFor="email">Email or login</label>
          <input className="input" id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn w-full" type="submit">Sign in</button>
        <p className="text-center text-xs text-stone-500">No account? Ask the Admin to create one.</p>
      </form>
    </main>
  );
}
