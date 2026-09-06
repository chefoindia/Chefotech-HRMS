/**
 * Web routes → app screens.
 *
 * Notifications carry the WEB route ("/me/leave") because one backend serves
 * both clients. The mapping lives here, once, so a tap on a push notification
 * and a tap on a row in the notifications screen land in the same place.
 */

type AppRoute =
  | "/(app)"
  | "/(app)/leave"
  | "/(app)/attendance"
  | "/(app)/payslips"
  | "/(app)/documents"
  | "/(app)/notifications"
  | "/(app)/profile"
  | "/(app)/holidays"
  | "/(app)/tickets"
  | "/(app)/expenses"
  | "/(app)/assets"
  | "/(app)/requests"
  | "/(app)/loans"
  | "/(app)/surveys"
  | "/(app)/performance"
  | "/(app)/onboarding"
  | "/(app)/directory"
  | "/(app)/security";

export function routeForActionUrl(actionUrl?: string | null): AppRoute {
  const url = String(actionUrl || "");
  if (url.includes("/requests")) return "/(app)/requests";
  if (url.includes("/loans")) return "/(app)/loans";
  if (url.includes("/surveys")) return "/(app)/surveys";
  if (url.includes("/onboarding")) return "/(app)/onboarding";
  if (url.includes("/directory")) return "/(app)/directory";
  if (url.includes("/security")) return "/(app)/security";
  if (url.includes("/performance")) return "/(app)/performance";
  if (url.includes("/leave")) return "/(app)/leave";
  if (url.includes("/attendance")) return "/(app)/attendance";
  if (url.includes("/payslip")) return "/(app)/payslips";
  if (url.includes("/documents")) return "/(app)/documents";
  if (url.includes("/profile")) return "/(app)/profile";
  if (url.includes("/holiday")) return "/(app)/holidays";
  if (url.includes("/tickets")) return "/(app)/tickets";
  if (url.includes("/expenses")) return "/(app)/expenses";
  if (url.includes("/assets")) return "/(app)/assets";
  if (url.includes("/notifications") || url.includes("/approvals")) return "/(app)/notifications";
  return "/(app)";
}
