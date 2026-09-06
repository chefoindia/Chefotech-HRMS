import type { DocArticle } from "./docs";

/**
 * Developer documentation, kept beside the rest of the docs but in its own
 * file because it is the only category that is mostly code.
 *
 * The examples are written to be pasted and run. Where a value differs per
 * deployment — the base URL above all — the article says so and points at
 * Settings → API & webhooks, which shows the real one for that server with a
 * copy button. A doc that hard-codes our hostname is wrong for every
 * self-hosted customer reading it.
 */

const BASE = "https://your-api-host/api/v1";

export const DEVELOPER_ARTICLES: DocArticle[] = [
  {
    slug: "api-quick-start",
    title: "Connecting to the API",
    summary: "The base URL, the one header that authenticates you, and a first working request in four languages.",
    category: "developers",
    appPath: "/app/settings/integrations",
    sections: [
      {
        heading: "What the API is for",
        body: [
          "Everything the web app can do, another system can do too — read employees, push attendance from a turnstile, pull payslips into an accounting package, raise a leave request from an intranet. The web app is itself built on this API, so nothing is held back for internal use.",
          "There are two ways to authenticate. People sign in with an email and password and receive a token that expires. Programs use an API key: one header, no expiry timer, and not tied to an individual who might leave the company. Use a key for anything unattended.",
        ],
      },
      {
        heading: "Find your base URL",
        body: [
          "Every path here is relative to your base URL — your API host followed by the version prefix. Open Settings → API & webhooks in the app: the guide there shows the exact base URL for your deployment with a copy button, because a self-hosted customer's differs from ours.",
          {
            language: "text",
            code: BASE,
            caption: `So /employees means ${BASE}/employees`,
          },
        ],
      },
      {
        heading: "Create a key",
        body: [
          "In Settings → API & webhooks → API keys, create one and tick only the permissions the integration needs. A key can never do more than the person who created it, and a narrow key limits the damage if it leaks.",
          "The key is shown once, at creation. We store only a hash of it, so it cannot be revealed again — copy it into your password manager or your server's environment variables straight away. If you lose it, revoke it and create another.",
        ],
      },
      {
        heading: "Your first request",
        body: [
          "Send the key in an x-api-key header. This lists five employees, which is the fastest proof that the key works and has read access.",
          {
            language: "bash",
            code: [
              `curl "${BASE}/employees?limit=5" \\`,
              '  -H "x-api-key: ct_live_xxxxxx_your_key_here"',
            ].join("\n"),
          },
          {
            language: "javascript",
            code: [
              `const res = await fetch("${BASE}/employees?limit=5", {`,
              '  headers: { "x-api-key": process.env.CHEFOTECH_API_KEY },',
              "});",
              "",
              "const body = await res.json();",
              "if (!body.success) throw new Error(body.error.message);",
              "console.log(body.data, body.meta);",
            ].join("\n"),
          },
          {
            language: "python",
            code: [
              "import os, requests",
              "",
              "res = requests.get(",
              `    "${BASE}/employees",`,
              '    headers={"x-api-key": os.environ["CHEFOTECH_API_KEY"]},',
              '    params={"limit": 5},',
              "    timeout=60,",
              ")",
              "body = res.json()",
              'if not body["success"]:',
              '    raise RuntimeError(body["error"]["message"])',
              'print(body["data"])',
            ].join("\n"),
          },
          {
            language: "php",
            code: [
              "<?php",
              `$ch = curl_init("${BASE}/employees?limit=5");`,
              "curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);",
              'curl_setopt($ch, CURLOPT_HTTPHEADER, ["x-api-key: " . getenv("CHEFOTECH_API_KEY")]);',
              "$body = json_decode(curl_exec($ch), true);",
              "curl_close($ch);",
              "",
              'print_r($body["data"]);',
            ].join("\n"),
          },
        ],
      },
      {
        heading: "What comes back",
        body: [
          "Every response uses the same envelope, so one parser handles all of them. Rows are in data; paging is in meta.",
          {
            language: "json",
            code: [
              "{",
              '  "success": true,',
              '  "data": [{ "id": "6a9d…", "employeeCode": "EMP0001", "fullName": "Rohan Deshmukh" }],',
              '  "meta": { "page": 1, "limit": 5, "total": 12, "totalPages": 3, "hasNext": true, "hasPrev": false }',
              "}",
            ].join("\n"),
          },
          "Failures use the same envelope with success false. Branch on error.code, which is stable, rather than on message, which is written for people and may be reworded.",
          {
            language: "json",
            code: [
              "{",
              '  "success": false,',
              '  "error": {',
              '    "code": "VALIDATION_ERROR",',
              '    "message": "Enter a company name",',
              '    "details": [{ "field": "name", "message": "Required" }]',
              "  },",
              '  "requestId": "ea4791db-a21c-41ce-907d-ab6a43b13022"',
              "}",
            ].join("\n"),
          },
          "Quote requestId when reporting a problem — it locates the exact request in the server log.",
        ],
      },
      {
        heading: "Paging through a list",
        body: [
          "List endpoints all take the same parameters: page, limit, q for free-text search, and sort with a leading minus for descending. Loop until meta.hasNext is false rather than guessing how many pages there are.",
          {
            language: "javascript",
            code: [
              "async function* allEmployees(key) {",
              "  let page = 1;",
              "  for (;;) {",
              `    const url = "${BASE}/employees?limit=100&page=" + page;`,
              '    const res = await fetch(url, { headers: { "x-api-key": key } });',
              "    const body = await res.json();",
              "",
              "    yield* body.data;",
              "    if (!body.meta.hasNext) return;",
              "    page += 1;",
              "  }",
              "}",
            ].join("\n"),
          },
        ],
      },
      {
        heading: "Status codes worth knowing",
        body: [
          [
            "401 — no key, or it is wrong, expired or revoked. Check the header name is exactly x-api-key.",
            "403 — the key is valid but was not granted that permission. The in-app endpoint reference names the one each endpoint needs.",
            "404 — no such record, or it belongs to another organization. We answer 404 rather than 403 so ids cannot be probed for existence.",
            "422 — validation failed; error.details names the field.",
            "429 — rate limited. The default is 300 requests a minute per IP; wait for the window to roll over and continue.",
            "202 — accepted and queued, used by long jobs such as payroll processing. Poll the resource until its status changes.",
          ],
        ],
      },
    ],
    related: ["api-keys", "webhooks", "api-testing"],
  },

  {
    slug: "api-keys",
    title: "API keys and permissions",
    summary: "How keys are scoped, why a valid key can still be refused, and how to rotate one safely.",
    category: "developers",
    appPath: "/app/settings/integrations",
    sections: [
      {
        heading: "A key is a program's identity",
        body: [
          "A key looks like ct_live_a1b2c3_… — the middle segment is a public prefix shown in the key list so you can tell keys apart, and the last segment is the secret half, which we store only as a hash.",
          "Each key belongs to one organization. Every request it makes is scoped to that organization by the data layer itself, so there is no organization id to pass and no way for a key to read another tenant's records, even by guessing ids.",
        ],
      },
      {
        heading: "Scopes: why a valid key gets a 403",
        body: [
          "When you create a key you tick permissions from the same catalogue that roles use. The key gets exactly those and can never gain more. A 401 means the key is not recognised; a 403 means it is recognised but lacks the permission that endpoint requires.",
          "You can only grant permissions you hold yourself. An HR manager who cannot read payroll cannot create a key that reads payroll — which stops a key being used to climb out of a role.",
          "Grant the minimum. A key that only reads the directory cannot leak salaries even if it is committed to a public repository.",
        ],
      },
      {
        heading: "What a key can never do",
        body: [
          "Keys cannot manage keys or webhooks. Every /integrations endpoint refuses an API key and requires a signed-in person in the web app. That is deliberate: a leaked key must not be able to mint a quieter replacement for itself, or point a webhook at an attacker's server.",
        ],
      },
      {
        heading: "Rotating and revoking",
        body: [
          "Scopes are fixed once a key exists. To change what a key can do, create a new one with the right scopes, deploy it, then revoke the old one.",
          "Revocation takes effect on the very next request; there is no cache to wait out. The key list shows when each key was last used and from which address, so you can confirm nothing still depends on a key before revoking it.",
          "Set an expiry date on keys given to a contractor or a trial integration and they stop working on their own.",
        ],
      },
      {
        heading: "Keeping a key safe",
        body: [
          [
            "Store it in an environment variable or a secret manager, never in source control.",
            "Never put a key in front-end JavaScript or inside a mobile app — anything a browser can read, a user can read.",
            "Never put a key in a URL query string; URLs are logged by proxies, browsers and error trackers.",
            "Use a separate key per integration, so revoking one does not break the others.",
          ],
        ],
      },
    ],
    related: ["api-quick-start", "webhooks", "roles-and-permissions"],
  },

  {
    slug: "webhooks",
    title: "Webhooks: getting events pushed to you",
    summary: "Be told the moment something happens instead of polling — with signature verification you can copy.",
    category: "developers",
    appPath: "/app/settings/integrations",
    sections: [
      {
        heading: "Polling versus being told",
        body: [
          "Without webhooks an integration has to ask 'has anything changed?' on a timer — wasteful when nothing has, and slow when something has. A webhook reverses that: the moment a leave request is approved or a payroll run is published, we POST the event to a URL you own.",
          "Every notification the platform can raise is available as a webhook. Subscribing to * means events added in future reach you without any change on your side.",
        ],
      },
      {
        heading: "Setting one up",
        body: [
          [
            "1. Build an endpoint that accepts POST with a JSON body and answers 200 quickly. Do the slow work after replying — we time out after ten seconds.",
            "2. In Settings → API & webhooks → Webhooks, add the URL and tick the events you want.",
            "3. Copy the signing secret shown once at creation.",
            "4. Press Test to send a synthetic event and confirm your endpoint answers.",
          ],
        ],
      },
      {
        heading: "What a delivery looks like",
        body: [
          {
            language: "http",
            code: [
              "POST /your/webhook HTTP/1.1",
              "Content-Type: application/json",
              "User-Agent: ChefoTech-HRMS-Webhooks/1.0",
              "X-Chefotech-Event: leave.approved",
              "X-Chefotech-Delivery: 6a9da0c18e4e6d5911a5d2f4",
              "X-Chefotech-Timestamp: 1788712345",
              "X-Chefotech-Signature: v1=6f3c…9ab2",
              "",
              "{",
              '  "event": "leave.approved",',
              '  "organizationId": "6a9d9f3d8e4e6d5911a5cce3",',
              '  "sentAt": "2026-09-06T17:52:25.412Z",',
              '  "data": { "employee": { "name": "Priya Nair" }, "leave": { "days": 2 } },',
              '  "entity": { "type": "LeaveRequest", "id": "6a9da0…" }',
              "}",
            ].join("\n"),
          },
        ],
      },
      {
        heading: "Verify the signature before trusting anything",
        body: [
          "Your webhook URL is reachable by anyone who learns it. The signature is what proves a delivery came from us: HMAC-SHA256 over the timestamp, a dot, and the raw request body, keyed with the webhook secret, hex-encoded and prefixed with v1=.",
          "Hash the raw bytes. Parsing the JSON and re-serialising it changes the bytes, and the signature will never match — this is the single most common integration mistake.",
          {
            language: "javascript",
            caption: "Node and Express",
            code: [
              'const crypto = require("node:crypto");',
              'const express = require("express");',
              "",
              "const app = express();",
              "const SECRET = process.env.CHEFOTECH_WEBHOOK_SECRET;",
              "",
              "// express.raw keeps the body as bytes; express.json would discard them.",
              'app.post("/webhooks/chefotech", express.raw({ type: "application/json" }), (req, res) => {',
              '  const timestamp = req.get("X-Chefotech-Timestamp");',
              '  const signature = req.get("X-Chefotech-Signature") || "";',
              '  const raw = req.body.toString("utf8");',
              "",
              '  const expected = "v1=" + crypto',
              '    .createHmac("sha256", SECRET)',
              '    .update(timestamp + "." + raw)',
              '    .digest("hex");',
              "",
              "  const ok =",
              "    signature.length === expected.length &&",
              "    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));",
              "",
              '  if (!ok) return res.status(401).send("bad signature");',
              "",
              "  res.sendStatus(200);         // answer first",
              "  handle(JSON.parse(raw));     // work afterwards",
              "});",
            ].join("\n"),
          },
          {
            language: "python",
            caption: "Python and Flask",
            code: [
              "import hmac, hashlib, os",
              "from flask import Flask, request, abort",
              "",
              "app = Flask(__name__)",
              'SECRET = os.environ["CHEFOTECH_WEBHOOK_SECRET"].encode()',
              "",
              '@app.post("/webhooks/chefotech")',
              "def chefotech():",
              '    timestamp = request.headers.get("X-Chefotech-Timestamp", "")',
              '    signature = request.headers.get("X-Chefotech-Signature", "")',
              "    raw = request.get_data()  # bytes, exactly as sent",
              "",
              '    signed = timestamp.encode() + b"." + raw',
              '    expected = "v1=" + hmac.new(SECRET, signed, hashlib.sha256).hexdigest()',
              "",
              "    if not hmac.compare_digest(signature, expected):",
              "        abort(401)",
              "",
              "    # queue the work, reply immediately",
              '    return "", 200',
            ].join("\n"),
          },
          {
            language: "php",
            caption: "PHP",
            code: [
              "<?php",
              '$secret    = getenv("CHEFOTECH_WEBHOOK_SECRET");',
              '$timestamp = $_SERVER["HTTP_X_CHEFOTECH_TIMESTAMP"] ?? "";',
              '$signature = $_SERVER["HTTP_X_CHEFOTECH_SIGNATURE"] ?? "";',
              '$raw       = file_get_contents("php://input");',
              "",
              '$expected = "v1=" . hash_hmac("sha256", $timestamp . "." . $raw, $secret);',
              "",
              "if (!hash_equals($expected, $signature)) {",
              "    http_response_code(401);",
              '    exit("bad signature");',
              "}",
              "",
              "http_response_code(200);",
              "$event = json_decode($raw, true);",
            ].join("\n"),
          },
        ],
      },
      {
        heading: "Retries, duplicates and pausing",
        body: [
          "A delivery that does not answer 2xx within ten seconds is retried up to five times with growing gaps. Every attempt is recorded — open Deliveries on the webhook to see the status, response code and body of each one.",
          "Because of retries you can receive the same event twice. Treat X-Chefotech-Delivery as an idempotency key: record the ids you have processed and ignore repeats.",
          "After twenty consecutive failures the webhook is switched off, so a dead endpoint stops generating work forever. Fix your endpoint, then resume it from the list.",
          "Rotating the secret invalidates the old one immediately, so update your receiver in the same maintenance window.",
        ],
      },
      {
        heading: "Testing before you have a server",
        body: [
          "Your laptop has no public URL, so we cannot reach it. Either run a tunnel — ngrok and Cloudflare Tunnel both give you a public address that forwards to localhost — or point the webhook at a throwaway inbox such as webhook.site to see the exact headers and body we send before writing any code.",
        ],
      },
    ],
    related: ["api-quick-start", "api-keys", "api-testing"],
  },

  {
    slug: "api-testing",
    title: "Testing the API with Postman, curl and the built-in console",
    summary: "Three ways to make a real call before you write any code — and what to do when one fails.",
    category: "developers",
    appPath: "/app/settings/integrations",
    sections: [
      {
        heading: "The fastest check: the built-in console",
        body: [
          "Settings → API & webhooks → Guide & testing has a request console. Paste a key, pick an endpoint from the quick list, press Send, and the real response appears with its status code and timing. Nothing is stored — the key lives in the page and is gone when you leave it.",
          "Use this first. If a call works here and fails in your code, the problem is in your code rather than in the key or its permissions, which narrows the hunt considerably.",
        ],
      },
      {
        heading: "Postman, in four steps",
        body: [
          "The same screen has a Download Postman collection button. The file is generated from the live route table, so it contains every endpoint this API serves, grouped by module, with the required permission written into each request's description.",
          [
            "1. Download the collection and import it in Postman.",
            "2. Open the collection's Variables tab.",
            "3. Paste your key into apiKey, and check that baseUrl matches your server. Save.",
            "4. Open Employees → GET /employees and press Send.",
          ],
          "A 200 with a list of employees means you are connected, and every other request in the collection now works the same way. The same file imports cleanly into Insomnia, Bruno and Hoppscotch.",
        ],
      },
      {
        heading: "curl, for a one-off check",
        body: [
          {
            language: "bash",
            code: [
              'KEY="ct_live_xxxxxx_your_key_here"',
              `BASE="${BASE}"`,
              "",
              "# read",
              'curl "$BASE/departments" -H "x-api-key: $KEY"',
              "",
              "# write",
              'curl -X POST "$BASE/departments" \\',
              '  -H "x-api-key: $KEY" \\',
              '  -H "Content-Type: application/json" \\',
              `  -d '{"name":"Kitchen Operations","code":"KIT"}'`,
              "",
              "# show status and headers when something is wrong",
              'curl -i "$BASE/employees" -H "x-api-key: $KEY"',
            ].join("\n"),
          },
        ],
      },
      {
        heading: "When it does not work",
        body: [
          [
            "401 on everything — the header is x-api-key, not Authorization. Check for a truncated paste; keys are long and terminals wrap them.",
            "403 with a valid key — the key lacks that permission. Keys cannot be edited: create a new one with the right scopes and revoke the old.",
            "403 on /integrations — keys may not manage keys or webhooks. Use the web app for that.",
            "422 you cannot explain — read error.details, it names the field. Dates must be YYYY-MM-DD.",
            "The first call after a quiet period times out — on smaller hosting plans the server sleeps when idle and takes up to a minute to wake. Allow a 60 second client timeout.",
            "Webhook signature never matches — you are hashing a re-serialised body instead of the raw bytes.",
          ],
        ],
      },
      {
        heading: "Going to production",
        body: [
          [
            "Use a separate key per integration, so one can be revoked without breaking the others.",
            "Retry 429 and 5xx with exponential backoff; do not retry 4xx, which will fail identically.",
            "Log the requestId from failed responses — it is the fastest way for us to find what happened.",
            "Page with limit=100 rather than pulling everything in one call.",
            "Prefer webhooks over polling for anything that needs to be timely.",
          ],
        ],
      },
    ],
    related: ["api-quick-start", "api-keys", "webhooks"],
  },
];
