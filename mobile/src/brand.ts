import Constants from "expo-constants";

/**
 * Who this app says it is.
 *
 * The name was previously typed out at eleven separate call sites — the app
 * lock prompt, two permission-denied alerts, a help article, the tour's
 * welcome step, the More tab's footer, the support email subject — and had
 * already drifted into three spellings: "Chefotech HRMS", "Chefotech", and
 * "ChefotechHRMS" in the User-Agent. Nothing catches that: each string reads
 * fine on its own screen, and only someone opening all eleven would notice
 * the product appears to have three names.
 *
 * This mirrors frontend/content/company.ts, which does the same job for the
 * web app. The two files are the only places either half of the product
 * names itself.
 *
 * `name` and `version` are read from app.json through expo-constants rather
 * than repeated here. app.json is what actually becomes the launcher label
 * and the store listing, so anything that disagrees with it is wrong by
 * definition — and the version in particular was hardcoded as "1.0.0" in two
 * screens that would have kept claiming 1.0.0 after the first release.
 */

const expo = Constants.expoConfig;

export const BRAND = {
  /** The product, as an employee should ever see it written. */
  name: (expo?.name as string) ?? "Chefotech HRMS",

  /** The company behind it. Use where the sentence is about the vendor. */
  company: "Chefotech",

  /** Shown wherever the app reports its own version. */
  version: (expo?.version as string) ?? "1.0.0",

  /** Where "report a problem" goes. Mirrors COMPANY.email.support on the web. */
  supportEmail: "support@chefotech.com",

  /**
   * Sent on every request so the API can tell the app apart from the browser.
   * Spaces are not valid in a User-Agent product token, so the name is
   * stripped rather than written out a second time by hand.
   */
  get userAgentProduct() {
    return this.name.replace(/\s+/g, "");
  },
} as const;

/** "Chefotech HRMS 1.0.0" — the About line, in one place. */
export function versionLabel() {
  return `${BRAND.name} · v${BRAND.version}`;
}
