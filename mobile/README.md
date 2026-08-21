# Chefotech HRMS — employee app

The employee-facing mobile app: check in and out, see your attendance, apply for
leave, read payslips and documents. React Native via Expo, one codebase for
Android and iOS.

It talks to the same API as the web portal (`backend/`), using the same
employee-scoped endpoints the web `/me` pages use.

## Running it

```bash
cd mobile
npm install
npm start
```

Then scan the QR code with **Expo Go** on your phone, or press `a` for an
Android emulator.

The backend must be running (`cd backend && npm run dev`). The app works out
where it is automatically:

| Where you run it | API it uses |
|---|---|
| Physical phone on the same Wi-Fi | Your laptop's LAN address, port 5001 |
| Android emulator | `http://10.0.2.2:5001` |
| iOS simulator | `http://localhost:5001` |

To point it somewhere else, set `EXPO_PUBLIC_API_URL`, or use **Connection
settings** on the sign-in screen — which is also how a self-hosted customer
points the app at their own server.

> If a physical phone cannot reach the API, it is almost always Windows
> Firewall blocking port 5001 on the private network, not the app.

## Building for the stores

Builds run in the cloud through EAS, so **you do not need a Mac to build for
iOS** — which matters here, since this project is developed on Windows.

```bash
npm install -g eas-cli
eas login
eas build:configure
```

Then:

```bash
eas build --platform android --profile preview     # APK you can sideload
eas build --platform android --profile production  # AAB for Play Store
eas build --platform ios --profile production      # needs a paid Apple account
```

Before the first production build, set the real API URL in `eas.json` —
`https://api.chefotech.com` is a placeholder.

### iOS, when you are ready

The app is already configured for it: bundle identifier `com.chefotech.hrms`,
tablet support, and every permission string Apple requires written in plain
language (App Review rejects vague ones). Nothing needs to change in the code.

What you will need:

1. An Apple Developer Program membership (99 USD/year).
2. `eas build --platform ios --profile production` — EAS handles certificates
   and provisioning.
3. `eas submit --platform ios`.

`ITSAppUsesNonExemptEncryption` is already declared `false`, which is correct
while the app only uses HTTPS. If you later add your own encryption, that
declaration has to change.

## What is in here

```
app/                      Screens. expo-router: the file tree IS the routes.
  index.tsx               Decides where a launch lands
  intro.tsx               First-run carousel
  (auth)/                 Sign in, forgot password
  (app)/                  The tab bar and everything behind it
src/
  api/client.ts           Fetch, tokens, refresh, timeouts
  api/hooks.ts            Typed bindings to the employee endpoints
  auth/session.tsx        Who is signed in
  auth/AppLockGate.tsx    Optional biometric lock
  components/             UI kit, toasts, sheets
  help/                   Guided tours and in-app answers
  theme/                  Design tokens, matching the web app
```

## Decisions worth knowing

**Tokens live in the OS keychain** (`expo-secure-store`), never AsyncStorage.
AsyncStorage is plain text on disk and readable on a rooted device; these
tokens unlock somebody's salary history.

**Check-in direction comes from the server.** The app asks
`GET /attendance/me/today` and uses whatever it says. A phone that has been
asleep may be several punches behind, and trusting local state is how a day
ends up with two check-ins and no check-out.

**Location is requested at the first punch, not at launch.** A permission
dialog before the user has seen why it is needed is the most common reason
people deny it permanently. Denial does not block the punch either — whether a
location is *required* is the employer's policy, enforced by the server.

**The leave preview comes from the API.** The day count is computed by the same
engine that will perform the real deduction, not reimplemented on the phone.
Two implementations of the sandwich rule would eventually disagree, and the one
on the phone would be the one nobody could debug.

**One refresh at a time.** A phone waking from sleep fires every screen's query
at once. The backend rotates refresh tokens and treats reuse as theft, so
concurrent refreshes would invalidate the family and sign the user out — a bug
that only reproduces on a real device returning from background.

## Not yet done

- **Push notifications are not wired up.** The permission flow and the settings
  toggle exist, but nothing registers a device token with the backend and the
  backend has no push transport — notifications are in-app and email today.
- **No offline queue for check-ins.** Punching while offline fails with a clear
  message rather than being queued. Queuing a *time-stamped* attendance event
  on the device raises a real question about whether the employer can trust the
  timestamp, and that is a policy decision rather than a coding one.
- **Not yet run on a device.** It type-checks and bundles for both platforms,
  and every endpoint it calls was verified against the running API, but nobody
  has watched it render on real hardware.
