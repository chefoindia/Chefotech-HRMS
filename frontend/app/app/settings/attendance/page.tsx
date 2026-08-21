"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Sliders } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { setPath } from "@/lib/utils";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  FieldGrid,
  FieldSet,
  Input,
  NoAccessState,
  PageLoader,
  Select,
  Switch,
  useToast,
} from "@/components/ui";

interface AttendancePolicy {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  isActive: boolean;
  arrival: {
    graceMinutes: number;
    lateAfterMinutes: number;
    halfDayAfterMinutes: number;
    absentAfterMinutes: number;
    earlyArrivalCountsAsOvertime: boolean;
  };
  departure: {
    graceMinutes: number;
    earlyLeavingAfterMinutes: number;
    halfDayBeforeMinutes: number;
  };
  hours: {
    basis: "shift_based" | "fixed_hours";
    fullDayMinutes: number;
    halfDayMinutes: number;
    fullDayPercent: number;
    halfDayPercent: number;
    minimumMinutesForPresence: number;
  };
  breaks: { calculation: string; maxBreakMinutes: number; deductExcessBreak: boolean };
  lateMarks: {
    enabled: boolean;
    countForDeduction: number;
    deductionType: string;
    resetPeriod: string;
  };
  overtime: {
    enabled: boolean;
    startsAfterMinutes: number;
    minimumMinutes: number;
    maximumMinutesPerDay: number;
    roundToMinutes: number;
    requiresApproval: boolean;
    normalDayRate: number;
    weeklyOffRate: number;
    holidayRate: number;
  };
  missingPunch: { treatAs: string; notifyEmployee: boolean };
  regularization: {
    enabled: boolean;
    windowDays: number;
    maxPerMonth: number;
    requiresApproval: boolean;
  };
}

/**
 * Attendance policies.
 *
 * This is the screen that makes the "configuration, not code" claim true.
 * Every number here is consumed directly by the attendance engine — nothing
 * about grace periods, half days or overtime exists anywhere in the source.
 */
export default function AttendancePolicySettingsPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AttendancePolicy | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: policies, isLoading } = useQuery({
    queryKey: ["attendance-policies"],
    queryFn: async () => {
      const { data } = await api.get<AttendancePolicy[]>("/attendance/policies", {
        query: { limit: 50 },
      });
      return data;
    },
  });

  useEffect(() => {
    if (!policies?.length) return;
    const target = policies.find((policy) => policy.id === selectedId) || policies[0];
    setSelectedId(target.id);
    setDraft(structuredClone(target));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies, selectedId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.patch(`/attendance/policies/${draft.id}`, {
        name: draft.name,
        arrival: draft.arrival,
        departure: draft.departure,
        hours: draft.hours,
        breaks: draft.breaks,
        lateMarks: draft.lateMarks,
        overtime: draft.overtime,
        missingPunch: draft.missingPunch,
        regularization: draft.regularization,
      });
    },
    onSuccess: () => {
      toast.success(
        "Policy saved",
        "New attendance is calculated with these rules. Use Recalculate to apply them to past days."
      );
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["attendance-policies"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (error) => toast.fromError(error, "Could not save this policy."),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<AttendancePolicy>("/attendance/policies", {
        name: "New policy",
        code: `POL${Date.now().toString().slice(-5)}`,
      });
      return data;
    },
    onSuccess: (policy) => {
      toast.success("Policy created");
      setSelectedId(policy.id);
      queryClient.invalidateQueries({ queryKey: ["attendance-policies"] });
    },
    onError: (error) => toast.fromError(error, "Could not create a policy."),
  });

  const set = (path: string, value: unknown) => {
    setDraft((current) => (current ? (setPath(current as never, path, value) as AttendancePolicy) : current));
    setDirty(true);
  };

  if (!can("settings.view")) return <NoAccessState what="attendance policies" />;
  if (isLoading) return <PageLoader label="Loading policies" />;

  const canManage = can("settings.manage_policies");

  if (!policies?.length) {
    return (
      <Card>
        <EmptyState
          icon={<Sliders className="h-6 w-6" />}
          title="No attendance policy yet"
          description="A policy holds every rule the attendance engine uses — grace periods, half-day thresholds, overtime. Create one to start recording attendance."
          action={
            canManage ? (
              <Button onClick={() => create.mutate()} loading={create.isPending} icon={<Plus className="h-4 w-4" />}>
                Create a policy
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  if (!draft) return <PageLoader />;

  const shiftBased = draft.hours.basis === "shift_based";

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Attendance policies"
          description="Assign different policies to different teams — a strict factory-floor policy and a lenient one for the design team can run side by side."
          action={
            canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => create.mutate()}
                loading={create.isPending}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                New policy
              </Button>
            )
          }
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {policies.map((policy) => (
            <button
              key={policy.id}
              type="button"
              data-tour="attendance-policy-row"
              onClick={() => setSelectedId(policy.id)}
              className={
                policy.id === selectedId
                  ? "rounded-[calc(var(--radius)-2px)] border border-brand-400 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700"
                  : "rounded-[calc(var(--radius)-2px)] border px-3 py-1.5 text-[13px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
              }
            >
              {policy.name}
              {policy.isDefault && (
                <span className="ml-1.5 text-[11px] text-[var(--text-subtle)]">default</span>
              )}
            </button>
          ))}
        </div>
      </Card>

      <div data-tour="attendance-policy-form" className="space-y-5">
        <Card>
          <CardHeader
            title={draft.name}
            description="Every value here is read directly by the attendance engine."
            action={
              canManage && (
                <Button
                  size="sm"
                  loading={save.isPending}
                  disabled={!dirty}
                  onClick={() => save.mutate()}
                  icon={<Save className="h-3.5 w-3.5" />}
                  data-tour="attendance-policy-save"
                >
                  Save
                </Button>
              )
            }
          />

          <div className="mt-5">
            <Input
              label="Policy name"
              value={draft.name}
              disabled={!canManage}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>
        </Card>

        <Card>
          <FieldSet
            title="Arrival"
            description="How lateness is measured, and when it starts costing something."
          >
            <FieldGrid columns={2}>
              <Input
                label="Grace period (minutes)"
                type="number"
                min={0}
                max={240}
                disabled={!canManage}
                value={draft.arrival.graceMinutes}
                onChange={(event) => set("arrival.graceMinutes", Number(event.target.value))}
                hint="Arriving within this window is not late at all."
              />
              <Input
                label="Late beyond grace (minutes)"
                type="number"
                min={0}
                disabled={!canManage}
                value={draft.arrival.lateAfterMinutes}
                onChange={(event) => set("arrival.lateAfterMinutes", Number(event.target.value))}
                hint="0 means a late mark applies as soon as the grace period is used up."
              />
              <Input
                label="Half day if later than (minutes)"
                type="number"
                min={0}
                max={720}
                disabled={!canManage}
                value={draft.arrival.halfDayAfterMinutes}
                onChange={(event) => set("arrival.halfDayAfterMinutes", Number(event.target.value))}
                hint="0 turns this off."
                data-tour="attendance-late-half-day"
              />
              <Input
                label="Absent if later than (minutes)"
                type="number"
                min={0}
                max={720}
                disabled={!canManage}
                value={draft.arrival.absentAfterMinutes}
                onChange={(event) => set("arrival.absentAfterMinutes", Number(event.target.value))}
                hint="0 turns this off."
              />
            </FieldGrid>
          </FieldSet>
        </Card>

        <Card>
          <FieldSet title="Working hours" description="What counts as a full day and a half day.">
            <Select
              label="Measure against"
              value={draft.hours.basis}
              disabled={!canManage}
              onChange={(event) => set("hours.basis", event.target.value)}
              options={[
                { value: "shift_based", label: "A percentage of the scheduled shift" },
                { value: "fixed_hours", label: "Fixed hours, whatever the shift" },
              ]}
              hint="Shift-based works better when different teams have different shift lengths."
              data-tour="attendance-hours-basis"
            />

            <FieldGrid columns={2}>
              {shiftBased ? (
                <>
                  <Input
                    label="Full day (% of shift)"
                    type="number"
                    min={10}
                    max={100}
                    disabled={!canManage}
                    value={draft.hours.fullDayPercent}
                    onChange={(event) => set("hours.fullDayPercent", Number(event.target.value))}
                    data-tour="attendance-full-day"
                  />
                  <Input
                    label="Half day (% of shift)"
                    type="number"
                    min={5}
                    max={100}
                    disabled={!canManage}
                    value={draft.hours.halfDayPercent}
                    onChange={(event) => set("hours.halfDayPercent", Number(event.target.value))}
                    data-tour="attendance-half-day"
                  />
                </>
              ) : (
                <>
                  <Input
                    label="Full day (minutes)"
                    type="number"
                    min={60}
                    max={1440}
                    disabled={!canManage}
                    value={draft.hours.fullDayMinutes}
                    onChange={(event) => set("hours.fullDayMinutes", Number(event.target.value))}
                    data-tour="attendance-full-day"
                  />
                  <Input
                    label="Half day (minutes)"
                    type="number"
                    min={30}
                    max={720}
                    disabled={!canManage}
                    value={draft.hours.halfDayMinutes}
                    onChange={(event) => set("hours.halfDayMinutes", Number(event.target.value))}
                    data-tour="attendance-half-day"
                  />
                </>
              )}

              <Input
                label="Minimum to count as present (minutes)"
                type="number"
                min={0}
                max={720}
                disabled={!canManage}
                value={draft.hours.minimumMinutesForPresence}
                onChange={(event) =>
                  set("hours.minimumMinutesForPresence", Number(event.target.value))
                }
                hint="Below this the day is an absence, even with a punch."
              />
            </FieldGrid>

            <Callout tone="info">
              With these settings, a nine-hour shift needs{" "}
              <strong>
                {shiftBased
                  ? `${Math.round((480 * draft.hours.fullDayPercent) / 100)} minutes`
                  : `${draft.hours.fullDayMinutes} minutes`}
              </strong>{" "}
              for a full day and{" "}
              <strong>
                {shiftBased
                  ? `${Math.round((480 * draft.hours.halfDayPercent) / 100)} minutes`
                  : `${draft.hours.halfDayMinutes} minutes`}
              </strong>{" "}
              for a half day.
            </Callout>
          </FieldSet>
        </Card>

        <Card>
          <FieldSet title="Late marks" description="Turn repeated lateness into a deduction.">
            <Switch
              label="Count late marks"
              hint="When off, lateness is recorded but never costs a day."
              checked={draft.lateMarks.enabled}
              disabled={!canManage}
              onChange={(value) => set("lateMarks.enabled", value)}
            />

            {draft.lateMarks.enabled && (
              <FieldGrid columns={3}>
                <Input
                  label="Late marks per deduction"
                  type="number"
                  min={1}
                  max={30}
                  disabled={!canManage}
                  value={draft.lateMarks.countForDeduction}
                  onChange={(event) =>
                    set("lateMarks.countForDeduction", Number(event.target.value))
                  }
                />
                <Select
                  label="Deduction"
                  value={draft.lateMarks.deductionType}
                  disabled={!canManage}
                  onChange={(event) => set("lateMarks.deductionType", event.target.value)}
                  options={[
                    { value: "half_day", label: "Half day" },
                    { value: "full_day", label: "Full day" },
                    { value: "leave", label: "Deduct from leave" },
                  ]}
                />
                <Select
                  label="Counter resets"
                  value={draft.lateMarks.resetPeriod}
                  disabled={!canManage}
                  onChange={(event) => set("lateMarks.resetPeriod", event.target.value)}
                  options={[
                    { value: "monthly", label: "Every month" },
                    { value: "quarterly", label: "Every quarter" },
                    { value: "yearly", label: "Every year" },
                  ]}
                />
              </FieldGrid>
            )}
          </FieldSet>
        </Card>

        <Card>
          <FieldSet title="Overtime" description="What is earned for working beyond the shift.">
            <Switch
              label="Track overtime"
              checked={draft.overtime.enabled}
              disabled={!canManage}
              onChange={(value) => set("overtime.enabled", value)}
            />

            {draft.overtime.enabled && (
              <>
                <FieldGrid columns={3}>
                  <Input
                    label="Starts after (minutes)"
                    type="number"
                    min={0}
                    disabled={!canManage}
                    value={draft.overtime.startsAfterMinutes}
                    onChange={(event) =>
                      set("overtime.startsAfterMinutes", Number(event.target.value))
                    }
                  />
                  <Input
                    label="Minimum to count (minutes)"
                    type="number"
                    min={0}
                    disabled={!canManage}
                    value={draft.overtime.minimumMinutes}
                    onChange={(event) => set("overtime.minimumMinutes", Number(event.target.value))}
                  />
                  <Input
                    label="Round down to (minutes)"
                    type="number"
                    min={0}
                    max={120}
                    disabled={!canManage}
                    value={draft.overtime.roundToMinutes}
                    onChange={(event) => set("overtime.roundToMinutes", Number(event.target.value))}
                    hint="0 means no rounding."
                  />
                </FieldGrid>

                <FieldGrid columns={3}>
                  <Input
                    label="Normal day rate"
                    type="number"
                    disabled={!canManage}
                    value={draft.overtime.normalDayRate}
                    onChange={(event) => set("overtime.normalDayRate", Number(event.target.value))}
                    hint="1.5 means time and a half."
                  />
                  <Input
                    label="Weekly off rate"
                    type="number"
                    disabled={!canManage}
                    value={draft.overtime.weeklyOffRate}
                    onChange={(event) => set("overtime.weeklyOffRate", Number(event.target.value))}
                  />
                  <Input
                    label="Holiday rate"
                    type="number"
                    disabled={!canManage}
                    value={draft.overtime.holidayRate}
                    onChange={(event) => set("overtime.holidayRate", Number(event.target.value))}
                  />
                </FieldGrid>

                <Switch
                  label="Overtime needs approval before it is payable"
                  checked={draft.overtime.requiresApproval}
                  disabled={!canManage}
                  onChange={(value) => set("overtime.requiresApproval", value)}
                />
              </>
            )}
          </FieldSet>
        </Card>

        <Card>
          <FieldSet
            title="Missing punches and corrections"
            description="What happens when someone forgets."
          >
            <Select
              label="A day with a missing punch is treated as"
              value={draft.missingPunch.treatAs}
              disabled={!canManage}
              onChange={(event) => set("missingPunch.treatAs", event.target.value)}
              options={[
                { value: "pending", label: "Pending — someone must resolve it" },
                { value: "half_day", label: "Half day" },
                { value: "absent", label: "Absent" },
                { value: "present", label: "Present" },
              ]}
              hint="Pending is the safest default: it flags the day rather than guessing."
            />

            <Switch
              label="Allow employees to request corrections"
              checked={draft.regularization.enabled}
              disabled={!canManage}
              onChange={(value) => set("regularization.enabled", value)}
            />

            {draft.regularization.enabled && (
              <FieldGrid columns={2}>
                <Input
                  label="How far back (days)"
                  type="number"
                  min={0}
                  max={90}
                  disabled={!canManage}
                  value={draft.regularization.windowDays}
                  onChange={(event) =>
                    set("regularization.windowDays", Number(event.target.value))
                  }
                />
                <Input
                  label="Maximum per month"
                  type="number"
                  min={0}
                  max={31}
                  disabled={!canManage}
                  value={draft.regularization.maxPerMonth}
                  onChange={(event) =>
                    set("regularization.maxPerMonth", Number(event.target.value))
                  }
                  hint="0 means no limit."
                />
              </FieldGrid>
            )}
          </FieldSet>
        </Card>
      </div>

      {dirty && canManage && (
        <div className="sticky bottom-4 z-10">
          <Callout tone="info" className="flex items-center justify-between gap-4 shadow-lg">
            <span>Unsaved changes to this policy.</span>
            <span className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const original = policies.find((policy) => policy.id === selectedId);
                  if (original) setDraft(structuredClone(original));
                  setDirty(false);
                }}
              >
                Discard
              </Button>
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                Save policy
              </Button>
            </span>
          </Callout>
        </div>
      )}
    </div>
  );
}
