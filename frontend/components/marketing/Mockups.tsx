/**
 * Product mockups for the marketing site.
 *
 * Drawn in markup rather than shipped as screenshots, for three reasons: they
 * stay sharp at any density, they inherit the brand tokens so they change
 * colour with the rest of the site, and they cannot silently go stale the way
 * a PNG of a UI from six months ago does.
 *
 * Every figure shown is illustrative and deliberately generic — no real
 * employee names, no real salary figures, and nothing that implies a
 * particular customer.
 */

function Chrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_40px_-12px_rgb(15_23_42_/_0.18)]">
      {/* Window bar. Signals "this is the product" without pretending to be a
          screenshot of a specific browser. */}
      <div className="flex items-center gap-2 border-b bg-[var(--surface-muted)] px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
        </span>
        <span className="ml-1 truncate text-[11.5px] font-medium text-[var(--text-muted)]">
          {title}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Bar({ label, value, tone = "brand" }: { label: string; value: number; tone?: string }) {
  const colour =
    tone === "success"
      ? "var(--success)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "danger"
          ? "var(--danger)"
          : "var(--brand-500)";
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-16 shrink-0 text-[10.5px] text-[var(--text-muted)]">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${value}%`, background: colour }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--text-muted)]">
        {value}%
      </span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-[var(--surface-muted)] p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">{label}</p>
      <p
        className="mt-0.5 text-[16px] font-semibold tabular-nums"
        style={{ color: tone ?? "var(--text)" }}
      >
        {value}
      </p>
    </div>
  );
}

export function DashboardMockup() {
  return (
    <Chrome title="Dashboard">
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Present" value="184" tone="var(--success)" />
        <Stat label="On leave" value="12" />
        <Stat label="Late" value="7" tone="var(--warning)" />
        <Stat label="Absent" value="3" tone="var(--danger)" />
      </div>

      <div className="mt-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11.5px] font-medium text-[var(--text)]">Attendance this week</p>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">
            92% average
          </span>
        </div>
        <div className="mt-2.5 flex h-20 items-end gap-1.5" aria-hidden>
          {[72, 88, 95, 91, 84, 40, 22].map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-t"
              style={{
                height: `${height}%`,
                background: index > 4 ? "var(--surface-sunken)" : "var(--brand-500)",
                opacity: index > 4 ? 1 : 0.35 + (height / 100) * 0.65,
              }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5 text-[9.5px] text-[var(--text-subtle)]" aria-hidden>
          {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
            <span key={index} className="flex-1 text-center">
              {day}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-lg border p-3">
        <p className="text-[11.5px] font-medium text-[var(--text)]">Headcount by department</p>
        <Bar label="Production" value={82} />
        <Bar label="Quality" value={46} />
        <Bar label="Design" value={31} />
        <Bar label="Admin" value={18} />
      </div>
    </Chrome>
  );
}

export function AttendanceMockup() {
  const rows = [
    { day: "Mon", in: "08:56", out: "18:04", status: "Present", tone: "success" },
    { day: "Tue", in: "09:22", out: "18:10", status: "Late mark", tone: "warning" },
    { day: "Wed", in: "22:00", out: "06:02", status: "Night shift", tone: "brand" },
    { day: "Thu", in: "09:01", out: "13:30", status: "Half day", tone: "warning" },
    { day: "Fri", in: "08:58", out: "—", status: "Missing punch", tone: "danger" },
  ];
  const toneClass: Record<string, string> = {
    success: "bg-[var(--success-bg)] text-[var(--success)]",
    warning: "bg-[var(--warning-bg)] text-[var(--warning)]",
    danger: "bg-[var(--danger-bg)] text-[var(--danger)]",
    brand: "bg-brand-50 text-brand-700",
  };

  return (
    <Chrome title="Attendance · this week">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
            <th className="pb-1.5 font-medium">Day</th>
            <th className="pb-1.5 font-medium">In</th>
            <th className="pb-1.5 font-medium">Out</th>
            <th className="pb-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.day} className="text-[11.5px]">
              <td className="py-2 font-medium text-[var(--text)]">{row.day}</td>
              <td className="py-2 tabular-nums text-[var(--text-muted)]">{row.in}</td>
              <td className="py-2 tabular-nums text-[var(--text-muted)]">{row.out}</td>
              <td className="py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${toneClass[row.tone]}`}
                >
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* The differentiator: the rule that produced the result is on screen. */}
      <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-2.5">
        <p className="text-[10.5px] font-semibold text-brand-900">Why Thursday is a half day</p>
        <ol className="mt-1 space-y-0.5 text-[10.5px] text-brand-800">
          <li>1. Worked 4h 29m of a 9h shift</li>
          <li>2. Half-day threshold is 45% of the shift = 4h 03m</li>
          <li>3. Full-day threshold is 85% = 7h 39m — not met</li>
        </ol>
      </div>
    </Chrome>
  );
}

export function LeaveMockup() {
  return (
    <Chrome title="Apply for leave">
      <div className="space-y-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
            Leave type
          </p>
          <div className="mt-1 rounded-lg border bg-[var(--surface-muted)] px-2.5 py-1.5 text-[11.5px] text-[var(--text)]">
            Earned leave · 14.5 days available
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">From</p>
            <div className="mt-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] tabular-nums text-[var(--text)]">
              Fri 12 Sep
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">To</p>
            <div className="mt-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] tabular-nums text-[var(--text)]">
              Mon 15 Sep
            </div>
          </div>
        </div>
      </div>

      {/* The live cost preview — the thing that stops the argument. */}
      <div className="mt-3 rounded-lg border border-[var(--warning-border,#fed7aa)] bg-[var(--warning-bg)] p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[11.5px] font-semibold text-[var(--text)]">This request costs</p>
          <p className="text-[18px] font-semibold tabular-nums text-[var(--warning)]">4 days</p>
        </div>
        <ul className="mt-1.5 space-y-0.5 text-[10.5px] text-[var(--text-muted)]">
          <li>Fri 12 Sep — deducted</li>
          <li>Sat 13 · Sun 14 — deducted (sandwich rule: leave on both sides)</li>
          <li>Mon 15 Sep — deducted</li>
        </ul>
        <p className="mt-2 text-[10px] text-[var(--text-subtle)]">
          Balance after approval: 10.5 days
        </p>
      </div>
    </Chrome>
  );
}

export function PayrollMockup() {
  const lines = [
    { label: "Basic", value: "45,000.00", kind: "earning" },
    { label: "HRA (40% of Basic)", value: "18,000.00", kind: "earning" },
    { label: "Conveyance", value: "1,600.00", kind: "earning" },
    { label: "Provident fund (12%)", value: "5,400.00", kind: "deduction" },
    { label: "Loss of pay (1 day)", value: "2,442.00", kind: "deduction" },
  ];

  return (
    <Chrome title="Payslip · September">
      <div className="space-y-1">
        {lines.map((line) => (
          <div
            key={line.label}
            className="flex items-center justify-between border-b border-dashed py-1.5 last:border-0"
          >
            <span className="text-[11.5px] text-[var(--text-muted)]">{line.label}</span>
            <span
              className={`text-[11.5px] font-medium tabular-nums ${
                line.kind === "deduction" ? "text-[var(--danger)]" : "text-[var(--text)]"
              }`}
            >
              {line.kind === "deduction" ? "−" : ""}
              {line.value}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
        <span className="text-[12px] font-semibold text-[var(--text)]">Net pay</span>
        <span className="text-[15px] font-semibold tabular-nums text-[var(--text)]">56,758.00</span>
      </div>

      <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-2.5">
        <p className="text-[10.5px] font-semibold text-brand-900">
          How loss of pay was calculated
        </p>
        <p className="mt-1 text-[10.5px] leading-relaxed text-brand-800">
          Gross 64,600 ÷ 26 working days = 2,484.62 per day × 1 unpaid day, rounded to the
          nearest rupee. Per-day basis is a setting; yours is &ldquo;working days&rdquo;.
        </p>
      </div>
    </Chrome>
  );
}

export const MOCKUPS = {
  dashboard: DashboardMockup,
  attendance: AttendanceMockup,
  leave: LeaveMockup,
  payroll: PayrollMockup,
} as const;
