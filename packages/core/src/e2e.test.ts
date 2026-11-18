// Live end-to-end check against a running Pinpost server (go run ./cmd/server).
// Mirrors the Go contract test's skip-if-down behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "./index.js";

const API = process.env.PINPOST_API_URL ?? "http://localhost:8787";
const WRITE_KEY = process.env.PINPOST_WRITE_KEY ?? "wk_demo_5f8a2c91d4e7b3a6f0c1";

const serverUp = await fetch(`${API}/v1/sdk/config`, {
  headers: { "X-Pinpost-Write-Key": WRITE_KEY },
}).then((r) => r.ok, () => false);

test("live: submit feedback with attachment, visible in dashboard", { skip: !serverUp && "server not running" }, async () => {
  const client = createClient({ writeKey: WRITE_KEY, apiUrl: API });
  const config = await client.getConfig();
  assert.ok(config.environment);

  client.identify({ externalUserId: "e2e-user", email: "e2e@example.com" });
  client.setContext({ platform: "node-e2e", password: "must-be-stripped" });

  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(60).fill(0x78)]);
  const attachmentId = await client.uploadAttachment({ name: "e2e.png", mimeType: "image/png", data: png });

  // The bytes went straight to object storage. In a deployed stack the bucket's
  // ObjectCreated event runs the scan; locally there is no event wiring, so the
  // dev route the server exposes for exactly this runs it inline.
  const scanned = await fetch(`${API}/dev/scan/${attachmentId}`, { method: "POST" });
  assert.equal(scanned.status, 200, "dev scan route (local server only) must be reachable");

  const result = await client.submit({
    type: "bug",
    message: "sdk core live e2e",
    rating: 4,
    attachment_ids: [attachmentId],
  });
  assert.ok(result.feedback_id);

  // Verify through the dashboard API that the record actually landed.
  const login = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "pinpost-demo" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const detail = await fetch(`${API}/v1/feedback/${result.feedback_id}`, { headers: { cookie } });
  assert.equal(detail.status, 200);
  const fb = await detail.json();
  assert.equal(fb.message, "sdk core live e2e");
  assert.equal(fb.attachments.length, 1);
  assert.equal(fb.attachments[0].scan_status, "clean");
  assert.ok(!JSON.stringify(fb.context ?? {}).includes("must-be-stripped"));
});
