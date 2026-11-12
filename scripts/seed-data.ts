// Fake data for local development and tests. No real clients or people.
export const DEMO_PASSWORD = 'Rppc-demo-2026!';

export const USERS = [
  { key: 'admin', email: 'admin@rppc.test', name: 'Ana Admin', role: 'admin' },
  { key: 'sales1', email: 'sales1@rppc.test', name: 'Sam Sales', role: 'sales' },
  { key: 'sales2', email: 'sales2@rppc.test', name: 'Sara Sales', role: 'sales' },
  { key: 'deployment_officer', email: 'deploy@rppc.test', name: 'Dan Deployment', role: 'deployment_officer' },
  { key: 'driver', email: 'driver@rppc.test', name: 'Dino Driver', role: 'driver' },
  { key: 'production_officer', email: 'production@rppc.test', name: 'Pia Production', role: 'production_officer' },
  { key: 'maker', email: 'w-0001@rppc.local', name: 'Mario Maker', role: 'maker' },
  { key: 'painter', email: 'w-0002@rppc.local', name: 'Pedro Painter', role: 'painter' },
  { key: 'guard', email: 'guard@rppc.test', name: 'Gary Guard', role: 'guard' },
  { key: 'hr', email: 'hr@rppc.test', name: 'Hana HR', role: 'hr' },
  { key: 'finance', email: 'finance@rppc.test', name: 'Fe Finance', role: 'finance' },
  { key: 'purchasing', email: 'purchasing@rppc.test', name: 'Paolo Purchasing', role: 'purchasing' },
  { key: 'warehouse', email: 'warehouse@rppc.test', name: 'Wena Warehouse', role: 'warehouse' },
] as const;

export type UserKey = (typeof USERS)[number]['key'];

export const CLIENTS = [
  { name: 'Mabuhay Foods Corp.', owner: 'sales1', status: 'accredited', sites: ['Cabuyao Plant', 'Marilao Warehouse'] },
  { name: 'Bayanihan Logistics Inc.', owner: 'sales1', status: 'accredited', sites: ['Taguig Hub'] },
  { name: 'Sampaguita Consumer Goods', owner: 'sales1', status: 'verified', sites: ['Parañaque DC'] },
  { name: 'Kalayaan Beverages', owner: 'sales1', status: 'prospect', sites: ['Calamba Plant'] },
  { name: 'Tala Distribution Co.', owner: 'sales1', status: 'accredited', sites: ['Malabon Warehouse', 'Cebu Depot'] },
  { name: 'Lakbay 3PL Services', owner: 'sales1', status: 'suspended', sites: ['Pasig Crossdock'] },
  { name: 'Perlas Manufacturing', owner: 'sales2', status: 'accredited', sites: ['Sta. Rosa Plant'] },
  { name: 'Haribon Cold Chain', owner: 'sales2', status: 'accredited', sites: ['Davao Cold Store', 'CDO Cold Store'] },
  { name: 'Amihan Retail Group', owner: 'sales2', status: 'verified', sites: ['Meycauayan DC'] },
  { name: 'Dalisay Personal Care', owner: 'sales2', status: 'prospect', sites: ['Biñan Warehouse'] },
  { name: 'Agila Freight Forwarders', owner: 'sales2', status: 'accredited', sites: ['Valenzuela Yard'] },
  { name: 'Silangan Trading', owner: 'sales2', status: 'prospect', sites: ['Iloilo Depot'] },
] as const;

export const TICKET_SUBJECTS = [
  'Requesting 2 truckloads next week', 'Pull-out of 240 pallets', 'Billing summary has wrong quantity',
  'Damaged pallets need swapping', 'Asking for updated quotation', 'Delivery arrived late',
  'Need pallet audit schedule', 'Wrong pallet size delivered', 'Follow-up on DR copy',
  'Request for onsite repair visit',
];
