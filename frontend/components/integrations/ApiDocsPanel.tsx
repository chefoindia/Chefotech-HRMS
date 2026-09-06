"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Copy, Download, ExternalLink, Play, Search, Send, ShieldCheck, Terminal, Webhook as WebhookIcon } from "lucide-react";
import { api, BASE_URL, API_PREFIX } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Badge, Button, Callout, Card, CardHeader, Input, PageLoader, Select, Textarea, useToast } from "@/components/ui";
import { CodeBlock, CodeTabs } from "@/components/docs/CodeBlock";

/**
 * How to actually use this API.
 *
 * The keys and webhooks screens let someone create credentials; on their own
 * they answer none of the questions that follow — what the base URL is, which
 * header carries the key, what a response looks like, why a valid key still
 * returns 403, how to check a webhook signature. Without that an integrator's
 * first hour is guesswork against a 401.
 *
 * So this is the reference and the sandbox in one place: the real base URL of
 * this deployment, copy-paste snippets in four languages, a request console
 * that talks to the live API from the browser, the full endpoint list read
 * from the server itself, and a Postman collection to import.
 */

interface EndpointGroup {
  prefix: string;
  title: string;
  blurb: string;
  endpoints: { method: string; path: string; scopes: string[]; scopeMode: "all" | "any"; description: string }[];
}

interface Catalogue {
  baseUrl: string;
  apiPrefix: string;
  endpointCount: number;
  groupCount: number;
  groups: EndpointGroup[];
}

const METHOD_TONE: Record<string, string> = {
  GET: "bg-emerald-50 text-emerald-700 border-emerald-200",
  POST: "bg-blue-50 text-blue-700 border-blue-200",
  PATCH: "bg-amber-50 text-amber-700 border-amber-200",
  PUT: "bg-amber-50 text-amber-700 border-amber-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
};

const SECTIONS = [
  { id: "start", label: "Start here" },
  { id: "console", label: "Try a request" },
  { id: "auth", label: "Authentication" },
  { id: "responses", label: "Responses and errors" },
  { id: "lists", label: "Lists and paging" },
  { id: "endpoints", label: "Endpoint reference" },
  { id: "webhooks", label: "Webhooks" },
  { id: "tools", label: "Postman and tools" },
  { id: "trouble", label: "Troubleshooting" },
];

export function ApiDocsPanel({ onGoToKeys }: { onGoToKeys: () => void }) {
  const { session } = useSession();
  const baseUrl = `${BASE_URL}${API_PREFIX}`;
  const orgName = session?.organization?.name || "your organization";

  const { data: catalogue, isLoading } = useQuery({
    queryKey: ["integrations", "endpoints"],
    queryFn: async () => (await api.get<Catalogue>("/integrations/endpoints")).data,
    staleTime: 30 * 60_000,
  });

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#api-${section.id}`}
            className="rounded-md px-2.5 py-1 text-[12.5px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <StartHere baseUrl={baseUrl} onGoToKeys={onGoToKeys} />
      <RequestConsole baseUrl={baseUrl} catalogue={catalogue} />
      <Authentication baseUrl={baseUrl} />
      <Responses />
      <Lists baseUrl={baseUrl} />
      <EndpointReference catalogue={catalogue} isLoading={isLoading} baseUrl={baseUrl} />
      <Webhooks />
      <Tools baseUrl={baseUrl} orgName={orgName} />
      <Troubleshooting />
    </div>
  );
}

// ── Start here ──────────────────────────────────────────────────────────────

function StartHere({ baseUrl, onGoToKeys }: { baseUrl: string; onGoToKeys: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copyBase = () => {
    navigator.clipboard.writeText(baseUrl).then(() => {
      setCopied(true);
      toast.success("Base URL copied");
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => undefined);
  };

  return (
    <Card id="api-start" className="scroll-mt-20">
      <CardHeader
        title="Start here"
        description="Three steps from nothing to a working request. Everything below is specific to this server — the URLs are real and the examples run as written."
      />

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Your base URL</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="rounded bg-[var(--surface)] px-2 py-1 font-mono text-[13px] text-[var(--text)]">{baseUrl}</code>
          <Button variant="ghost" size="sm" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={copyBase}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">
          Every path in this guide is relative to it. So <code className="font-mono">/employees</code> means{" "}
          <code className="font-mono">{baseUrl}/employees</code>.
        </p>
      </div>

      <ol className="mt-5 space-y-5">
        <Step
          number={1}
          title="Create an API key"
          body={
            <>
              <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                Open the <strong className="text-[var(--text)]">API keys</strong> tab and create one. Tick only the permissions the
                integration genuinely needs — a key can never do more than the person who created it, and a narrow key limits the damage
                if it leaks. The key is shown once, at creation; we store only a hash, so copy it then.
              </p>
              <Button size="sm" className="mt-2.5" onClick={onGoToKeys}>
                Go to API keys
              </Button>
            </>
          }
        />
        <Step
          number={2}
          title="Send your first request"
          body={
            <>
              <p className="mb-2.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                Put the key in an <code className="font-mono text-[12.5px]">x-api-key</code> header. This asks the API who you are — the
                fastest way to prove the key works.
              </p>
              <CodeTabs
                samples={[
                  {
                    label: "curl",
                    language: "bash",
                    code: `curl "${baseUrl}/employees?limit=5" \\\n  -H "x-api-key: ct_live_xxxxxx_your_key_here"`,
                  },
                  {
                    label: "JavaScript",
                    language: "javascript",
                    code: `const res = await fetch("${baseUrl}/employees?limit=5", {\n  headers: { "x-api-key": process.env.CHEFOTECH_API_KEY },\n});\n\nconst body = await res.json();\nconsole.log(body.data);      // the employees\nconsole.log(body.meta);      // page, limit, total, totalPages`,
                  },
                  {
                    label: "Python",
                    language: "python",
                    code: `import os, requests\n\nres = requests.get(\n    "${baseUrl}/employees",\n    headers={"x-api-key": os.environ["CHEFOTECH_API_KEY"]},\n    params={"limit": 5},\n    timeout=30,\n)\nres.raise_for_status()\nprint(res.json()["data"])`,
                  },
                  {
                    label: "PHP",
                    language: "php",
                    code: `<?php\n$ch = curl_init("${baseUrl}/employees?limit=5");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n    "x-api-key: " . getenv("CHEFOTECH_API_KEY"),\n]);\n$body = json_decode(curl_exec($ch), true);\ncurl_close($ch);\n\nprint_r($body["data"]);`,
                  },
                ]}
              />
            </>
          }
        />
        <Step
          number={3}
          title="Read the response"
          body={
            <>
              <p className="mb-2.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                Every response has the same shape, so one parser handles all of them. The rows are always in{" "}
                <code className="font-mono text-[12.5px]">data</code>; paging lives in <code className="font-mono text-[12.5px]">meta</code>.
              </p>
              <CodeBlock
                language="json"
                code={`{\n  "success": true,\n  "data": [\n    {\n      "id": "6a9d9f628e4e6d5911a5cdae",\n      "employeeCode": "EMP0001",\n      "fullName": "Rohan Deshmukh",\n      "status": "active",\n      "employment": { "joiningDate": "2023-04-10T00:00:00.000Z" }\n    }\n  ],\n  "meta": { "page": 1, "limit": 5, "total": 12, "totalPages": 3, "hasNext": true, "hasPrev": false }\n}`}
              />
            </>
          }
        />
      </ol>
    </Card>
  );
}

function Step({ number, title, body }: { number: number; title: string; body: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-[13px] font-semibold text-white">{number}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[14.5px] font-semibold text-[var(--text)]">{title}</h3>
        <div className="mt-1.5">{body}</div>
      </div>
    </li>
  );
}

// ── Live console ────────────────────────────────────────────────────────────

const CONSOLE_PRESETS = [
  { label: "List employees", method: "GET", path: "/employees?limit=5" },
  { label: "Employee directory", method: "GET", path: "/employees/directory?limit=5" },
  { label: "Departments", method: "GET", path: "/departments" },
  { label: "Locations", method: "GET", path: "/locations" },
  { label: "Leave types", method: "GET", path: "/leave/types" },
  { label: "Attendance (today)", method: "GET", path: "/attendance?limit=5" },
  { label: "Payroll runs", method: "GET", path: "/payroll/runs?limit=5" },
  { label: "Holidays", method: "GET", path: "/holidays" },
  { label: "Permission catalogue", method: "GET", path: "/roles/permissions" },
];

function RequestConsole({ baseUrl, catalogue }: { baseUrl: string; catalogue?: Catalogue }) {
  const [apiKey, setApiKey] = useState("");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/employees?limit=5");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ status: number; ms: number; text: string; ok: boolean } | null>(null);

  const send = async () => {
    setSending(true);
    setResult(null);
    const started = performance.now();
    try {
      const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
      const res = await fetch(url, {
        method,
        headers: {
          "x-api-key": apiKey.trim(),
          ...(body.trim() && method !== "GET" ? { "Content-Type": "application/json" } : {}),
        },
        body: body.trim() && method !== "GET" ? body : undefined,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON — show it raw */
      }
      setResult({ status: res.status, ms: Math.round(performance.now() - started), text: pretty, ok: res.ok });
    } catch (error) {
      setResult({
        status: 0,
        ms: Math.round(performance.now() - started),
        ok: false,
        text: `The request never reached the server.\n\n${error instanceof Error ? error.message : String(error)}\n\nUsual causes: the server is asleep and still waking (try again), or this browser blocked the call. The same request from curl or Postman is unaffected.`,
      });
    } finally {
      setSending(false);
    }
  };

  const allPaths = useMemo(() => {
    if (!catalogue) return [];
    return catalogue.groups.flatMap((g) => g.endpoints.filter((e) => e.method === "GET" && !e.path.includes(":")).map((e) => e.path));
  }, [catalogue]);

  return (
    <Card id="api-console" className="scroll-mt-20">
      <CardHeader
        title="Try a request"
        description="Send a real call to this server from the browser. Nothing is stored — the key stays in this page and is gone when you leave it."
      />

      <div className="mt-4 space-y-3">
        <Input
          label="API key"
          type="password"
          autoComplete="off"
          placeholder="ct_live_xxxxxx_..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          hint="Paste a key you created in the API keys tab. It is never sent anywhere except this API."
        />

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-[var(--text)]">Quick picks</p>
          <div className="flex flex-wrap gap-1.5">
            {CONSOLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setMethod(preset.method);
                  setPath(preset.path);
                  setBody("");
                }}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[12.5px] transition-colors",
                  path === preset.path ? "border-brand-600 bg-brand-50 text-brand-700" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
          <Select
            label="Method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            options={["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => ({ value: m, label: m }))}
          />
          <Input
            label="Path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            list="api-console-paths"
            hint={`Relative to ${baseUrl}`}
          />
          <datalist id="api-console-paths">
            {allPaths.slice(0, 300).map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        {method !== "GET" && (
          <Textarea
            label="Request body (JSON)"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'{\n  "name": "Kitchen Operations",\n  "code": "KIT"\n}'}
            className="font-mono text-[12.5px]"
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<Send className="h-3.5 w-3.5" />} loading={sending} disabled={!apiKey.trim() || !path.trim()} onClick={send}>
            Send request
          </Button>
          {result && (
            <span className="text-[12.5px] text-[var(--text-muted)]">
              <Badge tone={result.ok ? "success" : result.status === 0 ? "warning" : "danger"}>
                {result.status === 0 ? "No response" : `${result.status}`}
              </Badge>{" "}
              in {result.ms} ms
            </span>
          )}
        </div>

        {result && <CodeBlock language={result.ok ? "json" : "text"} code={result.text.slice(0, 20000)} />}

        {!result && (
          <Callout tone="info">
            A 401 means the key is wrong, expired or revoked. A 403 means the key is valid but was not given that permission — every
            endpoint below lists the one it needs.
          </Callout>
        )}
      </div>
    </Card>
  );
}

// ── Authentication ──────────────────────────────────────────────────────────

function Authentication({ baseUrl }: { baseUrl: string }) {
  return (
    <Card id="api-auth" className="scroll-mt-20">
      <CardHeader title="Authentication" description="One header. No OAuth dance, no token refresh, no session to keep alive." />

      <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
        <CodeBlock language="http" code={`GET ${baseUrl}/employees HTTP/1.1\nx-api-key: ct_live_a1b2c3_JmK9…\nAccept: application/json`} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Fact title="Key format" body={<>Keys look like <code className="font-mono text-[12.5px]">ct_live_a1b2c3_…</code>. The middle segment is a public prefix used to identify the key in the list; the last is the secret half we never store in the clear.</>} />
          <Fact title="Scopes" body="A key carries a fixed set of permissions, chosen when it was created. It can never gain more, and it cannot be used to create other keys or webhooks — a leaked key cannot mint a replacement for itself." />
          <Fact title="Tenancy" body="A key belongs to one organization. Every request it makes is scoped to that organization by the data layer, so there is no organization id to pass and no way to read another tenant's data." />
          <Fact title="Expiry and revocation" body="Optionally give a key an expiry date. Revoking one takes effect on the very next request — there is no cache to wait out." />
        </div>

        <Callout tone="warning" title="Treat a key like a password">
          Put it in an environment variable, never in front-end code, a public repository, or a URL query string. Anything with the key can
          do everything the key was granted, from anywhere.
        </Callout>

        <p>
          People sign in differently: the web and mobile apps use <code className="font-mono text-[12.5px]">POST /auth/login</code> and a
          bearer token that expires. Use API keys for server-to-server work — they do not expire on a timer and are not tied to one person
          leaving the company.
        </p>
      </div>
    </Card>
  );
}

function Fact({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-[13px] font-semibold text-[var(--text)]">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

// ── Responses ───────────────────────────────────────────────────────────────

function Responses() {
  return (
    <Card id="api-responses" className="scroll-mt-20">
      <CardHeader title="Responses and errors" description="Both shapes are fixed, so error handling is written once." />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-[var(--text)]">Success</p>
          <CodeBlock language="json" code={`{\n  "success": true,\n  "data": { "id": "6a9d…", "name": "Kitchen Operations" }\n}`} />
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-[var(--text)]">Failure</p>
          <CodeBlock
            language="json"
            code={`{\n  "success": false,\n  "error": {\n    "code": "VALIDATION_ERROR",\n    "message": "Enter a company name",\n    "details": [{ "field": "name", "message": "Required" }]\n  },\n  "requestId": "ea4791db-a21c-41ce-907d-ab6a43b13022"\n}`}
          />
        </div>
      </div>

      <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
        Check the HTTP status first and <code className="font-mono text-[12.5px]">error.code</code> second — the code is stable and safe to
        branch on, while <code className="font-mono text-[12.5px]">message</code> is written for a person and may be reworded. Quote{" "}
        <code className="font-mono text-[12.5px]">requestId</code> when reporting a problem: it finds the exact request in the server log.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11.5px] uppercase tracking-wide text-[var(--text-subtle)]">
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Means</th>
              <th className="py-2 font-medium">Do this</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {[
              ["200 / 201", "It worked.", "Read data."],
              ["202", "Accepted and queued — payroll processing, bulk generation.", "Poll the resource until its status changes."],
              ["400", "The request itself is malformed.", "Check the JSON body and content type."],
              ["401", "No key, or the key is wrong, expired or revoked.", "Check the x-api-key header."],
              ["403", "Valid key, missing permission.", "Grant the scope the endpoint lists, or use a key that has it."],
              ["404", "No such record — or one in another tenant.", "Check the id. We return 404 rather than 403 so ids cannot be probed."],
              ["409", "Conflict with the current state.", "Read the message: usually an already-approved run, or a duplicate."],
              ["422", "Validation failed.", "Fix the fields named in error.details."],
              ["429", "Rate limited.", "Back off and retry; see the limits below."],
              ["5xx", "Our fault.", "Retry with backoff, then send us the requestId."],
            ].map(([status, means, todo]) => (
              <tr key={status}>
                <td className="py-2 pr-4 font-mono text-[12.5px] text-[var(--text)]">{status}</td>
                <td className="py-2 pr-4 text-[var(--text-muted)]">{means}</td>
                <td className="py-2 text-[var(--text-muted)]">{todo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Callout tone="info" className="mt-4" title="Rate limits">
        300 requests a minute per IP by default, and tighter buckets on sign-in and on heavy exports. A 429 is not a ban — wait for the
        window to roll over and continue. If a bulk job needs more, batch it or ask us to raise the limit for your key.
      </Callout>
    </Card>
  );
}

// ── Lists ───────────────────────────────────────────────────────────────────

function Lists({ baseUrl }: { baseUrl: string }) {
  return (
    <Card id="api-lists" className="scroll-mt-20">
      <CardHeader title="Lists, paging and filters" description="Every list endpoint takes the same parameters." />

      <div className="mt-4 space-y-3">
        <CodeBlock
          language="bash"
          code={`# page and size (limit is capped per endpoint, usually 100)\ncurl "${baseUrl}/employees?page=2&limit=50" -H "x-api-key: $KEY"\n\n# free-text search across the sensible fields\ncurl "${baseUrl}/employees?q=priya" -H "x-api-key: $KEY"\n\n# sort: prefix with - for descending\ncurl "${baseUrl}/employees?sort=-createdAt" -H "x-api-key: $KEY"\n\n# filters vary by endpoint and are documented per endpoint\ncurl "${baseUrl}/employees?status=active&departmentId=6a9d9f46…" -H "x-api-key: $KEY"`}
        />
        <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          Paged responses carry <code className="font-mono text-[12.5px]">meta.page</code>,{" "}
          <code className="font-mono text-[12.5px]">meta.limit</code>, <code className="font-mono text-[12.5px]">meta.total</code>,{" "}
          <code className="font-mono text-[12.5px]">meta.totalPages</code>, <code className="font-mono text-[12.5px]">meta.hasNext</code> and{" "}
          <code className="font-mono text-[12.5px]">meta.hasPrev</code>. Loop until{" "}
          <code className="font-mono text-[12.5px]">hasNext</code> is false rather than guessing a page count.
        </p>
        <CodeTabs
          samples={[
            {
              label: "JavaScript",
              language: "javascript",
              code: `async function* allEmployees(key) {\n  let page = 1;\n  for (;;) {\n    const res = await fetch(\n      \`${baseUrl}/employees?page=\${page}&limit=100\`,\n      { headers: { "x-api-key": key } }\n    );\n    const body = await res.json();\n    if (!body.success) throw new Error(body.error.message);\n\n    yield* body.data;\n    if (!body.meta.hasNext) return;\n    page += 1;\n  }\n}`,
            },
            {
              label: "Python",
              language: "python",
              code: `def all_employees(key):\n    page = 1\n    while True:\n        res = requests.get(\n            "${baseUrl}/employees",\n            headers={"x-api-key": key},\n            params={"page": page, "limit": 100},\n            timeout=30,\n        )\n        body = res.json()\n        if not body["success"]:\n            raise RuntimeError(body["error"]["message"])\n\n        yield from body["data"]\n        if not body["meta"]["hasNext"]:\n            return\n        page += 1`,
            },
          ]}
        />
      </div>
    </Card>
  );
}

// ── Endpoint reference ──────────────────────────────────────────────────────

function EndpointReference({ catalogue, isLoading, baseUrl }: { catalogue?: Catalogue; isLoading: boolean; baseUrl: string }) {
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!catalogue) return [];
    const text = query.trim().toLowerCase();
    if (!text) return catalogue.groups;
    return catalogue.groups
      .map((group) => ({
        ...group,
        endpoints: group.endpoints.filter((e) =>
          `${e.method} ${e.path} ${e.description} ${e.scopes.join(" ")}`.toLowerCase().includes(text)
        ),
      }))
      .filter((group) => group.endpoints.length > 0);
  }, [catalogue, query]);

  return (
    <Card id="api-endpoints" className="scroll-mt-20">
      <CardHeader
        title="Endpoint reference"
        description={
          catalogue
            ? `All ${catalogue.endpointCount} endpoints across ${catalogue.groupCount} modules, read from the server itself — so this list cannot drift from what the API actually serves.`
            : "Every endpoint this API serves, with the permission each one needs."
        }
      />

      <div className="mt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) setOpenGroup(null);
            }}
            placeholder="Search endpoints — try leave, payslip, POST, employee.view"
            aria-label="Search endpoints"
            className="w-full rounded-lg border bg-[var(--surface)] py-2 pl-9 pr-3 text-[13.5px] text-[var(--text)] outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4">
          <PageLoader label="Loading the endpoint list" />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((group) => {
            const expanded = Boolean(query.trim()) || openGroup === group.prefix;
            return (
              <div key={group.prefix} className="overflow-hidden rounded-lg border border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setOpenGroup(expanded && !query.trim() ? null : group.prefix)}
                  className="flex w-full items-center gap-3 bg-[var(--surface-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-[var(--text)]">
                      {group.title} <code className="ml-1 font-mono text-[12px] font-normal text-[var(--text-subtle)]">{group.prefix}</code>
                    </p>
                    {group.blurb && <p className="truncate text-[12.5px] text-[var(--text-muted)]">{group.blurb}</p>}
                  </div>
                  <Badge tone="neutral">{group.endpoints.length}</Badge>
                </button>

                {expanded && (
                  <ul className="divide-y">
                    {group.endpoints.map((endpoint) => (
                      <li key={`${endpoint.method} ${endpoint.path}`} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                        <span
                          className={cn(
                            "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                            METHOD_TONE[endpoint.method] || "border-[var(--border)] text-[var(--text-muted)]"
                          )}
                        >
                          {endpoint.method}
                        </span>
                        <div className="min-w-0 flex-1">
                          <code className="break-all font-mono text-[12.5px] text-[var(--text)]">{endpoint.path}</code>
                          <p className="text-[12.5px] text-[var(--text-muted)]">{endpoint.description}</p>
                        </div>
                        <span className="shrink-0 text-right text-[11.5px] text-[var(--text-subtle)]">
                          {endpoint.scopes.length ? (
                            <span title={`Needs ${endpoint.scopeMode === "any" ? "any one" : "all"} of these permissions`}>
                              {endpoint.scopes.join(endpoint.scopeMode === "any" ? " or " : " + ")}
                            </span>
                          ) : (
                            "any valid key"
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">Nothing matched that search.</p>
          )}
        </div>
      )}

      <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
        Paths shown with <code className="font-mono">:id</code> take a record id in that position, for example{" "}
        <code className="font-mono">{baseUrl}/employees/6a9d9f628e4e6d5911a5cdae</code>.
      </p>
    </Card>
  );
}

// ── Webhooks ────────────────────────────────────────────────────────────────

function Webhooks() {
  return (
    <Card id="api-webhooks" className="scroll-mt-20">
      <CardHeader
        title="Webhooks"
        description="Instead of polling us, let us call you the moment something happens — a joiner, an approved leave, a published payroll."
      />

      <div className="mt-4 space-y-4">
        <ol className="space-y-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          <li>
            <strong className="text-[var(--text)]">1.</strong> Have a URL that accepts <code className="font-mono text-[12.5px]">POST</code>{" "}
            with a JSON body and answers <code className="font-mono text-[12.5px]">200</code> quickly. Do the slow work after replying.
          </li>
          <li>
            <strong className="text-[var(--text)]">2.</strong> Add it in the <strong className="text-[var(--text)]">Webhooks</strong> tab and
            pick the events you want. Copy the signing secret shown once at creation.
          </li>
          <li>
            <strong className="text-[var(--text)]">3.</strong> Press <strong className="text-[var(--text)]">Test</strong> there to send a
            synthetic event and confirm your endpoint answers.
          </li>
          <li>
            <strong className="text-[var(--text)]">4.</strong> Verify the signature on every delivery before trusting the body.
          </li>
        </ol>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-[var(--text)]">What we send</p>
          <CodeBlock
            language="http"
            code={`POST /your/webhook HTTP/1.1\nContent-Type: application/json\nUser-Agent: ChefoTech-HRMS-Webhooks/1.0\nX-Chefotech-Event: leave.approved\nX-Chefotech-Delivery: 6a9da0c18e4e6d5911a5d2f4\nX-Chefotech-Timestamp: 1788712345\nX-Chefotech-Signature: v1=6f3c…9ab2\n\n{\n  "event": "leave.approved",\n  "organizationId": "6a9d9f3d8e4e6d5911a5cce3",\n  "sentAt": "2026-09-06T17:52:25.412Z",\n  "data": { "employee": { "name": "Priya Nair" }, "leave": { "days": 2 } },\n  "entity": { "type": "LeaveRequest", "id": "6a9da0…" }\n}`}
          />
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-[var(--text)]">Verifying the signature</p>
          <p className="mb-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
            The signature is <code className="font-mono text-[12.5px]">HMAC-SHA256</code> over{" "}
            <code className="font-mono text-[12.5px]">{"<timestamp>.<raw body>"}</code>, keyed with the webhook secret, hex-encoded and
            prefixed with <code className="font-mono text-[12.5px]">v1=</code>. Use the <em>raw</em> body, not a re-serialised object —
            re-encoding changes bytes and breaks the comparison.
          </p>
          <CodeTabs
            samples={[
              {
                label: "Node / Express",
                language: "javascript",
                code: `const crypto = require("node:crypto");\nconst express = require("express");\n\nconst app = express();\nconst SECRET = process.env.CHEFOTECH_WEBHOOK_SECRET;\n\n// The raw body is required — express.json() alone would discard it.\napp.post("/webhooks/chefotech", express.raw({ type: "application/json" }), (req, res) => {\n  const timestamp = req.get("X-Chefotech-Timestamp");\n  const signature = req.get("X-Chefotech-Signature") || "";\n  const raw = req.body.toString("utf8");\n\n  const expected =\n    "v1=" +\n    crypto.createHmac("sha256", SECRET).update(\`\${timestamp}.\${raw}\`).digest("hex");\n\n  const ok =\n    signature.length === expected.length &&\n    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));\n\n  if (!ok) return res.status(401).send("bad signature");\n\n  // Answer first, work afterwards: we time out after 10 seconds.\n  res.sendStatus(200);\n\n  const event = JSON.parse(raw);\n  handle(event).catch(console.error);\n});`,
              },
              {
                label: "Python / Flask",
                language: "python",
                code: `import hmac, hashlib, os\nfrom flask import Flask, request, abort\n\napp = Flask(__name__)\nSECRET = os.environ["CHEFOTECH_WEBHOOK_SECRET"].encode()\n\n@app.post("/webhooks/chefotech")\ndef chefotech():\n    timestamp = request.headers.get("X-Chefotech-Timestamp", "")\n    signature = request.headers.get("X-Chefotech-Signature", "")\n    raw = request.get_data()  # bytes, exactly as sent\n\n    expected = "v1=" + hmac.new(\n        SECRET, f"{timestamp}.".encode() + raw, hashlib.sha256\n    ).hexdigest()\n\n    if not hmac.compare_digest(signature, expected):\n        abort(401)\n\n    event = request.get_json()\n    # queue the work; reply immediately\n    return "", 200`,
              },
              {
                label: "PHP",
                language: "php",
                code: `<?php\n$secret    = getenv("CHEFOTECH_WEBHOOK_SECRET");\n$timestamp = $_SERVER["HTTP_X_CHEFOTECH_TIMESTAMP"] ?? "";\n$signature = $_SERVER["HTTP_X_CHEFOTECH_SIGNATURE"] ?? "";\n$raw       = file_get_contents("php://input");\n\n$expected = "v1=" . hash_hmac("sha256", $timestamp . "." . $raw, $secret);\n\nif (!hash_equals($expected, $signature)) {\n    http_response_code(401);\n    exit("bad signature");\n}\n\nhttp_response_code(200);\n$event = json_decode($raw, true);\n// handle $event["event"] and $event["data"]`,
              },
            ]}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Fact
            title="Retries"
            body="A delivery that does not answer 2xx within 10 seconds is retried up to five times with growing gaps. Every attempt is recorded — open Deliveries on the webhook to see status, response code and body."
          />
          <Fact
            title="Automatic pausing"
            body="After twenty consecutive failures a webhook is switched off so a dead endpoint stops generating work. Fix it, then resume it from the list."
          />
          <Fact
            title="Duplicates"
            body="A retry can deliver an event you already processed. Treat X-Chefotech-Delivery as an idempotency key and ignore ids you have seen."
          />
          <Fact
            title="Testing locally"
            body="Your machine has no public URL. Use a tunnel (ngrok, Cloudflare Tunnel) or a throwaway inbox like webhook.site to see the exact bytes we send, then point the webhook at your server."
          />
        </div>

        <Callout tone="info" icon={<WebhookIcon className="h-4 w-4" />}>
          The events list in the Webhooks tab is the full catalogue — every notification the platform can raise is available as a webhook,
          and subscribing to <code className="font-mono text-[12.5px]">*</code> means new events reach you without any change here.
        </Callout>
      </div>
    </Card>
  );
}

// ── Tools ───────────────────────────────────────────────────────────────────

function Tools({ baseUrl, orgName }: { baseUrl: string; orgName: string }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      await api.download("/integrations/postman-collection", undefined, "chefotech-hrms-api.postman_collection.json");
      toast.success("Collection downloaded", "Import it in Postman, then paste your key into the apiKey variable.");
    } catch (error) {
      toast.fromError(error, "Could not download the collection.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card id="api-tools" className="scroll-mt-20">
      <CardHeader
        title="Postman and other tools"
        description="A ready collection of every endpoint, so testing takes a paste rather than a build."
        action={
          <Button icon={<Download className="h-4 w-4" />} loading={downloading} onClick={download}>
            Download Postman collection
          </Button>
        }
      />

      <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-[var(--text)]">Postman, in four steps</p>
          <ol className="ml-1 space-y-1.5 border-l-2 border-[var(--border)] pl-4">
            <li>Download the collection above. It is named for {orgName} and already contains every endpoint, grouped by module.</li>
            <li>
              In Postman choose <strong className="text-[var(--text)]">Import</strong> and drop the file in.
            </li>
            <li>
              Open the collection&apos;s <strong className="text-[var(--text)]">Variables</strong> tab. Paste your key into{" "}
              <code className="font-mono text-[12.5px]">apiKey</code> and check that <code className="font-mono text-[12.5px]">baseUrl</code>{" "}
              reads <code className="font-mono text-[12.5px]">{baseUrl}</code>. Save.
            </li>
            <li>
              Open <em>Employees → GET /employees</em> and press Send. A 200 with a list means you are connected; every other request in the
              collection now works the same way.
            </li>
          </ol>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Fact title="Insomnia, Bruno, Hoppscotch" body="All of them import a Postman v2.1 collection. Use the same file." />
          <Fact
            title="VS Code REST Client / Thunder Client"
            body={<>Paste the curl examples above straight in — they are plain HTTP with one header.</>}
          />
          <Fact
            title="Spreadsheets and no-code tools"
            body="Zapier, Make, n8n and Google Apps Script all support a custom HTTP request with a header. That is all this API needs."
          />
          <Fact title="Your own code" body="No SDK is required. Any HTTP client works, and the response shape is the same everywhere." />
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-[var(--text)]">A working end-to-end example</p>
          <p className="mb-2">Create a department, then read it back — the shape of nearly every write in the API.</p>
          <CodeBlock
            language="bash"
            code={`KEY="ct_live_xxxxxx_your_key_here"\n\n# create\ncurl -X POST "${baseUrl}/departments" \\\n  -H "x-api-key: $KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Kitchen Operations","code":"KIT"}'\n\n# read the list back\ncurl "${baseUrl}/departments" -H "x-api-key: $KEY"`}
          />
        </div>
      </div>
    </Card>
  );
}

// ── Troubleshooting ─────────────────────────────────────────────────────────

function Troubleshooting() {
  const items: [string, React.ReactNode][] = [
    [
      "401 on every request",
      <>
        The header name is <code className="font-mono text-[12.5px]">x-api-key</code> — not{" "}
        <code className="font-mono text-[12.5px]">Authorization</code>. Check for a stray space or a truncated paste: a key is long, and
        terminals wrap it.
      </>,
    ],
    [
      "403 with a valid key",
      <>
        The key is missing that permission. Every endpoint above names the one it needs. Keys cannot be edited after creation — create a new
        one with the right scopes and revoke the old.
      </>,
    ],
    [
      "403 on /integrations/*",
      "Keys and webhooks can only be managed by a signed-in person in the web app. That is deliberate: a leaked key must not be able to create more keys.",
    ],
    [
      "404 on a record you can see in the app",
      "The id belongs to another organization, or it was soft-deleted. We answer 404 rather than 403 so ids cannot be probed for existence.",
    ],
    [
      "422 with no obvious cause",
      <>
        Read <code className="font-mono text-[12.5px]">error.details</code> — it names the exact field. The most common cause is a date sent
        as <code className="font-mono text-[12.5px]">DD-MM-YYYY</code>; use <code className="font-mono text-[12.5px]">YYYY-MM-DD</code>.
      </>,
    ],
    [
      "The first request after a quiet period is slow",
      "On smaller hosting plans the server sleeps when idle and takes up to a minute to wake. Set a client timeout of at least 60 seconds, or keep it warm with a periodic call.",
    ],
    [
      "Webhook never arrives",
      "Check Deliveries on the webhook: if attempts are listed with a non-2xx code, the problem is at your end. If there are none, the event was not subscribed — or the webhook was paused after repeated failures.",
    ],
    [
      "Signature never matches",
      "Almost always because the body was parsed and re-serialised before hashing. Hash the raw bytes, and include the timestamp and the dot.",
    ],
  ];

  return (
    <Card id="api-trouble" className="scroll-mt-20">
      <CardHeader title="Troubleshooting" description="The failures integrators actually hit, and what each one means." />
      <dl className="mt-4 divide-y">
        {items.map(([question, answer]) => (
          <div key={question} className="py-3">
            <dt className="text-[13.5px] font-semibold text-[var(--text)]">{question}</dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">{answer}</dd>
          </div>
        ))}
      </dl>

      <Callout tone="info" className="mt-4" icon={<BookOpen className="h-4 w-4" />}>
        Still stuck? The written guides live in the{" "}
        <Link href="/app/help" className="font-medium underline">
          help centre
        </Link>{" "}
        under Developers and API, and the help button in the top bar answers questions in your own words.
      </Callout>
    </Card>
  );
}
