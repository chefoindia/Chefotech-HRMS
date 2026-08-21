import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Download,
  Fingerprint,
  Globe,
  LockKeyhole,
  Palette,
  Plane,
  Smartphone,
  Wallet,
} from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";
import { APP_PLATFORMS, APP_FEATURES } from "@/content/marketing";
import { COMPANY } from "@/content/company";

export const metadata: Metadata = {
  title: "Get the app",
  description:
    "Chefotech HRMS for your team: a native Android app and a web app that works on any device, including iPhone. Check in, apply for leave and read payslips from a phone.",
  alternates: { canonical: "/download" },
};

const ICONS = {
  "finger-print": Fingerprint,
  calendar: CalendarDays,
  airplane: Plane,
  wallet: Wallet,
  "color-palette": Palette,
  "lock-closed": LockKeyhole,
} as const;

const PLATFORM_ICON = { web: Globe, android: Smartphone, ios: Smartphone } as const;

export default function DownloadPage() {
  return (
    <>
      <MarketingHeader />

      <main id="main">
        {/* Hero */}
        <section className="border-b bg-[var(--surface-muted)]">
          <div className="mx-auto max-w-4xl px-5 py-16 text-center lg:py-20">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12.5px] font-medium text-brand-700">
              <Smartphone className="h-3.5 w-3.5" aria-hidden />
              Employee app
            </span>
            <h1 className="mt-4 text-[34px] font-semibold leading-tight tracking-tight text-[var(--text)] lg:text-[42px]">
              Chefotech HRMS, in your team&apos;s pocket
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-[var(--text-muted)]">
              Check in, apply for leave and read a payslip in under a minute — one-handed, in
              daylight, on the phone your team already carries.
            </p>
          </div>
        </section>

        {/* Platform cards */}
        <section className="border-b bg-[var(--surface)]">
          <div className="mx-auto max-w-5xl px-5 py-14 lg:py-16">
            <div className="grid gap-4 sm:grid-cols-3">
              {APP_PLATFORMS.map((platform) => {
                const Icon = PLATFORM_ICON[platform.id as keyof typeof PLATFORM_ICON];
                const isPlanned = platform.status === "planned";
                return (
                  <div
                    key={platform.id}
                    className={`flex flex-col rounded-xl border p-6 ${
                      isPlanned ? "border-dashed bg-[var(--surface-muted)]" : "bg-[var(--surface)]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`grid h-9 w-9 place-items-center rounded-lg ${
                          isPlanned ? "bg-[var(--surface-sunken)]" : "bg-brand-50"
                        }`}
                      >
                        <Icon
                          className={`h-4.5 w-4.5 ${isPlanned ? "text-[var(--text-subtle)]" : "text-brand-600"}`}
                          aria-hidden
                        />
                      </span>
                      <span className="text-[15.5px] font-semibold text-[var(--text)]">
                        {platform.name}
                      </span>
                      {isPlanned && (
                        <span className="ml-auto rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-subtle)]">
                          Planned
                        </span>
                      )}
                    </div>
                    <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                      {platform.body}
                    </p>
                    <Link
                      href={platform.href}
                      {...(platform.id === "android" ? { download: true } : {})}
                      className={`mt-5 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-[14px] font-medium transition-colors ${
                        isPlanned
                          ? "border text-[var(--text)] hover:bg-[var(--surface-sunken)]"
                          : "bg-brand-600 text-white hover:bg-brand-700"
                      }`}
                    >
                      {!isPlanned && <Download className="h-4 w-4" aria-hidden />}
                      {platform.cta}
                    </Link>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-[var(--warning-border,#fed7aa)] bg-[var(--warning-bg,#fffbeb)] p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
              <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
                The Android download is installed directly rather than through the Play Store —
                your phone will ask you to confirm &ldquo;install from unknown sources&rdquo; the
                first time. That is expected for a direct install; it is the same app either way.
                This build is a development package for early testing, roughly 220&nbsp;MB —
                larger and slower to update than the Play Store release we will publish once the
                app has been through a proper store listing. On first launch, open{" "}
                <span className="font-medium text-[var(--text)]">Settings → Connection</span> in
                the app and confirm it points at your organisation&apos;s server address.
              </p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b bg-[var(--surface-muted)]">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[12.5px] font-semibold uppercase tracking-wider text-brand-600">
                What it does
              </p>
              <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-[var(--text)] lg:text-[30px]">
                Everything an employee needs, nothing they don&apos;t
              </h2>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {APP_FEATURES.map((feature) => {
                const Icon = ICONS[feature.icon];
                return (
                  <div key={feature.title} className="rounded-xl border bg-[var(--surface)] p-5">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50">
                      <Icon className="h-4.5 w-4.5 text-brand-600" aria-hidden />
                    </span>
                    <h3 className="mt-3 text-[14.5px] font-semibold text-[var(--text)]">
                      {feature.title}
                    </h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {feature.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Why not iOS yet */}
        <section className="border-b bg-[var(--surface)]">
          <div className="mx-auto max-w-3xl px-5 py-14 lg:py-16">
            <div className="rounded-xl border p-6">
              <h2 className="text-[16px] font-semibold text-[var(--text)]">
                Why isn&apos;t this on the App Store yet?
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
                Honestly: cost, not capability. The app is already built for iOS — same code,
                same features, already configured with the right bundle identifier and every
                permission description Apple requires. Publishing it needs an Apple Developer
                Program membership, which is a recurring fee independent of how many customers
                are using the platform. We&apos;d rather be upfront about the reason than leave a
                dead &ldquo;Coming soon&rdquo; badge with no explanation.
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
                In the meantime, the web app works fully in Safari on an iPhone — same sign-in,
                same check-in, same payslips.
              </p>
              <Link
                href="/contact"
                className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand-700 hover:underline"
              >
                Ask to be notified when it ships
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="bg-[var(--surface-muted)]">
          <div className="mx-auto max-w-4xl px-5 py-16 text-center lg:py-20">
            <h2 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">
              Already have an account?
            </h2>
            <p className="mt-2 text-[14.5px] text-[var(--text-muted)]">
              Sign in and the app finds your organisation automatically.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-5 text-[14px] font-medium text-white hover:bg-brand-700"
              >
                Open the web app
              </Link>
              <Link
                href="/contact"
                className="inline-flex h-10 items-center rounded-lg border bg-[var(--surface)] px-5 text-[14px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
              >
                Talk to us
              </Link>
            </div>
            <p className="mt-4 text-[12.5px] text-[var(--text-subtle)]">
              Questions about the app? Write to {COMPANY.email.support}.
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
