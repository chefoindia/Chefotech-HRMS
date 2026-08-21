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
| Backend API | Works. 178 tests pass. |
| Web portal + marketing site | Works. Builds, 104 pages, all routes serve. |
| Employee mobile app | Type-checks and bundles for Android and iOS. **Never run on a device.** |
| Known security advisories | None. |
| Version control | Git initialised, secrets excluded. |

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

### Push notifications

The mobile app has the permission flow and a settings toggle, but nothing
registers a device token and the backend has no push transport. Notifications
today are in-app and email. The switch is honest about what it does; it just
does less than a customer might assume from the word "notifications".

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
