"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FieldHelpContent } from "@/components/ui";

/**
 * The server's description of a form: what each field is, and what it means.
 *
 * The explanations deliberately do not live in the frontend. The same registry
 * that produces them also produces the JSON schema the AI is constrained to
 * and is derived from the Zod schema the endpoint validates against, so an
 * explanation shipped here cannot disagree with the rule the value is about to
 * be checked against. A frontend copy would be a fourth statement of the same
 * field, and the first one to go stale.
 */

export interface FormField {
  name: string;
  path: string;
  type: string;
  required: boolean;
  nullable?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  default?: unknown;
  help?: FieldHelpContent;
  fields?: FormField[];
  itemFields?: FormField[];
}

export interface FormSchema {
  key: string;
  label: string;
  plural: string;
  route: string;
  permission: string;
  fields: FormField[];
}

export interface FormDraft {
  entity: string;
  label: string;
  values: Record<string, unknown>;
  explanation: string;
  rejected: Array<{ field: string; reason: string; proposed?: unknown }>;
  missingRequired: string[];
  needsSelection: string[];
}

/**
 * Fetch one form's description.
 *
 * Cached for the session — a form's shape only changes on deploy — and failing
 * quietly is deliberate: help is an enhancement, and a form must still render
 * and save when the AI module is not configured or the request fails.
 */
export function useFormSchema(entity?: string) {
  const query = useQuery({
    queryKey: ["form-schema", entity],
    queryFn: () => api.get<FormSchema>(`/ai/forms/${entity}`).then((r) => r.data),
    enabled: Boolean(entity),
    staleTime: Infinity,
    retry: false,
  });

  return query.data ?? null;
}

/** Every field flattened to its dotted path, so a form can look one up. */
export function helpByPath(schema: FormSchema | null): Record<string, FieldHelpContent> {
  const out: Record<string, FieldHelpContent> = {};
  if (!schema) return out;

  const walk = (fields: FormField[]) => {
    for (const field of fields) {
      if (field.help) out[field.path] = field.help;
      if (field.fields) walk(field.fields);
      if (field.itemFields) walk(field.itemFields);
    }
  };

  walk(schema.fields);
  return out;
}
