"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Checkbox, Field, Input, Select, Callout } from "@/components/ui";

/**
 * The approval chain — the part of a workflow that actually decides anything.
 *
 * The backend has always accepted a full chain: up to twenty ordered steps,
 * each choosing who approves, whether one approver is enough or all must
 * agree, what condition makes the step apply at all, and what happens when it
 * sits unanswered. The form sent none of it. Every workflow was created from a
 * hardcoded single "reporting manager" step, so the page's own promise of "a
 * second level for long leave, a department head instead of a line manager, or
 * escalation" could not be kept — and the schema field that carries all of it
 * was the one thing an administrator could not touch.
 *
 * `order` is not edited directly. It is the position in this list, renumbered
 * on every change, because two steps sharing an order is a state the resolver
 * has no defined answer for and no user would knowingly ask for.
 */

export interface WorkflowStep {
  order: number;
  name: string;
  approverType:
    | "reporting_manager"
    | "manager_level"
    | "department_head"
    | "role"
    | "permission"
    | "specific_users"
    | "requester";
  managerLevel?: number;
  roleIds?: string[];
  permission?: string | null;
  userIds?: string[];
  mode?: "any" | "all";
  condition?: string | null;
  autoApproveAfterDays?: number;
  escalateAfterDays?: number;
  canReject?: boolean;
  skipIfSelf?: boolean;
}

const APPROVER_TYPES = [
  { value: "reporting_manager", label: "The employee's reporting manager" },
  { value: "manager_level", label: "A specific level up the manager chain" },
  { value: "department_head", label: "The head of their department" },
  { value: "role", label: "Anyone holding a role" },
  { value: "permission", label: "Anyone holding a permission" },
  { value: "specific_users", label: "Named people" },
  { value: "requester", label: "The requester themselves" },
];

export function emptyStep(order: number): WorkflowStep {
  return {
    order,
    name: order === 1 ? "Manager approval" : `Level ${order}`,
    approverType: "reporting_manager",
    mode: "any",
    canReject: true,
    skipIfSelf: true,
  };
}

/** Always exactly what the schema wants: ordered from 1, no gaps. */
export function normaliseSteps(value: unknown): WorkflowStep[] {
  const supplied = Array.isArray(value) ? (value as WorkflowStep[]) : [];
  const steps = supplied.length ? supplied : [emptyStep(1)];
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

export function WorkflowStepsEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (steps: WorkflowStep[]) => void;
}) {
  const steps = normaliseSteps(value);

  // Only fetched when a step actually needs it, so an ordinary
  // reporting-manager workflow costs no extra requests.
  const needsRoles = steps.some((step) => step.approverType === "role");
  const needsUsers = steps.some((step) => step.approverType === "specific_users");

  const roles = useQuery({
    queryKey: ["ref", "roles"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string }>>("/roles", {
        query: { limit: 100 },
      });
      return data;
    },
    enabled: needsRoles,
    staleTime: 5 * 60_000,
  });

  const users = useQuery({
    queryKey: ["ref", "users"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; firstName?: string; lastName?: string; email: string }>>(
        "/users",
        { query: { limit: 200 } }
      );
      return data;
    },
    enabled: needsUsers,
    staleTime: 5 * 60_000,
  });

  const commit = (next: WorkflowStep[]) =>
    onChange(next.map((step, index) => ({ ...step, order: index + 1 })));

  const update = (index: number, patch: Partial<WorkflowStep>) =>
    commit(
      steps.map((step, i) => {
        if (i !== index) return step;
        const next = { ...step, ...patch };

        // Drop settings belonging to an approver type this step no longer is,
        // so a step switched from "role" to "department head" does not keep
        // carrying role ids the resolver would ignore but a reader would not.
        if (next.approverType !== "manager_level") delete next.managerLevel;
        if (next.approverType !== "role") delete next.roleIds;
        if (next.approverType !== "permission") delete next.permission;
        if (next.approverType !== "specific_users") delete next.userIds;
        if (next.approverType === "manager_level" && !next.managerLevel) next.managerLevel = 1;

        return next;
      })
    );

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const toggleId = (index: number, key: "roleIds" | "userIds", id: string) => {
    const current = steps[index][key] ?? [];
    update(index, {
      [key]: current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    } as Partial<WorkflowStep>);
  };

  return (
    <div className="sm:col-span-2">
      <Field
        label="Approval steps"
        hint="Run in the order shown. A request must clear each step before reaching the next."
      >
        <div className="mt-1.5 space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="rounded-[var(--radius)] border p-3">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
                  {index + 1}
                </span>
                <Input
                  aria-label={`Step ${index + 1} name`}
                  value={step.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  placeholder="Manager approval"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  icon={<ArrowUp className="h-3.5 w-3.5" />}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                  icon={<ArrowDown className="h-3.5 w-3.5" />}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove step ${index + 1}`}
                  // The schema demands at least one step; a workflow with none
                  // would accept a request and have nobody to send it to.
                  disabled={steps.length === 1}
                  onClick={() => commit(steps.filter((_, i) => i !== index))}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Who approves"
                  value={step.approverType}
                  onChange={(event) =>
                    update(index, { approverType: event.target.value as WorkflowStep["approverType"] })
                  }
                  options={APPROVER_TYPES}
                />

                {step.approverType === "manager_level" && (
                  <Input
                    label="Levels up"
                    type="number"
                    min={1}
                    max={10}
                    value={String(step.managerLevel ?? 1)}
                    onChange={(event) => update(index, { managerLevel: Number(event.target.value) })}
                    hint="1 is the direct manager, 2 their manager, and so on."
                  />
                )}

                {step.approverType === "permission" && (
                  <Input
                    label="Permission"
                    value={step.permission ?? ""}
                    onChange={(event) => update(index, { permission: event.target.value })}
                    placeholder="leave.approve"
                    hint="Anyone whose role grants this permission can approve."
                  />
                )}

                <Select
                  label="How many must agree"
                  value={step.mode ?? "any"}
                  onChange={(event) => update(index, { mode: event.target.value as "any" | "all" })}
                  options={[
                    { value: "any", label: "Any one of them" },
                    { value: "all", label: "All of them" },
                  ]}
                />

                <Input
                  label="Escalate after (days)"
                  type="number"
                  min={0}
                  max={365}
                  value={String(step.escalateAfterDays ?? 0)}
                  onChange={(event) => update(index, { escalateAfterDays: Number(event.target.value) })}
                  hint="0 leaves it waiting indefinitely."
                />

                <Input
                  label="Auto-approve after (days)"
                  type="number"
                  min={0}
                  max={365}
                  value={String(step.autoApproveAfterDays ?? 0)}
                  onChange={(event) =>
                    update(index, { autoApproveAfterDays: Number(event.target.value) })
                  }
                  hint="Takes effect instead of escalation when both are set. 0 switches it off."
                />

                <Input
                  label="Only apply when"
                  value={step.condition ?? ""}
                  onChange={(event) => update(index, { condition: event.target.value })}
                  placeholder="days > 5"
                  className="sm:col-span-2"
                  hint="Leave empty to always apply. A condition that cannot be evaluated runs the step rather than skipping it."
                />
              </div>

              {step.approverType === "role" && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[13px] font-medium">Roles that can approve</p>
                  {roles.isLoading ? (
                    <p className="text-[12.5px] text-[var(--text-muted)]">Loading roles…</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(roles.data ?? []).map((role) => (
                        <Checkbox
                          key={role.id}
                          label={role.name}
                          checked={(step.roleIds ?? []).includes(role.id)}
                          onChange={() => toggleId(index, "roleIds", role.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step.approverType === "specific_users" && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[13px] font-medium">People who can approve</p>
                  {users.isLoading ? (
                    <p className="text-[12.5px] text-[var(--text-muted)]">Loading people…</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(users.data ?? []).map((user) => (
                        <Checkbox
                          key={user.id}
                          label={
                            [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
                          }
                          checked={(step.userIds ?? []).includes(user.id)}
                          onChange={() => toggleId(index, "userIds", user.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-4">
                <Checkbox
                  label="Can reject outright"
                  checked={step.canReject !== false}
                  onChange={(event) => update(index, { canReject: event.target.checked })}
                />
                <Checkbox
                  label="Skip when the approver is the requester"
                  checked={step.skipIfSelf !== false}
                  onChange={(event) => update(index, { skipIfSelf: event.target.checked })}
                />
              </div>
            </div>
          ))}

          {steps.length < 20 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => commit([...steps, emptyStep(steps.length + 1)])}
              icon={<Plus className="h-4 w-4" />}
            >
              Add a step
            </Button>
          )}

          {steps.some((step) => step.approverType === "requester") && (
            <Callout tone="warning">
              A step approved by the requester approves their own request. That is deliberate for
              an acknowledgement step, but it is not a control.
            </Callout>
          )}
        </div>
      </Field>
    </div>
  );
}
