// @pinpost/core — zero runtime deps, no DOM/React types.

export type FeedbackType = "bug" | "suggestion" | "other";
export const FEEDBACK_TYPES: FeedbackType[] = ["bug", "suggestion", "other"];
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
export const MAX_ATTACHMENT_SIZE = 10485760;
export const MAX_ATTACHMENTS = 5;

const CONTEXT_BLACKLIST = new Set(["password", "authorization", "cookie", "token", "secret"]);

export interface PinpostOptions {
  writeKey: string;
  apiUrl?: string;
  environment?: string;
  /** injectable for tests */
  fetch?: typeof fetch;
  /** injectable idempotency-key generator for tests */
  generateId?: () => string;
  /** injectable sleep for tests */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /**
   * Attach url, user agent, language, referrer and viewport to every submit.
   * On by default — the dashboard shows this on each row — and opt out with
   * `false` where sending it is not wanted.
   */
  collectContext?: boolean;
}

export interface SubmitPayload {
  type: FeedbackType;
  message: string;
  rating?: number;
  contact?: { email?: string };
  external_user_id?: string;
  context?: Record<string, unknown>;
  attachment_ids?: string[];
}

export interface SubmitResult {
  feedback_id: string;
  created_at: string;
}

export interface SdkConfig {
  environment: string;
  settings: Record<string, unknown>;
}

export class PinpostError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "PinpostError";
  }
}

/**
 * Context the browser can answer for itself. The inbox shows "where did this
 * come from" on every row, and asking each host app to pass a user agent by
 * hand left that column empty in practice. Read off `globalThis` rather than
 * the DOM types this package deliberately does not depend on, so it compiles
 * and no-ops anywhere that is not a browser (Node, React Native, workers).
 * Collected per submit: a single-page app changes url between reports.
 */
/**
 * Drops the query string, the fragment and any userinfo, keeping scheme, host
 * and path verbatim. A reset link, an SSO callback or a share link carries its
 * token in exactly those parts, and both sanitisers filter by key, never by
 * value — so a full href would store a live credential on a record every
 * workspace member can read and export.
 *
 * Rebuilding from `origin` would be wrong: a non-special scheme serialises its
 * origin as the string "null", so `app://checkout` — Capacitor, Cordova,
 * Electron, extensions, file:// — would be stored as "null".
 */
function stripQuery(href: string): string {
  try {
    const url = new URL(href);
    url.search = "";
    url.hash = "";
    // Userinfo is a credential like any query token: `user:secret@` must not
    // reach a record every workspace member can read and export.
    url.username = "";
    url.password = "";
    return url.href.slice(0, 1024);
  } catch {
    return href.slice(0, 1024);
  }
}

export function browserContext(): Record<string, unknown> {
  const g = globalThis as {
    location?: { href?: string };
    navigator?: { userAgent?: string; language?: string };
    document?: { referrer?: string };
    innerWidth?: number;
    innerHeight?: number;
  };
  if (!g.location?.href || !g.navigator?.userAgent) return {};
  const out: Record<string, unknown> = {
    url: stripQuery(g.location.href),
    user_agent: g.navigator.userAgent.slice(0, 1024),
  };
  if (g.navigator.language) out.language = g.navigator.language;
  if (g.document?.referrer) out.referrer = stripQuery(g.document.referrer);
  if (g.innerWidth && g.innerHeight) out.viewport = `${g.innerWidth}x${g.innerHeight}`;
  return out;
}

export function sanitizeContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (CONTEXT_BLACKLIST.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

export function validatePayload(p: SubmitPayload): void {
  const bad = (msg: string) => {
    throw new PinpostError(0, "validation_failed", msg);
  };
  if (!FEEDBACK_TYPES.includes(p.type)) bad(`type must be one of ${FEEDBACK_TYPES.join(", ")}`);
  if (typeof p.message !== "string" || p.message.length < 1 || p.message.length > 10000)
    bad("message must be 1..10000 characters");
  if (p.rating !== undefined && (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 5))
    bad("rating must be an integer 1..5");
  if (p.contact?.email !== undefined && p.contact.email.length > 320)
    bad("contact.email must be at most 320 characters");
  if (p.attachment_ids && p.attachment_ids.length > MAX_ATTACHMENTS)
    bad(`at most ${MAX_ATTACHMENTS} attachments`);
}

export interface AttachableFile {
  type: string;
  size: number;
}

export interface AttachableRejection {
  /** files dropped by the MIME allow-list or the size bound */
  invalid: number;
  /** otherwise-valid files dropped because the attachment cap was reached */
  overCap: number;
  /** the attachment cap was already full when this batch arrived */
  atCap: boolean;
}

export interface AttachableSelection<T> {
  accepted: T[];
  rejected: AttachableRejection;
}

/**
 * The client-side acceptance rule for the embed widgets: exact MIME match
 * against the allow-list, a non-empty size within MAX_ATTACHMENT_SIZE, and the
 * attachment-count cap. Returns the files to attach (up to MAX_ATTACHMENTS
 * total) plus machine-readable counts of what was dropped and why. Empty-MIME
 * files are dropped rather than relabelled, matching the allow-list in
 * uploadAttachment.
 *
 * This judges the file as picked. A widget that rewrites bytes before upload —
 * re-encoding an image to strip EXIF, say — must re-check the result against
 * MAX_ATTACHMENT_SIZE itself, because uploadAttachment validates what is
 * actually sent, not what was selected.
 *
 * Deliberately returns no display copy: user-facing wording belongs in the
 * widget's locale pack, not in a package that ships to every platform.
 */
export function selectAttachableFiles<T extends AttachableFile>(
  files: Iterable<T>,
  existingCount: number,
): AttachableSelection<T> {
  const allowed = ALLOWED_MIME_TYPES as readonly string[];
  const list = Array.from(files);
  const valid = list.filter(
    (f) => f.size >= 1 && f.size <= MAX_ATTACHMENT_SIZE && allowed.includes(f.type),
  );
  const room = Math.max(MAX_ATTACHMENTS - existingCount, 0);
  const accepted = valid.slice(0, room);

  return {
    accepted,
    rejected: {
      invalid: list.length - valid.length,
      overCap: valid.length - accepted.length,
      atCap: room <= 0,
    },
  };
}

export interface AttachmentNoticeStrings {
  attachmentCap: (max: number) => string;
  attachmentsKeptFirst: (kept: number, max: number) => string;
  attachmentsRejected: (count: number, maxMiB: number) => string;
}

/**
 * Renders a selectAttachableFiles result as user-facing text through the
 * caller's locale pack. The branch structure lives here, next to the rule it
 * describes, so the widget and the demo cannot drift apart on when the cap is
 * mentioned: the cap note fires only when the cap actually dropped something,
 * and the rejection note is independent of it.
 */
export function attachmentSelectionNotice(
  rejected: AttachableRejection,
  kept: number,
  strings: AttachmentNoticeStrings,
): string {
  const notes: string[] = [];
  if (!kept && rejected.atCap) notes.push(strings.attachmentCap(MAX_ATTACHMENTS));
  else if (rejected.overCap > 0) notes.push(strings.attachmentsKeptFirst(kept, MAX_ATTACHMENTS));
  if (rejected.invalid > 0)
    notes.push(strings.attachmentsRejected(rejected.invalid, MAX_ATTACHMENT_SIZE / 1048576));
  return notes.join(" ");
}

export interface SubmittableAttachment {
  id?: string;
  status: "uploading" | "done" | "error";
}

export type AttachmentSubmitGate =
  | { ids?: string[]; blocked?: undefined }
  | { ids?: undefined; blocked: "uploading" | "error" | "missing_id" };

/**
 * Decides whether a widget's attachment list may be submitted, and with which
 * ids. Lives here rather than in the widget so the gate is testable without a
 * DOM: an attachment still uploading, one that failed, or a "done" entry with
 * no server id must never reach submit — the last would send `undefined` into
 * attachment_ids and draw a 400 from the API.
 */
export function attachmentIdsForSubmit(
  attachments: readonly SubmittableAttachment[],
): AttachmentSubmitGate {
  if (attachments.some((a) => a.status === "uploading")) return { blocked: "uploading" };
  if (attachments.some((a) => a.status === "error")) return { blocked: "error" };
  const ids = attachments.map((a) => a.id).filter((id): id is string => !!id);
  if (ids.length !== attachments.length) return { blocked: "missing_id" };
  return { ids: ids.length ? ids : undefined };
}

export class PinpostClient {
  private apiUrl: string;
  private fetch: typeof fetch;
  private generateId: () => string;
  private sleep: (ms: number) => Promise<void>;
  private maxAttempts: number;
  private identity: { external_user_id?: string; email?: string } = {};
  private context: Record<string, unknown> = {};

  constructor(private options: PinpostOptions) {
    this.apiUrl = (options.apiUrl ?? "http://localhost:8787").replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  identify(user: { externalUserId?: string; email?: string }): void {
    if (user.externalUserId !== undefined) this.identity.external_user_id = user.externalUserId;
    if (user.email !== undefined) this.identity.email = user.email;
  }

  setContext(context: Record<string, unknown>): void {
    Object.assign(this.context, context);
  }

  resetUser(): void {
    this.identity = {};
    this.context = {};
  }

  async getConfig(): Promise<SdkConfig> {
    return this.request<SdkConfig>("GET", "/v1/sdk/config");
  }

  async uploadAttachment(file: {
    name: string;
    mimeType: string;
    data: Uint8Array;
  }): Promise<string> {
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType))
      throw new PinpostError(0, "validation_failed", `mime_type must be one of ${ALLOWED_MIME_TYPES.join(", ")}`);
    if (file.data.length < 1 || file.data.length > MAX_ATTACHMENT_SIZE)
      throw new PinpostError(0, "validation_failed", `size must be 1..${MAX_ATTACHMENT_SIZE} bytes`);
    const auth = await this.request<{ attachment_id: string; upload_url: string; expires_at: string }>(
      "POST",
      "/v1/attachment-uploads",
      { original_name: file.name.slice(0, 255), mime_type: file.mimeType, size: file.data.length },
    );
    await this.putBytes(auth.upload_url, file.data);
    return auth.attachment_id;
  }

  // The upload URL is presigned by object storage and the bytes never touch
  // the Pinpost API: no write-key header (it is not part of the signature and
  // would only add a CORS preflight) and no error envelope to parse.
  private async putBytes(uploadUrl: string, data: Uint8Array): Promise<void> {
    const url = /^https?:\/\//.test(uploadUrl) ? uploadUrl : this.apiUrl + uploadUrl;
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(url, { method: "PUT", body: data as unknown as BodyInit });
      } catch (err) {
        lastError = err; // network error/timeout: retryable
        await this.backoff(attempt);
        continue;
      }
      if (res.ok) return;
      const error = new PinpostError(res.status, "upload_failed", `Upload failed with HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) throw error;
      lastError = error;
      await this.backoff(attempt, res.headers.get("Retry-After"));
    }
    throw lastError;
  }

  async submit(payload: SubmitPayload): Promise<SubmitResult> {
    // Explicit context wins over anything collected automatically, which in
    // turn only fills keys the host app did not set.
    const collected = this.options.collectContext === false ? {} : browserContext();
    const context = sanitizeContext({ ...collected, ...this.context, ...payload.context });
    const body: SubmitPayload = {
      ...payload,
      external_user_id: payload.external_user_id ?? this.identity.external_user_id,
      contact: payload.contact ?? (this.identity.email ? { email: this.identity.email } : undefined),
      context: context && Object.keys(context).length ? context : undefined,
    };
    validatePayload(body);
    // one idempotency key per submit() call, reused across its retries
    const idempotencyKey = this.generateId();
    return this.request<SubmitResult>("POST", "/v1/feedback", body, {
      "Idempotency-Key": idempotencyKey,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "X-Pinpost-Write-Key": this.options.writeKey,
      ...extraHeaders,
    };
    let payload: BodyInit | undefined;
    if (body instanceof Uint8Array) {
      payload = body as unknown as BodyInit;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(this.apiUrl + path, { method, headers, body: payload });
      } catch (err) {
        lastError = err; // network error/timeout: retryable
        await this.backoff(attempt);
        continue;
      }
      if (res.ok) return (await res.json().catch(() => ({}))) as T;

      const env = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string; fields?: Record<string, string> };
      } | null;
      const error = new PinpostError(
        res.status,
        env?.error?.code ?? "unknown",
        env?.error?.message ?? `HTTP ${res.status}`,
        env?.error?.fields,
      );
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw error;
      lastError = error;
      await this.backoff(attempt, res.headers.get("Retry-After"));
    }
    throw lastError;
  }

  private async backoff(attempt: number, retryAfter?: string | null): Promise<void> {
    if (attempt >= this.maxAttempts - 1) return; // last attempt: no sleep, throw next
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : 300 * 2 ** attempt + Math.random() * 200;
    await this.sleep(ms);
  }
}

export function createClient(options: PinpostOptions): PinpostClient {
  return new PinpostClient(options);
}
