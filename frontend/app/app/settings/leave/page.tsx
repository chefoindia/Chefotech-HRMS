"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Save, Trash2 } from "lucide-react";
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
  Input,
  NoAccessState,
  PageHeader,
  PageLoader,
  Select,
  Switch,
  useToast,
} from "@/components/ui";
import type { LeaveType } from "@/lib/types";

interface Rule {
  _id?: string;
  leaveTypeId: string | { id?: string; _id?: string; name?: string };
  allocation: {
    mode: string;
    daysPerPeriod: number;
    accrualPerMonth: number;
    prorateOnJoining: boolean;
    rounding: string;
    maximumBalance: number;
  };
  carryForward: { enabled: boolean; maximumDays: number; expiryMonths: number };
  application: {
    noticeDays: number;
    maximumDaysPerRequest: number;
    allowBackdated: boolean;
    backdatedLimitDays: number;
    allowNegativeBalance: boolean;
    maximumNegativeDays: number;
  };
  counting: { holidays: string; weeklyOffs: string };
  approval: { required: boolean; escalateAfterDays: number };
}

interface LeavePolicy {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  rules: Rule[];
}

const COUNTING_OPTIONS = [
  { value: "exclude", label: "Not deducted" },
  { value: "sandwich", label: "Only if surrounded by leave (sandwich rule)" },
  { value: "include", label: "Always deducted" },
];

/**
 * Leave policies.
 *
 * One rule per leave type: how much, when it is credited, whether it carries
 * forward, and — the rule employees notice most — how weekends and holidays
 * inside a leave are counted.
 */
export default function LeavePolicySettingsPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LeavePolicy | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: policies, isLoading } = useQuery({
    queryKey: ["leave-policies"],
    queryFn: async () => {
      const { data } = await api.get<LeavePolicy[]>("/leave/policies");
      return data;
    },
    enabled: can("leave.view"),
  });

  const { data: leaveTypes } = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const { data } = await api.get<LeaveType[]>("/leave/types");
      return data;
    },
    enabled: can("leave.view"),
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
      await api.patch(`/leave/policies/${draft.id}`, {
        name: draft.name,
        rules: draft.rules.map((rule) => ({
          ...rule,
          leaveTypeId:
            typeof rule.leaveTypeId === "object"
              ? rule.leaveTypeId.id || rule.leaveTypeId._id
              : rule.leaveTypeId,
        })),
      });
    },
    onSuccess: () => {
      toast.success("Policy saved", "New requests are costed with these rules.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["leave-policies"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (error) => toast.fromError(error, "Could not save this policy."),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<LeavePolicy>("/leave/policies", {
        name: "New policy",
        code: `POL${Date.now().toString().slice(-5)}`,
      });
      return data;
    },
    onSuccess: (policy) => {
      toast.success("Policy created", "Add a rule for each leave type it should cover.");
      setSelectedId(policy.id);
      queryClient.invalidateQueries({ queryKey: ["leave-policies"] });
    },
    onError: (error) => toast.fromError(error, "Could not create a policy."),
  });

  if (!can("leave.view")) return <NoAccessState what="leave policies" />;
  if (isLoading) return <PageLoader label="Loading policies" />;

  const canManage = can("leave.manage_policies");

  const setRule = (index: number, path: string, value: unknown) => {
    setDraft((current) => {
      if (!current) return current;
      const rules = [...current.rules];
      rules[index] = setPath(rules[index] as never, path, value) as Rule;
      return { ...current, rules };
    });
    setDirty(true);
  };

  const addRule = (leaveTypeId: string) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        rules: [
          ...current.rules,
          {
            leaveTypeId,
            allocation: {
              mode: "annual",
              daysPerPeriod: 12,
              accrualPerMonth: 1,
              prorateOnJoining: true,
              rounding: "nearest_half",
              maximumBalance: 0,
            },
            carryForward: { enabled: false, maximumDays: 0, expiryMonths: 0 },
            application: {
              noticeDays: 0,
              maximumDaysPerRequest: 0,
              allowBackdated: true,
              backdatedLimitDays: 30,
              allowNegativeBalance: false,
              maximumNegativeDays: 0,
            },
            counting: { holidays: "exclude", weeklyOffs: "exclude" },
            approval: { required: true, escalateAfterDays: 0 },
          },
        ],
      };
    });
    setDirty(true);
  };

  if (!policies?.length) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="No leave policy yet"
          description="A policy holds one rule per leave type. Create one so employees can start applying."
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

  const usedTypeIds = new Set(
    draft.rules.map((rule) =>
      typeof rule.leaveTypeId === "object" ? rule.leaveTypeId.id || rule.leaveTypeId._id : rule.leaveTypeId
    )
  );
  const availableTypes = (leaveTypes || []).filter((type) => !usedTypeIds.has(type.id));

  return (
    <div className="space-y-5" data-tour="leave-policy-form">
      <Card>
        <CardHeader
          title="Leave policies"
          description="Assign different policies to different groups — staff and the shop floor rarely get the same leave."
          action={
            canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => create.mutate()}
                loading={create.isPending}
                icon={<Plus className="h-3.5 w-3.5" />}
                data-tour="leave-policy-create"
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

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <Input
            label="Policy name"
            value={draft.name}
            disabled={!canManage}
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
              setDirty(true);
            }}
            containerClassName="flex-1 min-w-56"
            data-tour="leave-policy-name"
          />
          <Input
            label="Code"
            value={draft.code}
            disabled
            containerClassName="w-32"
            data-tour="leave-policy-code"
          />
          {canManage && (
            <Button
              loading={save.isPending}
              disabled={!dirty}
              onClick={() => save.mutate()}
              icon={<Save className="h-4 w-4" />}
              data-tour="leave-policy-save"
            >
              Save policy
            </Button>
          )}
        </div>
      </Card>

      {draft.rules.map((rule, index) => {
        const typeId =
          typeof rule.leaveTypeId === "object"
            ? rule.leaveTypeId.id || rule.leaveTypeId._id
            : rule.leaveTypeId;
        const type = leaveTypes?.find((item) => item.id === typeId);

        return (
          <Card key={rule._id || index} data-tour={index === 0 ? "leave-rule-row" : undefined}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: type?.colour || "var(--border-strong)" }}
                    aria-hidden
                  />
                  {type?.name || "Leave type"}
                </span>
              }
              action={
                canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove this rule"
                    onClick={() => {
                      setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) });
                      setDirty(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
                  </Button>
                )
              }
            />

            <div className="mt-5 space-y-5">
              <FieldGrid columns={3}>
                <Select
                  label="How is it credited?"
                  value={rule.allocation.mode}
                  disabled={!canManage}
                  onChange={(event) => setRule(index, "allocation.mode", event.target.value)}
                  options={[
                    { value: "annual", label: "All at once, each year" },
                    { value: "monthly", label: "Every month" },
                    { value: "accrual", label: "Earned per completed month" },
                    { value: "unlimited", label: "Unlimited" },
                    { value: "none", label: "Not allocated (comp off, etc.)" },
                  ]}
                  data-tour={index === 0 ? "leave-rule-allocation-mode" : undefined}
                />

                <Input
                  label={
                    rule.allocation.mode === "accrual" ? "Days per month" : "Days per period"
                  }
                  type="number"
                  step="0.5"
                  min={0}
                  disabled={!canManage}
                  value={
                    rule.allocation.mode === "accrual"
                      ? rule.allocation.accrualPerMonth
                      : rule.allocation.daysPerPeriod
                  }
                  onChange={(event) =>
                    setRule(
                      index,
                      rule.allocation.mode === "accrual"
                        ? "allocation.accrualPerMonth"
                        : "allocation.daysPerPeriod",
                      Number(event.target.value)
                    )
                  }
                  data-tour={index === 0 ? "leave-rule-days" : undefined}
                />

                <Input
                  label="Maximum balance"
                  type="number"
                  min={0}
                  disabled={!canManage}
                  value={rule.allocation.maximumBalance}
                  onChange={(event) =>
                    setRule(index, "allocation.maximumBalance", Number(event.target.value))
                  }
                  hint="0 means uncapped."
                />
              </FieldGrid>

              <FieldGrid columns={2}>
                <Select
                  label="Weekends inside a leave"
                  value={rule.counting.weeklyOffs}
                  disabled={!canManage}
                  onChange={(event) => setRule(index, "counting.weeklyOffs", event.target.value)}
                  options={COUNTING_OPTIONS}
                  hint="The rule employees notice most."
                  data-tour={index === 0 ? "leave-rule-weekly-offs" : undefined}
                />
                <Select
                  label="Holidays inside a leave"
                  value={rule.counting.holidays}
                  disabled={!canManage}
                  onChange={(event) => setRule(index, "counting.holidays", event.target.value)}
                  options={COUNTING_OPTIONS}
                />
              </FieldGrid>

              <div>
                <Switch
                  label="Carry unused days into next year"
                  checked={rule.carryForward.enabled}
                  disabled={!canManage}
                  onChange={(value) => setRule(index, "carryForward.enabled", value)}
                  data-tour={index === 0 ? "leave-rule-carry-forward" : undefined}
                />

                {rule.carryForward.enabled && (
                  <FieldGrid columns={2} className="mt-3">
                    <Input
                      label="Maximum days carried"
                      type="number"
                      min={0}
                      disabled={!canManage}
                      value={rule.carryForward.maximumDays}
                      onChange={(event) =>
                        setRule(index, "carryForward.maximumDays", Number(event.target.value))
                      }
                      hint="0 carries everything."
                    />
                    <Input
                      label="Carried days lapse after (months)"
                      type="number"
                      min={0}
                      max={24}
                      disabled={!canManage}
                      value={rule.carryForward.expiryMonths}
                      onChange={(event) =>
                        setRule(index, "carryForward.expiryMonths", Number(event.target.value))
                      }
                      hint="0 means they never lapse."
                    />
                  </FieldGrid>
                )}
              </div>

              <FieldGrid columns={3}>
                <Input
                  label="Notice required (days)"
                  type="number"
                  min={0}
                  disabled={!canManage}
                  value={rule.application.noticeDays}
                  onChange={(event) =>
                    setRule(index, "application.noticeDays", Number(event.target.value))
                  }
                />
                <Input
                  label="Maximum per request (days)"
                  type="number"
                  min={0}
                  disabled={!canManage}
                  value={rule.application.maximumDaysPerRequest}
                  onChange={(event) =>
                    setRule(index, "application.maximumDaysPerRequest", Number(event.target.value))
                  }
                  hint="0 means no limit."
                />
                <Input
                  label="Backdated limit (days)"
                  type="number"
                  min={0}
                  disabled={!canManage}
                  value={rule.application.backdatedLimitDays}
                  onChange={(event) =>
                    setRule(index, "application.backdatedLimitDays", Number(event.target.value))
                  }
                />
              </FieldGrid>

              <Switch
                label="Allow the balance to go negative"
                hint="Useful for maternity leave and similar entitlements that are not accrued."
                checked={rule.application.allowNegativeBalance}
                disabled={!canManage}
                onChange={(value) => setRule(index, "application.allowNegativeBalance", value)}
              />
            </div>
          </Card>
        );
      })}

      {canManage && availableTypes.length > 0 && (
        <Card>
          <CardHeader
            title="Add a leave type to this policy"
            description="Types without a rule here cannot be applied for under this policy."
          />
          <div className="mt-3 flex flex-wrap gap-2" data-tour="leave-policy-add-rule">
            {availableTypes.map((type) => (
              <Button
                key={type.id}
                variant="outline"
                size="sm"
                onClick={() => addRule(type.id)}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                {type.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

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
