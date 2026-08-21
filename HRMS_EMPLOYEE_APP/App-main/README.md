# GRAV CRM - Mobile Application

React Native (Expo) mobile application for the GRAV Employee Management System. Works on both **Android** and **iOS**.

## Features

- **Login**: Phone number + password authentication (cookie-based, same backend)
- **Dashboard**: Today's attendance status, leave statistics, quick actions
- **Leave Management**: Apply for leave (CL/SL/PL), half-day support, view applications, manager approvals, add leave on behalf
- **Attendance**: Monthly attendance calendar with day detail, punch times, late tracking
- **Salary / Payslips**: View payslip history, download/share payslips as PDF
- **Tasks / Interviews**: View scheduled interviews, submit feedback with ratings
- **Profile**: Employee details, monthly attendance, logout

## Prerequisites

- **Node.js** >= 18
- **npm** or **yarn**
- **Expo CLI**: `npm install -g expo-cli` (optional, npx works too)
- **EAS CLI** (for building): `npm install -g eas-cli`
- Your backend server running (same Express/MongoDB backend as the web app)

## Quick Start

```bash
# 1. Install dependencies
cd GravCRM
npm install

# 2. Configure API URL
#    Edit src/lib/api.js and set your backend URL:
#    - For Android emulator: http://10.0.2.2:5000/api/employee
#    - For iOS simulator: http://localhost:5000/api/employee
#    - For physical device: http://YOUR_IP:5000/api/employee
#    - For production: https://your-api.example.com/api/employee

# 3. Start the development server
npx expo start

# 4. Run on device/simulator
#    - Press 'a' for Android emulator
#    - Press 'i' for iOS simulator
#    - Scan QR code with Expo Go app on your phone
```

## API Configuration

The app connects to the **exact same backend** as the web app. All endpoints are identical:

| Feature | Endpoint |
|---------|----------|
| Login | `POST /api/employee/auth/login` |
| Verify | `GET /api/employee/auth/verify` |
| Profile | `GET /api/employee/profile` |
| Attendance Today | `GET /api/employee/attendance/today` |
| Attendance Monthly | `GET /api/employee/attendance/monthly` |
| Leave Applications | `GET/POST /api/employee/leave-applications` |
| Leave Balance | `GET /api/employee/leave-applications/balance` |
| Manager Pending | `GET /api/employee/leave-applications/manager/pending` |
| Manager Approve | `PATCH /api/employee/leave-applications/manager/:id/approve` |
| Manager Reject | `PATCH /api/employee/leave-applications/manager/:id/reject` |
| Payslip History | `GET /api/employee/payslip/:id/history` |
| Payslip Detail | `GET /api/employee/payslip/:id?month=M&year=Y` |
| My Tasks | `GET /api/employee/tasks/my-tasks` |
| Task Detail | `GET /api/employee/tasks/task/:id` |
| Submit Feedback | `POST /api/employee/tasks/:id/feedback` |

**Important**: The backend uses `employee_token` cookie for authentication. The mobile app sends this token via the `Cookie` header on every request.

## Building for Production

### Android APK (for testing)

```bash
# Login to Expo/EAS
eas login

# Build APK
eas build --platform android --profile preview
```

### Android AAB (for Play Store)

```bash
eas build --platform android --profile production
```

### iOS (for App Store)

```bash
eas build --platform ios --profile production
```

## Project Structure

```
GravCRM/
├── App.js                          # Entry point
├── app.json                        # Expo config
├── eas.json                        # EAS Build config
├── package.json
├── babel.config.js
├── assets/                         # App icons, splash screen
│   ├── icon.png
│   ├── adaptive-icon.png
│   ├── splash.png
│   └── favicon.png
└── src/
    ├── navigation/
    │   └── AppNavigator.js         # Tab + Stack navigation
    ├── screens/
    │   ├── LoginScreen.js          # Phone login
    │   ├── DashboardScreen.js      # Home dashboard
    │   ├── LeaveScreen.js          # Leave management
    │   ├── ProfileScreen.js        # Profile + attendance calendar
    │   ├── SalaryScreen.js         # Payslip viewer
    │   ├── TasksScreen.js          # Interview list
    │   ├── TaskDetailScreen.js     # Interview detail + feedback
    │   └── AttendanceScreen.js     # Standalone attendance (alias)
    ├── components/
    │   ├── SharedUI.js             # Reusable UI components
    │   └── TabIcon.js              # Tab bar icons
    ├── context/
    │   └── AuthContext.js          # Auth state + API helper
    ├── lib/
    │   └── api.js                  # API configuration
    └── constants/
        └── colors.js               # Colors, status maps, constants
```

## Backend Compatibility

This mobile app is a **drop-in replacement** for the Next.js web app. It uses:
- Same API endpoints (no backend changes needed)
- Same cookie-based authentication (`employee_token`)
- Same data models and response formats
- Same leave management workflow (Manager → HR approval)
- Same attendance data from TimesOffice sync

## Customization

### Change App Name/Icon
Edit `app.json`:
- `expo.name` — display name
- `expo.icon` — replace `assets/icon.png` (1024x1024)
- `expo.splash.image` — replace `assets/splash.png`
- `expo.android.package` — Android package name
- `expo.ios.bundleIdentifier` — iOS bundle ID

### Change API URL
Edit `src/lib/api.js`:
```js
const BASE_URL = "https://your-production-api.com/api/employee";
```

### Add Push Notifications
The app is ready for FCM integration. Add `expo-notifications` and configure in `app.json`.

## Troubleshooting

### "Network request failed" on Android emulator
Use `10.0.2.2` instead of `localhost` in API URL.

### Cookie not persisting
React Native's `fetch` handles cookies differently. The app sends the token via `Cookie` header manually. Make sure your backend's CORS config allows the `Cookie` header.

### Build fails
Run `npx expo doctor` to check for issues, then `npx expo install --fix` to auto-fix dependency versions.
