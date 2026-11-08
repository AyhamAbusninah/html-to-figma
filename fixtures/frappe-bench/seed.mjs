#!/usr/bin/env node
// Seeds the Frappe/ERPNext v15 STRESS-TEST BENCHMARK (TST-3a). Benchmark-only (SYS-7).
//
//  1. Logs in as Administrator.
//  2. Completes the ERPNext setup wizard with demo data (once; idempotent).
//  3. Creates two benchmark users: one English (LTR) and one Arabic (RTL).
//
// Usage: node fixtures/frappe-bench/seed.mjs [--base http://127.0.0.1:8085]
// Zero dependencies (Node 22 global fetch). Credentials are throwaway local values.

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = (baseIdx >= 0 ? args[baseIdx + 1] : process.env.H2F_FRAPPE_URL) ?? `http://127.0.0.1:${process.env.H2F_FRAPPE_PORT ?? 8085}`;

export const BENCH_USERS = [
  { email: 'bench-en@example.com', first_name: 'Bench', last_name: 'English', language: 'en', password: 'H2f-bench-EN-2026' },
  { email: 'bench-ar@example.com', first_name: 'مستخدم', last_name: 'عربي', language: 'ar', password: 'H2f-bench-AR-2026' },
];

let cookie = '';

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length) {
    const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));
    for (const sc of setCookies) {
      const [kv] = sc.split(';');
      const [k, v] = kv.split(/=(.*)/s);
      jar.set(k, v);
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 800)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function waitForSite(timeoutMs = 300_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/method/ping`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Site at ${BASE} not reachable after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function setupWizardDone() {
  const r = await call('GET', '/api/method/frappe.client.get_value?doctype=System%20Settings&fieldname=setup_complete&filters=System%20Settings');
  return Boolean(Number(r.message?.setup_complete));
}

async function runSetupWizard() {
  const year = new Date().getFullYear();
  const wizardArgs = {
    language: 'English',
    country: 'Jordan',
    timezone: 'Asia/Amman',
    currency: 'JOD',
    full_name: 'Bench Admin',
    email: 'bench-admin@example.com',
    password: 'admin',
    company_name: 'H2F Benchmark Co',
    company_abbr: 'HBC',
    chart_of_accounts: 'Standard',
    fy_start_date: `${year}-01-01`,
    fy_end_date: `${year}-12-31`,
    setup_demo: 1,
  };
  await call('POST', '/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete', {
    args: JSON.stringify(wizardArgs),
  });
}

async function ensureUser(u) {
  const exists = await call('GET', `/api/method/frappe.client.get_count?doctype=User&filters=${encodeURIComponent(JSON.stringify({ name: u.email }))}`);
  const doc = {
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    language: u.language,
    send_welcome_email: 0,
    user_type: 'System User',
    new_password: u.password,
    roles: ['System Manager', 'Accounts Manager', 'Sales Manager', 'Stock Manager', 'Sales User'].map((role) => ({ role })),
  };
  if (exists.message > 0) {
    await call('PUT', `/api/resource/User/${encodeURIComponent(u.email)}`, { language: u.language, new_password: u.password });
    return 'updated';
  }
  await call('POST', '/api/resource/User', doc);
  return 'created';
}

const POS_PROFILE = 'H2F Benchmark POS';

const enc = encodeURIComponent;
async function list(doctype, fields, filters = []) {
  const qs = `fields=${enc(JSON.stringify(fields))}&filters=${enc(JSON.stringify(filters))}&limit_page_length=100`;
  return (await call('GET', `/api/resource/${enc(doctype)}?${qs}`)).data;
}

/** POS view needs a POS Profile and an open POS Opening Entry per user, else it shows a setup dialog. */
async function ensurePos() {
  const companies = await list('Company', ['name', 'abbr', 'cost_center', 'write_off_account']);
  const company = companies.find((c) => c.name.endsWith('(Demo)')) ?? companies[0];
  if (!company) throw new Error('No company found; setup wizard did not run');

  if ((await list('POS Profile', ['name'], [['name', '=', POS_PROFILE]])).length === 0) {
    const [customer] = await list('Customer', ['name']);
    await call('POST', '/api/resource/POS%20Profile', {
      name: POS_PROFILE,
      __newname: POS_PROFILE,
      company: company.name,
      warehouse: `Stores - ${company.abbr}`,
      selling_price_list: 'Standard Selling',
      currency: (await list('Company', ['default_currency'], [['name', '=', company.name]]))[0].default_currency,
      customer: customer?.name,
      write_off_account: company.write_off_account,
      write_off_cost_center: company.cost_center,
      cost_center: company.cost_center,
      payments: [{ mode_of_payment: 'Cash', default: 1 }],
      applicable_for_users: BENCH_USERS.map((u) => ({ user: u.email, default: 1 })),
    });
    console.log(`[seed] POS Profile "${POS_PROFILE}" created for ${company.name}`);
  } else {
    console.log(`[seed] POS Profile "${POS_PROFILE}" exists`);
  }

  for (const u of BENCH_USERS) {
    const open = await list('POS Opening Entry', ['name'], [['user', '=', u.email], ['status', '=', 'Open'], ['docstatus', '=', 1]]);
    if (open.length) continue;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const entry = await call('POST', '/api/resource/POS%20Opening%20Entry', {
      pos_profile: POS_PROFILE,
      company: company.name,
      user: u.email,
      period_start_date: now,
      posting_date: now.slice(0, 10),
      balance_details: [{ mode_of_payment: 'Cash', opening_amount: 0 }],
      docstatus: 1,
    });
    console.log(`[seed] POS Opening Entry ${entry.data.name} opened for ${u.email}`);
  }
}

const WEB_PAGE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&family=Tajawal:wght@400;500;700&display=block');
.h2f-bench { font-family: Tajawal, 'Noto Sans Arabic', sans-serif; color: #1f2937; }
.h2f-bench h1, .h2f-bench h2 { font-family: Cairo, Tajawal, sans-serif; }
.h2f-hero { padding: 64px 32px; border-radius: 16px; color: #fff;
  background: linear-gradient(120deg, #0f766e, #155e75); }
.h2f-hero h1, .h2f-hero p { color: #fff; }
.h2f-hero p { font-size: 20px; max-width: 640px; }
.h2f-btn { display: inline-block; padding: 12px 24px; border-radius: 8px; background: #f59e0b; color: #111; font-weight: 700; }
.h2f-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; margin: 40px 0; }
.h2f-card { padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.06); }
.h2f-card h3 { margin-top: 0; }
.h2f-price { display: flex; gap: 16px; flex-wrap: wrap; }
.h2f-price > div { flex: 1 1 200px; padding: 24px; border-radius: 12px; background: #f8fafc; border-top: 4px solid #0f766e; }
.h2f-price strong { font-size: 32px; }
`;

const WEB_PAGES = [
  {
    route: 'h2f-benchmark-en',
    title: 'H2F Benchmark Page (EN)',
    html: `<div class="h2f-bench" dir="ltr" lang="en">
<section class="h2f-hero"><h1>Design from what is already live</h1>
<p>Capture any page in Chrome and get editable Figma layers in under a minute.</p>
<a class="h2f-btn" href="#pricing">Start free</a></section>
<div class="h2f-grid">
<div class="h2f-card"><h3>Pixel-accurate</h3><p>Boxes land within two pixels of the source.</p></div>
<div class="h2f-card"><h3>Editable text</h3><p>Every heading and paragraph stays real text.</p></div>
<div class="h2f-card"><h3>Private by design</h3><p>Nothing leaves your machine.</p></div>
</div>
<h2 id="pricing">Pricing</h2>
<div class="h2f-price"><div><h3>Starter</h3><strong>$0</strong><p>Single pages</p></div>
<div><h3>Team</h3><strong>$12</strong><p>Per seat, per month</p></div>
<div><h3>Enterprise</h3><strong>Contact us</strong><p>SSO and audit logs</p></div></div>
</div>`,
  },
  {
    route: 'h2f-benchmark-ar',
    title: 'صفحة اختبار H2F (AR)',
    html: `<div class="h2f-bench" dir="rtl" lang="ar">
<section class="h2f-hero"><h1>صمّم انطلاقاً مما هو منشور فعلاً</h1>
<p>التقط أي صفحة في كروم واحصل على طبقات Figma قابلة للتعديل خلال أقل من دقيقة.</p>
<a class="h2f-btn" href="#pricing">ابدأ مجاناً</a></section>
<div class="h2f-grid">
<div class="h2f-card"><h3>دقة عالية</h3><p>تقع العناصر ضمن بكسلين من المصدر.</p></div>
<div class="h2f-card"><h3>نص قابل للتعديل</h3><p>تبقى العناوين والفقرات نصوصاً حقيقية، مثل فاتورة INV-2026-00042.</p></div>
<div class="h2f-card"><h3>خصوصية تامة</h3><p>لا يغادر أي شيء جهازك.</p></div>
</div>
<h2 id="pricing">الأسعار</h2>
<div class="h2f-price"><div><h3>المبتدئ</h3><strong>٠ د.أ</strong><p>صفحات مفردة</p></div>
<div><h3>الفريق</h3><strong>١٢ د.أ</strong><p>لكل مستخدم شهرياً</p></div>
<div><h3>المؤسسات</h3><strong>تواصل معنا</strong><p>دخول موحّد (SSO) وسجلات تدقيق</p></div></div>
</div>`,
  },
];

async function ensureWebPages() {
  for (const p of WEB_PAGES) {
    const existing = await list('Web Page', ['name'], [['route', '=', p.route]]);
    const doc = {
      title: p.title,
      route: p.route,
      published: 1,
      content_type: 'HTML',
      main_section_html: p.html,
      insert_style: 1,
      css: WEB_PAGE_CSS,
      full_width: 0,
    };
    if (existing.length) {
      await call('PUT', `/api/resource/Web%20Page/${enc(existing[0].name)}`, doc);
      console.log(`[seed] Web Page /${p.route} updated`);
    } else {
      await call('POST', '/api/resource/Web%20Page', doc);
      console.log(`[seed] Web Page /${p.route} created`);
    }
  }
}

/**
 * Demo data has ~10 items, which fit in the POS item grid without scrolling. The POS benchmark exists to
 * exercise inner-scroll-container expansion (EXT-C-5/6), so add enough items to overflow the grid.
 */
const EXTRA_ITEMS = 40;
async function ensurePosItems() {
  const prefix = 'H2F-BENCH-';
  const existing = await list('Item', ['name'], [['name', 'like', `${prefix}%`]]);
  if (existing.length >= EXTRA_ITEMS) {
    console.log(`[seed] ${existing.length} extra POS items exist`);
    return;
  }
  const have = new Set(existing.map((i) => i.name));
  const [group] = await list('Item Group', ['name'], [['is_group', '=', 0]]);
  let created = 0;
  for (let n = 1; n <= EXTRA_ITEMS; n++) {
    const code = `${prefix}${String(n).padStart(3, '0')}`;
    if (have.has(code)) continue;
    await call('POST', '/api/resource/Item', {
      item_code: code,
      item_name: n % 2 ? `Benchmark Item ${n}` : `صنف اختبار ${n}`,
      item_group: group.name,
      stock_uom: 'Nos',
      is_stock_item: 0,
      include_item_in_manufacturing: 0,
    });
    await call('POST', '/api/resource/Item%20Price', {
      item_code: code,
      price_list: 'Standard Selling',
      price_list_rate: 5 + n * 3,
    });
    created++;
  }
  console.log(`[seed] ${created} extra POS items created`);
}

async function main() {
  console.log(`[seed] site: ${BASE}`);
  await waitForSite();
  await call('POST', '/api/method/login', { usr: 'Administrator', pwd: 'admin' });
  console.log('[seed] logged in as Administrator');

  if (await setupWizardDone()) {
    console.log('[seed] setup wizard already complete, skipping');
  } else {
    console.log('[seed] running setup wizard with demo data (this can take a few minutes)…');
    await runSetupWizard();
    console.log(`[seed] setup wizard complete: ${await setupWizardDone()}`);
  }

  for (const u of BENCH_USERS) {
    console.log(`[seed] user ${u.email} (${u.language}): ${await ensureUser(u)}`);
  }
  await ensurePos();
  await ensurePosItems();
  await ensureWebPages();
  console.log('[seed] done. Log in at', `${BASE}/login`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[seed] FAILED:', e.message);
    process.exit(1);
  });
}
