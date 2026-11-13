// Click-through smoke test. Run against a seeded app: BASE_URL=http://localhost:3100 node tests/e2e/smoke.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Rppc-demo-2026!';
const SHOTS = process.env.SHOTS_DIR;
let failed = 0;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++; };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function session(email, opts = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); failed++; });
  await page.goto('/login');
  await page.fill('#email', email); await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const tag = Math.random().toString(36).slice(2, 8);

// --- Sales: client, ticket, comment, cannot see other accounts ---------------
{
  const { ctx, page } = await session('sales1@rppc.test');
  check('sales lands on backlog dashboard', await page.getByRole('heading', { name: /Backlog/ }).isVisible());
  await shot(page, 'dashboard-sales');
  await page.goto('/clients');
  check('sales sees own clients only', (await page.locator('tbody tr').count()) >= 6 && !(await page.getByText('Perlas Manufacturing').count()));
  await page.goto('/clients/new');
  await page.fill('input[name=name]', `Smoke Test Co ${tag}`);
  await page.click('text=Save client');
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  check('client created with CL- code', /CL-\d{4}/.test(await page.locator('body').innerText()));
  await page.fill('input[placeholder="Site name *"]', 'Main Warehouse'); await page.click('text=Add site');
  await page.waitForURL(/notice=Site/);
  check('site gets -S01 code', /CL-\d{4}-S01/.test(await page.locator('body').innerText()));
  check('sales cannot choose Accredited', (await page.locator('select[name=accreditation_status] option[value=accredited]').count()) === 0);
  await page.click('text=New ticket');
  await page.selectOption('select[name=channel]', 'viber');
  await page.fill('input[name=subject]', `Smoke concern ${tag}`);
  await page.fill('textarea[name=description]', 'Client asked for 480 pallets.');
  await page.click('text=Save ticket');
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}/);
  check('ticket created with TKT- code', /TKT-\d{4}-\d{5}/.test(await page.locator('body').innerText()));
  await page.fill('textarea[name=body]', 'Called the client back.'); await page.click('text=Post comment');
  await page.waitForSelector('text=Called the client back.');
  await page.selectOption('select[name=status]', 'in_progress'); await page.click('text=Save changes');
  await page.waitForURL(/notice=Saved/);
  check('status change is written into the thread', await page.getByText('Status: open → in progress').isVisible());
  check('sales has no void button', (await page.getByText('Void ticket').count()) === 0);
  await shot(page, 'ticket');
  await page.goto(`/tickets?q=Smoke+concern+${tag}&view=all`);
  check('search finds the ticket', (await page.locator('tbody tr').count()) === 1);
  for (const p of ['/admin/users', '/admin/audit', '/attendance']) { await page.goto(p); check(`sales is kept out of ${p}`, new URL(page.url()).pathname === '/'); }
  await ctx.close();
}
// --- Other sales user cannot find it -------------------------------------------
{
  const { ctx, page } = await session('sales2@rppc.test');
  await page.goto(`/tickets?q=Smoke+concern+${tag}&view=all`);
  check('another salesperson cannot find that ticket', await page.getByText('No tickets found.').isVisible());
  await ctx.close();
}
// --- Sales on a phone: clock in, visit with selfie, clock out --------------------
{
  const { ctx, page } = await session('sales2@rppc.test', {
    viewport: { width: 390, height: 844 }, permissions: ['geolocation', 'camera'], geolocation: { latitude: 14.3306, longitude: 121.0835, accuracy: 9 },
  });
  await page.goto('/field');
  await page.waitForSelector('text=Location on');
  if (await page.getByRole('button', { name: 'Clock out' }).count()) {
    await page.getByRole('button', { name: 'Clock out' }).click({ noWaitAfter: true }).catch(() => {});
    await page.waitForSelector('text=You are not clocked in.');
  }
  await page.getByRole('button', { name: 'Clock in' }).click();
  await page.waitForSelector('text=On shift since');
  check('clock in works on the phone screen', true);
  await page.click('text=Log client visit');
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  await page.click('text=Take selfie');
  await page.waitForSelector('img[alt="Visit selfie"]');
  await page.selectOption('select[name=client_id]', { index: 1 });
  await page.fill('input[name=purpose]', `Smoke visit ${tag}`);
  await page.click('text=Save visit');
  await page.waitForSelector(`text=Smoke visit ${tag}`, { timeout: 15000 });
  check('visit with selfie is saved and listed', true);
  await shot(page, 'field-phone');
  // Offline: the press is kept on the phone, then sent when signal returns.
  await ctx.setOffline(true);
  await page.getByRole('button', { name: 'Clock out' }).click();
  await page.waitForSelector('text=Waiting to send');
  check('offline clock-out waits in the queue', true);
  await ctx.setOffline(false);
  // The app sends by itself as soon as the phone is back online.
  await page.waitForSelector('text=Not yet sent', { state: 'detached', timeout: 15000 });
  check('queued clock-out is sent when signal returns', true);
  await ctx.close();
}
// --- Phone with location blocked: nothing can be recorded ---------------------------
{
  const { ctx, page } = await session('sales1@rppc.test', { viewport: { width: 390, height: 844 }, permissions: [] });
  await page.goto('/field');
  await page.waitForSelector('text=Location is turned off for this site.');
  check('with location blocked, clock and visit buttons are disabled', await page.getByRole('button', { name: /Clock (in|out)/ }).isDisabled() && await page.getByRole('button', { name: 'Log client visit' }).isDisabled());
  await ctx.close();
}
// --- Admin: everything, attendance, audit, void ----------------------------------
{
  const { ctx, page } = await session('admin@rppc.test');
  await page.goto('/attendance');
  check('admin sees the visit and its photo link', await page.getByText(`Smoke visit ${tag}`).isVisible() && (await page.getByText('View photo').count()) > 0);
  await shot(page, 'attendance');
  await page.goto('/admin/audit?table=tickets');
  check('audit log shows who changed the ticket', (await page.getByText('Sam Sales').count()) > 0);
  await page.goto('/admin/permissions'); check('permission table opens', await page.getByText('See all tickets').isVisible());
  await page.goto('/admin/users'); check('user list opens', await page.getByText('w-0001@rppc.local').isVisible());
  await page.goto(`/tickets?q=Smoke+concern+${tag}&view=all`);
  await page.click(`text=Smoke concern ${tag}`);
  await page.fill('input[name=void_reason]', 'Smoke test clean-up'); await page.click('button:has-text("Void ticket")');
  await page.waitForURL(/notice=Ticket\+voided/);
  check('admin can void with a reason; ticket stays', await page.getByText('Reason: Smoke test clean-up').isVisible());
  await ctx.close();
}
// --- Finance accredits; a maker has nothing yet ------------------------------------
{
  const { ctx, page } = await session('finance@rppc.test');
  await page.goto(`/clients?q=Smoke+Test+Co+${tag}`);
  await page.click(`text=Smoke Test Co ${tag}`);
  await page.selectOption('select[name=accreditation_status]', 'accredited'); await page.click('text=Update status');
  await page.waitForURL(/notice=Status/);
  check('finance can accredit a client', (await page.locator('.badge', { hasText: 'Accredited' }).count()) > 0);
  check('finance cannot edit client details', await page.locator('input[name=name]').isDisabled());
  await ctx.close();
}
{
  const { ctx, page } = await session('w-0001@rppc.local');
  check('a pallet maker sees the "later phase" notice', await page.getByText('later phase').isVisible());
  await page.goto('/tickets'); check('a pallet maker sees no tickets', await page.getByText('No tickets found.').isVisible());
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
