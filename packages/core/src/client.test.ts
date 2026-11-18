import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentIdsForSubmit, attachmentSelectionNotice, browserContext, PinpostClient, PinpostError, MAX_ATTACHMENTS, MAX_ATTACHMENT_SIZE, sanitizeContext, selectAttachableFiles } from "./index.js";

type Call = { url: string; init: RequestInit };

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeClient(responses: (Response | Error)[], calls: Call[] = [], sleeps: number[] = []) {
  const client = new PinpostClient({
    writeKey: "wk_test",
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error("no more mocked responses");
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    generateId: (() => {
      let n = 0;
      return () => `key-${++n}`;
    })(),
  });
  return { client, calls, sleeps };
}

const ok = { feedback_id: "f1", created_at: "2026-01-01T00:00:00Z" };

test("validation rejects bad payloads client-side", async () => {
  const { client, calls } = makeClient([]);
  await assert.rejects(client.submit({ type: "bug", message: "" }), PinpostError);
  await assert.rejects(client.submit({ type: "nope" as never, message: "hi" }), PinpostError);
  await assert.rejects(client.submit({ type: "bug", message: "hi", rating: 6 }), PinpostError);
  await assert.rejects(client.submit({ type: "bug", message: "x".repeat(10001) }), PinpostError);
  await assert.rejects(
    client.submit({ type: "bug", message: "hi", attachment_ids: ["a", "b", "c", "d", "e", "f"] }),
    PinpostError,
  );
  assert.equal(calls.length, 0);
});

test("idempotency key is reused across retries, fresh per submit", async () => {
  const { client, calls } = makeClient([
    jsonRes(500, { error: { code: "internal", message: "boom" } }),
    jsonRes(201, ok),
    jsonRes(201, ok),
  ]);
  await client.submit({ type: "bug", message: "hi" });
  await client.submit({ type: "bug", message: "hi again" });
  const keys = calls.map((c) => (c.init.headers as Record<string, string>)["Idempotency-Key"]);
  assert.deepEqual(keys, ["key-1", "key-1", "key-2"]);
});

test("429 retries honoring Retry-After", async () => {
  const { client, calls, sleeps } = makeClient([
    jsonRes(429, { error: { code: "rate_limited", message: "slow down" } }, { "Retry-After": "2" }),
    jsonRes(201, ok),
  ]);
  const res = await client.submit({ type: "suggestion", message: "hi" });
  assert.equal(res.feedback_id, "f1");
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("network errors retry with backoff, then fail after max attempts", async () => {
  const { client, calls, sleeps } = makeClient([
    new Error("ECONNREFUSED"),
    new Error("ECONNREFUSED"),
    new Error("ECONNREFUSED"),
  ]);
  await assert.rejects(client.submit({ type: "bug", message: "hi" }), /ECONNREFUSED/);
  assert.equal(calls.length, 3);
  assert.equal(sleeps.length, 2); // no sleep after final attempt
});

test("4xx does not retry", async () => {
  const { client, calls } = makeClient([
    jsonRes(422, { error: { code: "validation_failed", message: "bad" } }),
  ]);
  await assert.rejects(client.submit({ type: "bug", message: "hi" }), (e: PinpostError) => {
    assert.equal(e.status, 422);
    assert.equal(e.code, "validation_failed");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("context blacklist keys stripped; identity/context merged into submission", async () => {
  const { client, calls } = makeClient([jsonRes(201, ok)]);
  client.identify({ externalUserId: "u1", email: "a@b.c" });
  client.setContext({ screen: "Home", Password: "hunter2", TOKEN: "t", cookie: "c" });
  await client.submit({ type: "bug", message: "hi", context: { secret: "s", release: "1.0" } });
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.context, { screen: "Home", release: "1.0" });
  assert.equal(body.external_user_id, "u1");
  assert.deepEqual(body.contact, { email: "a@b.c" });
  assert.equal(sanitizeContext(undefined), undefined);
});

test("resetUser clears identity and context", async () => {
  const { client, calls } = makeClient([jsonRes(201, ok)]);
  client.identify({ externalUserId: "u1" });
  client.setContext({ screen: "Home" });
  client.resetUser();
  await client.submit({ type: "other", message: "hi" });
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.external_user_id, undefined);
  assert.equal(body.context, undefined);
});

test("attachment flow: register then PUT bytes to object storage", async () => {
  const { client, calls } = makeClient([
    jsonRes(201, {
      attachment_id: "att-1",
      upload_url: "https://objects.example.com/bucket/proj/att-1?X-Amz-Signature=abc",
      expires_at: "2026-01-01T00:00:00Z",
    }),
    jsonRes(200, {}),
  ]);
  const id = await client.uploadAttachment({
    name: "shot.png",
    mimeType: "image/png",
    data: new Uint8Array([1, 2, 3]),
  });
  assert.equal(id, "att-1");
  assert.equal(calls[0].url, "http://localhost:8787/v1/attachment-uploads");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    original_name: "shot.png",
    mime_type: "image/png",
    size: 3,
  });
  // Absolute presigned URL: used as-is, and without Pinpost headers, which are
  // not part of the signature.
  assert.equal(calls[1].url, "https://objects.example.com/bucket/proj/att-1?X-Amz-Signature=abc");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers, undefined);
});

test("attachment client-side validation: bad mime and size", async () => {
  const { client, calls } = makeClient([]);
  await assert.rejects(
    client.uploadAttachment({ name: "a.gif", mimeType: "image/gif", data: new Uint8Array([1]) }),
    PinpostError,
  );
  await assert.rejects(
    client.uploadAttachment({ name: "a.png", mimeType: "image/png", data: new Uint8Array(0) }),
    PinpostError,
  );
  assert.equal(calls.length, 0);
});

test("getConfig sends write key header", async () => {
  const { client, calls } = makeClient([jsonRes(200, { environment: "production", settings: {} })]);
  const cfg = await client.getConfig();
  assert.equal(cfg.environment, "production");
  assert.equal(
    (calls[0].init.headers as Record<string, string>)["X-Pinpost-Write-Key"],
    "wk_test",
  );
});

/**
 * Stubs the handful of globals browserContext reads, and restores them after.
 * defineProperty rather than assignment: Node 22 ships a getter-only
 * `globalThis.navigator`, which a plain assign throws on.
 */
function withBrowserGlobals(values: Record<string, unknown>, fn: () => Promise<void> | void) {
  const g = globalThis as Record<string, unknown>;
  const saved = Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
  for (const [k, v] of Object.entries(values)) {
    Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  }
  return (async () => {
    try {
      await fn();
    } finally {
      for (const [k, descriptor] of saved) {
        if (descriptor) Object.defineProperty(g, k, descriptor);
        else delete g[k];
      }
    }
  })();
}

const BROWSER = {
  location: { href: "https://example.com/pricing" },
  navigator: { userAgent: "Mozilla/5.0 Chrome/128.0.0.0", language: "zh-CN" },
  document: { referrer: "https://google.com/" },
  innerWidth: 1440,
  innerHeight: 900,
};

test("browserContext is empty outside a browser", () => {
  assert.deepEqual(browserContext(), {});
});

test("query strings and fragments never leave the page", async () => {
  // A reset link, an SSO callback or a share link carries its token here, and
  // both sanitisers filter by key, never by value.
  await withBrowserGlobals(
    {
      ...BROWSER,
      location: { href: "https://example.com/reset?reset_token=abc123#access_token=xyz" },
      document: { referrer: "https://sso.example.com/callback?code=secret" },
    },
    async () => {
      const { client, calls } = makeClient([jsonRes(201, ok)]);
      await client.submit({ type: "bug", message: "hi" });
      const { context } = JSON.parse(calls[0].init.body as string);
      assert.equal(context.url, "https://example.com/reset");
      assert.equal(context.referrer, "https://sso.example.com/callback");
      assert.ok(!JSON.stringify(context).includes("abc123"));
      assert.ok(!JSON.stringify(context).includes("xyz"));
      assert.ok(!JSON.stringify(context).includes("secret"));
    },
  );
});

test("a deep link keeps its scheme and host, minus the query", async () => {
  // Rebuilding from `origin` would store "null" here: non-special schemes have
  // no serialisable origin, and Capacitor/Cordova/Electron hosts all use one.
  await withBrowserGlobals(
    { ...BROWSER, location: { href: "app://checkout/step-2?token=x" } },
    async () => {
      const { client, calls } = makeClient([jsonRes(201, ok)]);
      await client.submit({ type: "bug", message: "hi" });
      const { context } = JSON.parse(calls[0].init.body as string);
      assert.equal(context.url, "app://checkout/step-2");
    },
  );
});

test("basic-auth userinfo never leaves the page", async () => {
  // `user:secret@` is a credential like any query token; clearing only the
  // query and fragment would re-serialise it into the stored URL.
  await withBrowserGlobals(
    {
      ...BROWSER,
      location: { href: "https://user:secret@tools.example.com/report?x=1" },
      document: { referrer: "https://admin:hunter2@sso.example.com/callback" },
    },
    async () => {
      const { client, calls } = makeClient([jsonRes(201, ok)]);
      await client.submit({ type: "bug", message: "hi" });
      const { context } = JSON.parse(calls[0].init.body as string);
      assert.equal(context.url, "https://tools.example.com/report");
      assert.equal(context.referrer, "https://sso.example.com/callback");
      assert.ok(!JSON.stringify(context).includes("secret"));
      assert.ok(!JSON.stringify(context).includes("hunter2"));
    },
  );
});

test("submissions carry url and user agent when running in a browser", async () => {
  await withBrowserGlobals(BROWSER, async () => {
    const { client, calls } = makeClient([jsonRes(201, ok)]);
    await client.submit({ type: "bug", message: "上传失败" });
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.context.url, "https://example.com/pricing");
    assert.equal(body.context.user_agent, "Mozilla/5.0 Chrome/128.0.0.0");
    assert.equal(body.context.language, "zh-CN");
    assert.equal(body.context.referrer, "https://google.com/");
    assert.equal(body.context.viewport, "1440x900");
  });
});

test("collectContext:false keeps the automatic keys off the wire", async () => {
  await withBrowserGlobals(BROWSER, async () => {
    const calls: Call[] = [];
    const client = new PinpostClient({
      writeKey: "wk_test",
      collectContext: false,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return jsonRes(201, ok);
      }) as unknown as typeof fetch,
    });
    await client.submit({ type: "bug", message: "hi" });
    assert.equal(JSON.parse(calls[0].init.body as string).context, undefined);
  });
});

test("explicit context wins over the collected values", async () => {
  await withBrowserGlobals(BROWSER, async () => {
    const { client, calls } = makeClient([jsonRes(201, ok)]);
    await client.submit({ type: "bug", message: "hi", context: { url: "app://checkout" } });
    assert.equal(JSON.parse(calls[0].init.body as string).context.url, "app://checkout");
  });
});

test("selectAttachableFiles rejects oversized, disallowed and over-cap files", () => {
  const mk = (type: string, size: number) => ({ type, size });

  // Oversized, disallowed-MIME and empty-MIME files are all dropped.
  const rejected = selectAttachableFiles(
    [
      mk("image/png", MAX_ATTACHMENT_SIZE + 1), // oversized
      mk("image/gif", 100), // disallowed MIME
      mk("", 100), // empty MIME — must not be relabelled text/plain
    ],
    0,
  );
  assert.equal(rejected.accepted.length, 0);
  assert.deepEqual(rejected.rejected, { invalid: 3, overCap: 0, atCap: false });

  // Six valid images against an empty list → five accepted, one over the cap.
  const capped = selectAttachableFiles(
    Array.from({ length: 6 }, () => mk("image/png", 100)),
    0,
  );
  assert.equal(capped.accepted.length, MAX_ATTACHMENTS);
  assert.deepEqual(capped.rejected, { invalid: 0, overCap: 1, atCap: false });

  // Already at the cap → nothing accepted, atCap set.
  const atCap = selectAttachableFiles([mk("image/png", 100)], MAX_ATTACHMENTS);
  assert.equal(atCap.accepted.length, 0);
  assert.deepEqual(atCap.rejected, { invalid: 0, overCap: 1, atCap: true });

  // Mixed paste: a valid file plus a rejected one → valid kept, invalid counted.
  const mixed = selectAttachableFiles([mk("image/png", 100), mk("image/gif", 100)], 0);
  assert.equal(mixed.accepted.length, 1);
  assert.deepEqual(mixed.rejected, { invalid: 1, overCap: 0, atCap: false });

  // Over cap AND rejected in one batch → both counts, reported separately.
  const overCapMixed = selectAttachableFiles(
    [...Array.from({ length: 6 }, () => mk("image/png", 100)), mk("image/gif", 100)],
    0,
  );
  assert.equal(overCapMixed.accepted.length, MAX_ATTACHMENTS);
  assert.deepEqual(overCapMixed.rejected, { invalid: 1, overCap: 1, atCap: false });

  // At the cap with a mixed paste: the rejected file is still counted, not
  // swallowed by the cap.
  const atCapMixed = selectAttachableFiles(
    [mk("image/png", 100), mk("image/gif", 100)],
    MAX_ATTACHMENTS,
  );
  assert.equal(atCapMixed.accepted.length, 0);
  assert.deepEqual(atCapMixed.rejected, { invalid: 1, overCap: 1, atCap: true });

  // At the cap with every file rejected: invalid counted, nothing dropped for
  // the cap — so the widget must not claim the cap truncated anything.
  const atCapAllRejected = selectAttachableFiles([mk("image/gif", 100)], MAX_ATTACHMENTS);
  assert.equal(atCapAllRejected.accepted.length, 0);
  assert.deepEqual(atCapAllRejected.rejected, { invalid: 1, overCap: 0, atCap: true });

  // A zero-byte file is rejected as empty, not accepted and left to fail at upload.
  const empty = selectAttachableFiles([mk("image/png", 0)], 0);
  assert.equal(empty.accepted.length, 0);
  assert.deepEqual(empty.rejected, { invalid: 1, overCap: 0, atCap: false });

  // Empty input reports nothing dropped.
  const none = selectAttachableFiles([], 0);
  assert.equal(none.accepted.length, 0);
  assert.deepEqual(none.rejected, { invalid: 0, overCap: 0, atCap: false });

  // An existing count over the cap still clamps room to zero rather than
  // producing a negative slice.
  const overFull = selectAttachableFiles([mk("image/png", 100)], MAX_ATTACHMENTS + 3);
  assert.equal(overFull.accepted.length, 0);
  assert.deepEqual(overFull.rejected, { invalid: 0, overCap: 1, atCap: true });

  // A clean, in-budget file passes with nothing rejected.
  const clean = selectAttachableFiles([mk("image/png", 100)], 0);
  assert.equal(clean.accepted.length, 1);
  assert.deepEqual(clean.rejected, { invalid: 0, overCap: 0, atCap: false });
});

test("attachmentIdsForSubmit blocks uploading, failed and id-less attachments", () => {
  // Nothing attached → no ids, not blocked.
  assert.deepEqual(attachmentIdsForSubmit([]), { ids: undefined });

  // All uploaded → the ids, in order.
  assert.deepEqual(
    attachmentIdsForSubmit([
      { id: "att_1", status: "done" },
      { id: "att_2", status: "done" },
    ]),
    { ids: ["att_1", "att_2"] },
  );

  // One still uploading blocks the whole submit.
  assert.deepEqual(
    attachmentIdsForSubmit([{ id: "att_1", status: "done" }, { status: "uploading" }]),
    { blocked: "uploading" },
  );

  // A failed upload blocks it too, and uploading wins when both are present.
  assert.deepEqual(attachmentIdsForSubmit([{ status: "error" }]), { blocked: "error" });
  assert.deepEqual(
    attachmentIdsForSubmit([{ status: "error" }, { status: "uploading" }]),
    { blocked: "uploading" },
  );

  // "done" with no server id must never reach the wire as undefined.
  assert.deepEqual(
    attachmentIdsForSubmit([{ id: "att_1", status: "done" }, { status: "done" }]),
    { blocked: "missing_id" },
  );
});

test("attachmentSelectionNotice reports the cap and rejections separately", () => {
  const strings = {
    attachmentCap: (max: number) => `cap:${max}`,
    attachmentsKeptFirst: (kept: number, max: number) => `kept:${kept}/${max}`,
    attachmentsRejected: (count: number, maxMiB: number) => `rejected:${count}@${maxMiB}`,
  };
  const notice = (
    rejected: { invalid: number; overCap: number; atCap: boolean },
    kept: number,
  ) => attachmentSelectionNotice(rejected, kept, strings);

  // Nothing dropped → no notice at all.
  assert.equal(notice({ invalid: 0, overCap: 0, atCap: false }, 1), "");

  // At the cap with nothing kept → the cap note.
  assert.equal(notice({ invalid: 0, overCap: 1, atCap: true }, 0), "cap:5");

  // At the cap where every file was invalid → the cap dropped nothing, so the
  // rejection stands alone. This is the branch three earlier rounds got wrong.
  assert.equal(notice({ invalid: 1, overCap: 0, atCap: true }, 0), "cap:5 rejected:1@10");

  // Over the cap with room to spare → the truncation note, not the cap note.
  assert.equal(notice({ invalid: 0, overCap: 1, atCap: false }, 5), "kept:5/5");

  // Over cap AND invalid in one batch → both, in that order.
  assert.equal(notice({ invalid: 1, overCap: 1, atCap: false }, 5), "kept:5/5 rejected:1@10");

  // Invalid only → the rejection note alone.
  assert.equal(notice({ invalid: 2, overCap: 0, atCap: false }, 1), "rejected:2@10");

  // Kept something while at the cap is impossible, but if it ever happens the
  // truncation note wins over the cap note rather than claiming a full stop.
  assert.equal(notice({ invalid: 0, overCap: 2, atCap: true }, 1), "kept:1/5");
});
