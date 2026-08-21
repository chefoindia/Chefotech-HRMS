# PRODUCT.md — GRAV Employee App

## What it is

The employee-facing mobile app for **Grav Clothing Pvt. Ltd.** (`com.grav.crm`).
One React Native codebase shipping to Android and iOS. It replaces
`grav-crm-web`, which was a duplicate of the same six screens and is being
retired.

It is **not** the CMS. `grav-cms` remains a separate Next.js app for department
tooling (HR, CEO, accountant, CAD, production). Both talk to the same
`grav-cms-backend`.

## Who uses it

Factory and office staff at a clothing manufacturer in India. Not desk-bound,
not necessarily technical, on mid-range Android phones, frequently on mobile
data rather than office Wi-Fi. Many are on the floor rather than at a computer,
which is the whole reason the app exists: the CMS assumes a desk.

**The scene:** a phone taken out of a pocket, one-handed, in daylight, for
under a minute — to check in, see a leave balance, or check whether a payslip
landed. Held at arm's length in a bright room, often with a screen protector.
This forces light-first: a dark-only product fights the room it is used in.

## What it does

| Surface | Job |
|---|---|
| Home | Today at a glance; check in / out |
| Work | Tasks, leave, overtime, attendance |
| Standings | Daily/weekly/monthly recognition |
| Pay | Payslips and salary history |
| Profile | Details, documents, settings |

## Product truth

- **Attendance is biometric-first.** Punches come from TeamOffice devices and
  sync to the backend; the app reports and requests, it is not the source of
  record. HR's decision (`hrFinalStatus`) always overrides the device
  prediction.
- **Approvals are two-step.** Leave and overtime go manager → HR. A request is
  in someone else's hands most of its life, so *status legibility* matters more
  than submission speed.
- **Money is sensitive.** Payslips and salary are in here. Salary fields are
  encrypted at rest server-side. This is why App Lock exists.
- **Standings rank on positive signal only** — days present, days on time.
  Never absences, leave reasons, or SOP deductions. Ranking people by their
  absences would leak medical and personal circumstances across the company.
- **Dates are IST.** All attendance and SOP logic is India Standard Time.

## Constraints

- **Core React Native only.** No new native modules until the next build:
  no `expo-blur`, no `react-native-reanimated`, no `expo-linear-gradient`.
  A dependency-free `Gradient` lives at `src/components/ui/Gradient.js`.
- **The GRAV logo is fixed.** `assets/*.png` are correct and must not be
  regenerated or restyled.
- **Ionicons only.** The other 19 icon families were removed to cut ~3.9 MB.
- Android `arm64-v8a` for release; `compileSdk 36`, `targetSdk 35`.

## Brand commitments

- The GRAV mark, as supplied.
- Company name renders "Grav Clothing Pvt. Ltd."
- English only today; Odia/Hindi are plausible later, so layouts must tolerate
  longer strings.

## Assumptions (unverified — flagged per init)

- No brand palette or typeface has been supplied; colour and type are open.
- Employee headcount is assumed to be in the hundreds, so Standings is a real
  ranked list rather than a handful of rows.
