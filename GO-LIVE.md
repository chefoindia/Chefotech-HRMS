# Go-live checklist

What is finished, and what genuinely has to happen before real employees'
salary data goes into this system.

Written to be honest rather than reassuring: everything in **Must do** is a
blocker, and the reason is stated so you can judge it yourself rather than
taking my word for it.

---

## Where it stands

| | Status |
|---|---|
| Backend API | Works. 376 tests pass (`cd backend && npm test`), including the new integration suites for documents, sheets, security, requests, help desk, expenses, assets, loans, onboarding, exits, scheduled sheets, data export, API keys, webhooks, surveys and performance. |
| Web portal + marketing site | Works. Type-checks clean (`cd frontend && npx tsc --noEmit`). |
| Employee mobile app | Type-checks clean and at feature parity with the employee web portal, screen for screen (see README, "one feature set, two shells"). A signed release APK is built by `mobile/scripts/build-android.js` and published at https://hrms.chefo.in/download. **Still never run on a physical device by a person — install the APK and walk every screen before handing it to employees.** |
| Hosting | API on Render (https://chefotech-hrms.onrender.com), web on Vercel behind https://hrms.chefo.in, both deploying from `master`. |
| Known security advisories | None. |
| Version control | Git initialised, secrets excluded (`backend/.env`, `.storage/`, keystores). |

### What the September 2026 QC pass added

Everything below is built, wired into permissions, notifications, audit and
the scheduler, and covered by an integration test. The configuration each one
needs is in **Must do** item 7.

- **Mail and notifications** — every event goes through one pipeline
  (in-app, email, mobile push, web push) with per-organization rules, a mail
  log with resend, a daily digest, calendar-driven reminders, and email
  attachments (used by scheduled sheets and the data export).
- **Documents people design themselves** — templates with blocks, versions,
  numbering, verification QR codes and a public verify page; starter
  templates for offer, appointment, confirmation, promotion, transfer,
  relieving, experience, warning, increment, NOC, address proof, bonafide,
  full-and-final settlement; bulk generation to a zip; employee uploads with
  review, expiry and acknowledgement; company documents; document requests.
- **Sheets people design themselves** — column-by-column spreadsheets over
  employees, attendance (daily, monthly, muster), leave, payroll registers,
  payslips and joiners/leavers, with formulas, grouping, totals, XLSX/CSV/PDF
  output, and **schedules** that email a sheet to anyone on a daily, weekly or
  monthly rhythm.
- **Security** — TOTP two-factor with recovery codes, enforced for
  administrators when the organization says so; IP allow-lists with a
  self-lockout guard; password policy and expiry; idle timeout; session list
  and "sign out everywhere"; admin session revocation and 2FA reset.
- **Employee requests hub** — work from home, comp-off, encashment, shift
  swap, letters, profile changes, advances — each with its own effect once
  approved, optionally routed through the workflow engine.
- **Help desk** with SLAs, auto-assignment, internal notes and ratings.
- **Expenses, assets, loans** — all three reach payroll through one
  "payroll inputs" mechanism, verified by a real payroll run in the tests.
- **Onboarding and exits** — checklists that start themselves, tasks that
  complete themselves, clearance, settlement, relieving and experience
  letters on completion.
- **Employee movements** — promotions, transfers and confirmations that
  apply on their effective date, with the letter generated automatically.
- **Directory, duplicates, bulk actions, holiday calendar feed (ICS).**
- **API keys and signed webhooks** for other systems, with a settings page.
- **Organization data export** — a zip of every collection as JSON.
- **Surveys** (anonymous by default) and **performance** (goals, review
  cycles with self and manager reviews, calibration summary).

---

## Must do before real data

### 1. Fill in the company identity — `frontend/content/company.ts`

Every legal page reads from this file and it still contains
`[REGISTERED OFFICE ADDRESS]`, `[COMPANY REGISTRATION NUMBER]` and
`[GRIEVANCE OFFICER NAME]`.

A published privacy policy naming `[CITY]` is worse than not publishing one:
it is evidence of an unreviewed document. India's DPDP Act also requires a
**named** grievance officer with published contact details — a generic inbox
does not satisfy it.

### 2. Have a lawyer read the legal pages

`/legal` has eight documents — terms, privacy, cookies, DPA, sub-processors,
acceptable use, SLA, refunds. They are complete, and they describe this system
accurately rather than being a generic template.

They have not been reviewed by a lawyer, and I am not one. You asked that no
authority could raise a complaint; that outcome depends on counsel checking
these against the jurisdictions you sell into.

Pay particular attention to the **Sub-processors** page — it still says
`TODO: replace each entry with the named legal entity` for the hosting
provider and region, which a corporate customer's procurement team will ask
for by name.

### 3. Set real production secrets

The backend refuses to start in production without `MONGODB_URI`,
`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — that guard is already in place
and tested.

Generate fresh secrets for production. **Do not reuse the development ones in
`backend/.env`** — they have existed in plain text on a development machine,
and the JWT signing secret alone is enough to mint a valid token for any user
in any tenant.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Also set `PUBLIC_API_URL` and `PUBLIC_APP_URL` to real hostnames, and
`CORS_ORIGINS` to your real frontend origin. They currently point at
`localhost`.

### 4. Remove the demo tenant

`scripts/seedDemoTenant.js` created **BrightWeave Apparel** with 30 fictional
employees and simulated punches, and `hr@brightweave.demo` with a password
that is written in the seed script and in this conversation.

That account must not exist on a production database.

### 5. Decide on file storage

Today `STORAGE_DRIVER=local`, so uploads are written to `backend/.storage/`
on the API server's own disk. That does not survive a container restart and
does not work across more than one instance.

- **Documents** → Google Drive: add a service-account key and set
  `GOOGLE_SERVICE_ACCOUNT_KEY` / `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
- **Images** → Cloudinary: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
  `CLOUDINARY_API_SECRET`. These are currently blank, so images fall back to
  the local disk automatically rather than failing — which is why uploads
  appear to work.

### 6. Run the mobile app on a real device

It type-checks and bundles for both platforms, and every endpoint it calls was
verified against the running API. But nobody has watched it render.

Expect layout adjustments — that is normal for a first device run, not a sign
something is wrong.

```bash
cd mobile && npm start      # then scan the QR with Expo Go
```

### 7. Configure what the new modules depend on

All of these have safe defaults, but the feature is silently reduced until
the value is set. Each is documented in `backend/.env.example`.

| Setting | Without it |
|---|---|
| `MAIL_ENABLED=true` + `BREVO_API_KEY` (or SMTP) | No email at all. In production the server refuses to pretend, and the mail log shows the failure. |
| `MAIL_REPLY_TO` | Replies to system mail go to the sender address, which nobody reads. |
| `JOBS_ENABLED=true` | Nothing scheduled runs: no attendance finalisation, no reminders, no scheduled sheets, no webhook deliveries, no data exports, no survey auto-close. Set it on exactly one instance, or on all if the queue is shared (it is safe either way; jobs are claimed atomically). |
| `EXPO_ACCESS_TOKEN` | Mobile push still works through Expo's public endpoint, but is rate-limited more tightly. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | No browser push. Generate once: `npx web-push generate-vapid-keys`. |
| `PUBLIC_APP_URL` | Verification QR codes on generated documents point at localhost. |
| An organization's **Security** settings | Two-factor is optional, no IP restrictions, no password expiry. Enforce 2FA for administrators before real payroll data goes in. |

Rotate any secret that was ever pasted into a chat or a ticket, including the
development `BREVO_API_KEY` and Firebase key in `backend/.env`.

---

## Should do before selling

### Deployment configuration

There is no Dockerfile, no CI, and no hosting configuration. The app runs from
`npm start` on a machine you set up by hand. That is fine for a pilot and not
fine for a product with an SLA — the SLA page promises 99.9% and a documented
recovery objective, which needs infrastructure behind it.

### Backups

The SLA commits to daily backups, a 24-hour recovery point and tested
restores. Nothing currently performs a backup. Either build it or amend the
SLA before a customer signs it.

### Push notifications — now built, not yet seen on a device

The mobile app registers its Expo push token on sign-in and the backend
delivers through Expo's push service with receipt checking; the web portal
registers a browser subscription and the backend delivers through Web Push
(VAPID). Both are tested against the transport's contract, not against a real
phone or browser. Send yourself one from **Settings → Notifications → Send a
test** on a real device before telling a customer it works.

### Webhook receivers and API keys are the customer's responsibility

A leaked API key carries only the permissions it was created with and can be
revoked in one click, and webhook secrets can be rotated. But there is no
outbound IP allow-list and no per-key rate limit yet. If a customer asks for
either, that is a day's work, not a redesign.

---

## Decisions already made, so they are not re-litigated

**Two moderate `npm audit` findings remain in the backend** (`exceljs` →
`uuid`). They are not reachable: the advisory requires calling uuid v3/v5/v6
with a `buf` argument, and exceljs calls `v4()` with none. The offered "fix"
is a major downgrade of exceljs that would break Excel export for no security
benefit. Left deliberately.

**Next.js was upgraded 15 → 16** to clear three HIGH advisories, even though
none was reachable — `next/image` is used only on our own committed logo.
"Not exploitable today" describes the current code; the next person to render
a tenant-uploaded avatar through `next/image` would silently make it so.

**`mobile/ios/` and `mobile/android/` are gitignored.** They are generated
from `app.json` by `expo prebuild`. Committing them creates two sources of
truth for the same configuration, and they drift.

---

## Reference app

`HRMS_EMPLOYEE_APP/App-main/` is the GRAV employee app you provided as a
reference. I found it late — after the mobile app was already built — so the
app in `mobile/` was written from the API contract rather than from it.

The two differ in one way worth a decision: the reference organises its tabs
as **Home / Work / Standings / Pay / Profile**, where "Work" gathers tasks,
leave, overtime and attendance, and "Standings" is a recognition board ranked
on positive signal only. Ours uses **Home / Attendance / Leave / Payslips /
More**.

Neither is wrong. If you want the reference's structure, say so and I will
restructure — it is a navigation change, not a rewrite.
