// Falls back to production so release builds are correct even without a .env.
const PRODUCTION_URL = "https://backend.grav.in";

// Root URL without any prefix (used for endpoints like /api/app/version)
export const ROOT_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || PRODUCTION_URL
).replace(/\/+$/, "");

const BASE_URL = `${ROOT_URL}/api/employee`;
const HR_BASE_URL = `${ROOT_URL}/api/hr`;

export const API_CONFIG = {
  BASE_URL,
  HR_BASE_URL,
  endpoints: {
    auth: {
      login: "/auth/login",
      logout: "/auth/logout",
      verify: "/auth/verify",
    },
    profile: {
      get: "/profile",
      update: "/profile",
      changePassword: "/change-password",
    },
    leave: {
      list: "/leave-applications",
      balance: "/leave-applications/balance",
      config: "/leave-applications/config",
      calendar: "/leave-applications/calendar",
      managerPending: "/leave-applications/manager/pending",
      managerMyTeam: "/leave-applications/manager/my-team",
    },
    // Attendance corrections. The manager chain is primary → secondary, and the
    // secondary's approval is FINAL — it writes the attendance row. There is no
    // /regularizations/manager/my-team on purpose: the manager gate is the leave
    // module's my-team, so a manager is a manager everywhere in the app.
    regularization: {
      list: "/regularizations",
      create: "/regularizations",
      cancel: (id) => `/regularizations/${id}/cancel`,
      managerPending: "/regularizations/manager/pending",
      managerHistory: "/regularizations/manager/history",
      managerApprove: (id) => `/regularizations/manager/${id}/approve`,
      managerReject: (id) => `/regularizations/manager/${id}/reject`,
    },
    // HR-issued letters. Two independent states live behind this: HR GENERATES
    // a document, and HR separately RELEASES it. Nothing unreleased is ever in
    // a response here — not in the list, not by guessing an id. See
    // routes/Employee_Routes/documents.js. There is deliberately no HR path in
    // this block: the app holds an employee token, and reaching an /api/hr/*
    // route from here would surface the existence of a hidden letter.
    documents: {
      list: "/documents",
      types: "/documents/types",
      request: "/documents/requests",
      cancel: (id) => `/documents/${id}/cancel`,
      file: (id) => `/documents/${id}/file`,
    },
    attendance: {
      today: "/attendance/today",
      monthly: "/attendance/monthly",
      syncToday: "/attendance/sync-today",
    },
    tasks: {
      myTasks: "/tasks/my-tasks",
      detail: (id) => `/tasks/task/${id}`,
      feedback: (id) => `/tasks/${id}/feedback`,
    },
    // The caller's own performance. Scoped to the auth token server-side —
    // there is deliberately no employeeId parameter (see the backend route).
    performance: {
      me: "/performance",
    },
    payslip: {
      history: (id) => `/payslip/${id}/history`,
      get: (id) => `/payslip/${id}`,
    },
  },
};

export const getApiUrl = (endpoint) => `${BASE_URL}${endpoint}`;
export const getHrApiUrl = (endpoint) => `${HR_BASE_URL}${endpoint}`;

export default API_CONFIG;
