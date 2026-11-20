import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
  type FormEvent,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Bug,
  Check,
  ChevronDown,
  Lightbulb,
  MessageCircle,
  Paperclip,
  RotateCcw,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  PinpostClient,
  ALLOWED_MIME_TYPES,
  FEEDBACK_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE,
  attachmentIdsForSubmit,
  attachmentSelectionNotice,
  selectAttachableFiles,
  type FeedbackType,
  type SubmitPayload,
  type SubmitResult,
} from "@pinpost/core";

/* ------------------------------------------------------------------ copy */

/**
 * Every user-facing string the widget can render. Defaults are English;
 * callers override any subset through <PinpostProvider strings> or the
 * widget's own `strings` prop, which is how a host product localises it.
 */
export interface FeedbackStrings {
  fab: string;
  dialogLabel: string;
  typeGroupLabel: string;
  types: Record<FeedbackType, string>;
  typeDescriptions: Record<FeedbackType, string>;
  messageLabel: string;
  messagePlaceholder: (pasteKey: string) => string;
  attachButton: string;
  attachHint: (pasteKey: string) => string;
  fileInputLabel: string;
  ratingGroupLabel: string;
  star: (n: number) => string;
  /** the word shown beside the stars for the value being previewed or held */
  ratingWords: Record<1 | 2 | 3 | 4 | 5, string>;
  uploading: string;
  retry: string;
  retryLabel: string;
  removeLabel: string;
  thanks: string;
  send: string;
  sending: string;
  close: string;
  attachmentsUploading: string;
  attachmentsFailed: string;
  busySubmitting: string;
  uploadTooLarge: (maxMiB: number) => string;
  attachmentMissingId: string;
  attachmentCap: (max: number) => string;
  attachmentsKeptFirst: (kept: number, max: number) => string;
  attachmentsRejected: (count: number, maxMiB: number) => string;
  uploadFailed: (reason: string) => string;
}

export const defaultStrings: FeedbackStrings = {
  fab: "Feedback",
  dialogLabel: "Send feedback",
  typeGroupLabel: "Feedback type",
  types: { bug: "Bug", suggestion: "Suggestion", other: "Other" },
  typeDescriptions: {
    bug: "Something is broken",
    suggestion: "An idea for us",
    other: "Anything else",
  },
  messageLabel: "Feedback message",
  messagePlaceholder: (k) => `Paste a screenshot (${k}) and tell us what happened…`,
  attachButton: "Add file",
  attachHint: (k) => `Paste (${k}) or drop a screenshot — no file picker needed`,
  fileInputLabel: "Choose attachments",
  ratingGroupLabel: "Satisfaction rating (optional)",
  star: (n) => `${n} star${n > 1 ? "s" : ""}`,
  ratingWords: { 1: "Terrible", 2: "Poor", 3: "OK", 4: "Good", 5: "Great" },
  uploading: "Uploading…",
  retry: "Retry",
  retryLabel: "Retry upload",
  removeLabel: "Remove attachment",
  thanks: "Thanks for your feedback!",
  send: "Send",
  sending: "Sending…",
  close: "Close",
  attachmentsUploading: "Attachments are still uploading…",
  attachmentsFailed: "One or more attachments failed to upload — remove or retry them.",
  busySubmitting: "Still sending your feedback — wait for it to finish before attaching more.",
  uploadTooLarge: (maxMiB) => `Image is still over ${maxMiB} MiB after processing — attach a smaller one.`,
  attachmentMissingId: "An attachment has no upload id yet — retry it and try again.",
  attachmentCap: (max) => `At most ${max} attachments allowed.`,
  attachmentsKeptFirst: (kept, max) => `Only ${max} attachments allowed — kept the first ${kept}.`,
  attachmentsRejected: (count, maxMiB) =>
    `${count} rejected — unsupported type, empty or over ${maxMiB} MiB.`,
  uploadFailed: (reason) => `Attachment upload failed: ${reason}`,
};

/**
 * The paste shortcut differs by platform and the hint is shown on the primary
 * path, so it cannot be a hardcoded ⌘V. Falls back to Ctrl+V off-browser.
 */
function pasteKey(): string {
  if (typeof navigator === "undefined") return "Ctrl+V";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘V" : "Ctrl+V";
}

/* ----------------------------------------------------------------- theme */

export interface FeedbackTheme {
  surface: string;
  text: string;
  textMuted: string;
  textFaint: string;
  line: string;
  accent: string;
  accentSoft: string;
  fabBg: string;
  fabText: string;
  thumbBg: string;
  danger: string;
  errText: string;
  okText: string;
  star: string;
  shadow: string;
  removeOverlay: string;
  retryOverlay: string;
  retryText: string;
  busyOverlay: string;
  busyText: string;
  /** hover/active background for menu rows and the dropdown trigger */
  hover: string;
}

export const lightTheme: FeedbackTheme = {
  surface: "#fff",
  text: "#1f2937",
  textMuted: "#6b7280",
  textFaint: "#9ca3af",
  line: "#d1d5db",
  accent: "#4f6ef7",
  accentSoft: "rgba(79,110,247,.08)",
  fabBg: "#1f2937",
  fabText: "#fff",
  thumbBg: "#f3f4f6",
  danger: "#ef4444",
  errText: "#dc2626",
  okText: "#16a34a",
  star: "#f6b73c",
  shadow: "0 8px 24px rgba(0,0,0,.15)",
  removeOverlay: "rgba(17,24,39,.7)",
  retryOverlay: "rgba(17,24,39,.55)",
  retryText: "#fff",
  busyOverlay: "rgba(255,255,255,.55)",
  busyText: "#374151",
  hover: "#f3f4f6",
};

export const darkTheme: FeedbackTheme = {
  surface: "#1c1f2b",
  text: "#eceef6",
  textMuted: "#9aa1bd",
  textFaint: "#7d84a3",
  line: "#2b2f40",
  accent: "#8ea2ff",
  accentSoft: "rgba(142,162,255,.14)",
  fabBg: "#eceef6",
  fabText: "#12141c",
  thumbBg: "#252936",
  danger: "#f87171",
  errText: "#f87171",
  okText: "#4ade80",
  star: "#f6b73c",
  shadow: "0 8px 24px rgba(0,0,0,.5)",
  removeOverlay: "rgba(0,0,0,.7)",
  retryOverlay: "rgba(0,0,0,.6)",
  retryText: "#fff",
  busyOverlay: "rgba(18,20,28,.6)",
  busyText: "#eceef6",
  hover: "#252936",
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Follows the host page's colour scheme; light during SSR. */
function usePrefersDark(): boolean {
  // Always false on the first render so SSR markup and hydration agree; the
  // effect below corrects it on mount.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY);
    if (!mq) return;
    const onChange = () => setDark(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

const makeStyles = (t: FeedbackTheme) =>
  ({
    button: {
      position: "fixed",
      insetBlockEnd: 20,
      insetInlineEnd: 20,
      borderRadius: 24,
      padding: "10px 16px",
      background: t.fabBg,
      color: t.fabText,
      border: "none",
      cursor: "pointer",
      fontSize: 14,
      display: "flex",
      alignItems: "center",
      gap: 8,
    },
    dialog: {
      position: "fixed",
      insetBlockEnd: 72,
      insetInlineEnd: 20,
      width: 374,
      maxWidth: "calc(100% - 40px)",
      boxSizing: "border-box",
      background: t.surface,
      color: t.text,
      colorScheme: "light dark",
      border: `1px solid ${t.line}`,
      borderRadius: 12,
      padding: 16,
      boxShadow: t.shadow,
      display: "flex",
      flexDirection: "column",
      gap: 12,
      zIndex: 9999,
    },
    types: { position: "relative" },
    ddTrigger: {
      width: "100%",
      minHeight: 44,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 12px",
      borderRadius: 8,
      border: `1px solid ${t.line}`,
      background: t.surface,
      color: t.text,
      cursor: "pointer",
      fontSize: 14,
      fontFamily: "inherit",
      textAlign: "start",
    },
    ddTriggerOpen: {
      width: "100%",
      minHeight: 44,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 12px",
      borderRadius: 8,
      border: `1px solid ${t.accent}`,
      background: t.surface,
      color: t.text,
      cursor: "pointer",
      fontSize: 14,
      fontFamily: "inherit",
      textAlign: "start",
    },
    ddTriggerLabel: { flex: 1, minWidth: 0 },
    ddList: {
      position: "absolute",
      insetInlineStart: 0,
      insetInlineEnd: 0,
      insetBlockStart: "calc(100% + 4px)",
      margin: 0,
      padding: 4,
      listStyle: "none",
      borderRadius: 10,
      border: `1px solid ${t.line}`,
      background: t.surface,
      boxShadow: t.shadow,
      zIndex: 1,
      maxHeight: 260,
      overflowY: "auto",
    },
    ddOption: {
      width: "100%",
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: "8px 10px",
      minHeight: 44,
      borderRadius: 6,
      border: "none",
      background: "transparent",
      color: t.text,
      cursor: "pointer",
      fontSize: 14,
      fontFamily: "inherit",
      textAlign: "start",
    },
    ddOptionActive: {
      width: "100%",
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: "8px 10px",
      minHeight: 44,
      borderRadius: 6,
      border: "none",
      background: t.hover,
      color: t.text,
      cursor: "pointer",
      fontSize: 14,
      fontFamily: "inherit",
      textAlign: "start",
    },
    ddOptionBody: { flex: 1, minWidth: 0 },
    ddOptionDesc: { display: "block", fontSize: 12, color: t.textMuted, marginBlockStart: 2 },
    ddCheck: { color: t.accent, flexShrink: 0 },
    textarea: {
      width: "100%",
      border: `1px solid ${t.line}`,
      background: t.surface,
      color: t.text,
      colorScheme: "light dark",
      borderRadius: 8,
      padding: "10px 12px",
      fontSize: 14,
      fontFamily: "inherit",
      minHeight: 96,
      resize: "vertical",
      boxSizing: "border-box",
    },
    thumbs: { display: "flex", gap: 8, flexWrap: "wrap" },
    thumb: {
      position: "relative",
      width: 64,
      height: 64,
      borderRadius: 8,
      border: `1px solid ${t.line}`,
      background: t.thumbBg,
    },
    thumbError: {
      position: "relative",
      width: 64,
      height: 64,
      borderRadius: 8,
      border: `1px solid ${t.danger}`,
      background: t.thumbBg,
    },
    thumbImg: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
      borderRadius: 7,
    },
    thumbFile: {
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      color: t.textMuted,
      padding: 4,
      textAlign: "center",
      wordBreak: "break-all",
    },
    // 22px visual circle, 44px hit area: the overlay sits 3px from the thumb
    // edge and is the only way to remove an attachment on touch.
    thumbRemove: {
      position: "absolute",
      insetBlockStart: 3,
      insetInlineEnd: 3,
      width: 22,
      height: 22,
      borderRadius: 999,
      border: `11px solid transparent`,
      boxSizing: "content-box",
      margin: -11,
      backgroundColor: t.removeOverlay,
      backgroundClip: "padding-box",
      color: "#fff",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
      zIndex: 2,
    },
    thumbRetry: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      border: "none",
      background: t.retryOverlay,
      color: t.retryText,
      cursor: "pointer",
      fontSize: 11,
      borderRadius: 8,
      zIndex: 1,
    },
    thumbBusy: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: t.busyOverlay,
      color: t.busyText,
      fontSize: 11,
      pointerEvents: "none",
      borderRadius: 8,
    },
    attachRow: { display: "flex", alignItems: "center", gap: 8 },
    // 44px minimum touch target, reached with padding rather than the negative
    // -margin trick used on thumbRemove: this button sits in a normal flow row,
    // so an overhanging hit area would sit on top of the hint text beside it.
    attachBtn: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 44,
      border: "none",
      background: "transparent",
      color: t.textMuted,
      cursor: "pointer",
      fontSize: 13,
      padding: "4px 8px",
    },
    hint: { fontSize: 12, color: t.textFaint },
    stars: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 },
    starWord: { fontSize: 12, color: t.textMuted, marginInlineStart: 8 },
    // 20px glyph + 12px padding each side = a 44x44 target per star. The row
    // is 5*44 + 4*2 gap = 228px, well inside the 340px dialog, so the targets
    // do not need to overhang and cannot overlap each other.
    starBtn: {
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: 12,
      lineHeight: 0,
    },
    actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
    submit: {
      border: "none",
      borderRadius: 8,
      padding: "9px 18px",
      background: t.fabBg,
      color: t.fabText,
      cursor: "pointer",
      fontSize: 14,
    },
    submitDisabled: {
      border: "none",
      borderRadius: 8,
      padding: "9px 18px",
      background: t.fabBg,
      color: t.fabText,
      cursor: "default",
      fontSize: 14,
      opacity: 0.5,
    },
    close: {
      border: "none",
      background: "transparent",
      color: t.textMuted,
      cursor: "pointer",
      fontSize: 14,
      padding: "9px 12px",
    },
    statusOk: { fontSize: 13, margin: 0, color: t.okText },
    statusErr: { fontSize: 13, margin: 0, color: t.errText },
  }) satisfies Record<string, React.CSSProperties>;

/* --------------------------------------------------------------- context */

export interface PinpostContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
  submit: (payload: SubmitPayload) => Promise<SubmitResult>;
  identify: PinpostClient["identify"];
  setContext: PinpostClient["setContext"];
  resetUser: PinpostClient["resetUser"];
  client: PinpostClient;
  strings: FeedbackStrings;
}

const Ctx = createContext<PinpostContextValue | null>(null);

export function PinpostProvider(props: {
  writeKey: string;
  apiUrl?: string;
  environment?: string;
  /** Include browser context such as the current URL by default. */
  collectContext?: boolean;
  /** locale overrides applied to every widget under this provider */
  strings?: Partial<FeedbackStrings>;
  children?: ReactNode;
}) {
  const { writeKey, apiUrl, environment, collectContext, strings, children } = props;
  const client = useMemo(
    () => new PinpostClient({ writeKey, apiUrl, environment, collectContext }),
    [writeKey, apiUrl, environment, collectContext],
  );
  const [isOpen, setIsOpen] = useState(false);
  const resolved = useMemo<FeedbackStrings>(
    () => ({ ...defaultStrings, ...strings }),
    [strings],
  );
  const value = useMemo<PinpostContextValue>(
    () => ({
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      isOpen,
      submit: (p) => client.submit(p),
      identify: (u) => client.identify(u),
      setContext: (c) => client.setContext(c),
      resetUser: () => client.resetUser(),
      client,
      strings: resolved,
    }),
    [client, isOpen, resolved],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePinpost(): PinpostContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePinpost must be used within <PinpostProvider>");
  return ctx;
}

/* --------------------------------------------------------------- widget */

type Status = "idle" | "submitting" | "succeeded" | "failed";

type Attachment = {
  uid: number;
  file: File;
  /** object URL for image previews (revoked on remove) */
  url?: string;
  /** server attachment id once uploaded */
  id?: string;
  status: "uploading" | "done" | "error";
  /** why this upload failed; cleared on retry and on success */
  error?: string;
};

const REENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Re-encodes images through a canvas before upload, which drops every
 * ancillary chunk — EXIF included, so a dropped-in phone photo does not carry
 * GPS coordinates and a device serial into the feedback record. Non-image
 * types pass through untouched.
 *
 * Re-encoding can make a file bigger (a well-optimised PNG, or a JPEG rewritten
 * at the encoder's default quality), and selectAttachableFiles judged the
 * original size — so the result is re-checked here and progressively downscaled
 * until it fits, rather than being handed to uploadAttachment to fail with a
 * raw validation string on a file the widget already accepted.
 *
 * A failure throws rather than falling back to the raw bytes: the fallback
 * would silently reinstate the leak this exists to prevent.
 */
export async function uploadBytes(
  file: { type: string; arrayBuffer: () => Promise<ArrayBuffer> },
  strings: Pick<FeedbackStrings, "uploadTooLarge"> = defaultStrings,
): Promise<Uint8Array> {
  if (!REENCODABLE.has(file.type)) return new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file as Parameters<typeof createImageBitmap>[0]);
  try {
    let scale = 1;
    // Four attempts: full size, then shrinking towards the cap with a margin.
    // Each pass is a fresh encode, so the loop terminates on size, not on luck.
    for (let attempt = 0; attempt < 4; attempt++) {
      const bytes = await encodeBitmap(bitmap, file.type, scale);
      if (bytes.length <= MAX_ATTACHMENT_SIZE) return bytes;
      scale *= Math.min(0.9, Math.sqrt(MAX_ATTACHMENT_SIZE / bytes.length));
    }
    throw new Error(strings.uploadTooLarge(MAX_ATTACHMENT_SIZE / 1048576));
  } finally {
    bitmap.close();
  }
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  type: string,
  scale: number,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
  if (!blob) throw new Error("could not re-encode the image");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Shared presentation for every icon: lucide already matches the stroke,
 * viewBox and cap settings this widget wants, so only alignment and the
 * decorative role need setting. Icons are always paired with a text label or
 * an aria-label on the control, so they are hidden from assistive tech.
 */
const ICON_STYLE = { display: "inline-block", verticalAlign: "-0.125em", flexShrink: 0 } as const;
const iconProps = { "aria-hidden": true, focusable: "false", style: ICON_STYLE } as const;

/** Lucide glyph per feedback type; unknown keys fall back to the message icon. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  bug: Bug,
  suggestion: Lightbulb,
  other: MessageCircle,
};

const typeIcon = (key: string): LucideIcon => TYPE_ICONS[key] ?? MessageCircle;

/** The trigger chevron flips while the menu is open, as it did before. */
const chevronStyle = (open: boolean) => ({
  transform: open ? "rotate(180deg)" : undefined,
  transition: "transform .15s ease",
});

/**
 * Type picker. A listbox rather than a row of pills: the enabled types come
 * from project settings, so the control has to stay legible when a project
 * configures more than the three defaults, and the descriptions give each
 * option the context a bare pill label cannot.
 */
function TypeSelect(props: {
  value: FeedbackType;
  onChange: (next: FeedbackType) => void;
  strings: FeedbackStrings;
  styles: ReturnType<typeof makeStyles>;
  theme: FeedbackTheme;
}) {
  const { value, onChange, strings: t, styles: s, theme } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => FEEDBACK_TYPES.indexOf(value));
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = "pinpost-type-list";

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus();
  }, [open, active]);

  function choose(next: FeedbackType) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function openAt(index: number) {
    setActive(index);
    setOpen(true);
  }

  function onTriggerKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAt(e.key === "ArrowUp" ? FEEDBACK_TYPES.length - 1 : FEEDBACK_TYPES.indexOf(value));
    }
  }

  function onListKey(e: ReactKeyboardEvent) {
    const last = FEEDBACK_TYPES.length - 1;
    if (e.key === "Escape" || e.key === "Tab") {
      // Escape belongs to the menu while it is open. Without this the event
      // reaches the dialog's document-level handler and closes the whole
      // panel, discarding whatever the user has typed.
      if (e.key === "Escape") e.stopPropagation();
      setOpen(false);
      if (e.key === "Escape") triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i >= last ? 0 : i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? last : i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(last); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(FEEDBACK_TYPES[active]); }
  }

  return (
    <div style={s.types} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        style={open ? s.ddTriggerOpen : s.ddTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t.typeGroupLabel}
        onClick={() => (open ? setOpen(false) : openAt(FEEDBACK_TYPES.indexOf(value)))}
        onKeyDown={onTriggerKey}
      >
        {(() => {
          const TypeIcon = typeIcon(value);
          return <TypeIcon size={16} {...iconProps} />;
        })()}
        <span style={s.ddTriggerLabel}>{t.types[value]}</span>
        <ChevronDown size={16} {...iconProps} style={{ ...ICON_STYLE, ...chevronStyle(open) }} />
      </button>

      {open && (
        <ul id={listId} ref={listRef} role="listbox" aria-label={t.typeGroupLabel} style={s.ddList} onKeyDown={onListKey}>
          {FEEDBACK_TYPES.map((ft, i) => (
            <li key={ft} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={ft === value}
                data-active={i === active}
                tabIndex={i === active ? 0 : -1}
                style={i === active ? s.ddOptionActive : s.ddOption}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(ft)}
              >
                {(() => {
                  const OptionIcon = typeIcon(ft);
                  return <OptionIcon size={16} {...iconProps} />;
                })()}
                <span style={s.ddOptionBody}>
                  {t.types[ft]}
                  <span style={s.ddOptionDesc}>{t.typeDescriptions[ft]}</span>
                </span>
                {ft === value && (
                  <span style={s.ddCheck}>
                    <Check size={16} {...iconProps} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FeedbackWidget(props: { strings?: Partial<FeedbackStrings> } = {}) {
  const { isOpen, open, close, client, strings: providerStrings } = usePinpost();
  const t = useMemo<FeedbackStrings>(
    () => ({ ...providerStrings, ...props.strings }),
    [providerStrings, props.strings],
  );
  const theme = usePrefersDark() ? darkTheme : lightTheme;
  const s = useMemo(() => makeStyles(theme), [theme]);
  const key = useMemo(pasteKey, []);

  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | undefined>(undefined);
  // Previewed while the pointer or focus is on a star; falls back to the held
  // value so the row always shows what clicking right now would set.
  const [hoverRating, setHoverRating] = useState<number | undefined>(undefined);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextUid = useRef(0);
  const attachmentsRef = useRef<Attachment[]>([]);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // Focus capture/restore is keyed on isOpen alone. Folding it into the effect
  // above would re-run it whenever `close` changes identity — which it does on
  // every provider render for a host passing an inline `strings` object —
  // yanking focus back to the textarea mid-interaction.
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    return () => openerRef.current?.focus?.();
  }, [isOpen]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    // Revoke object URLs when the widget unmounts.
    return () => {
      for (const a of attachmentsRef.current) if (a.url) URL.revokeObjectURL(a.url);
    };
  }, []);

  async function uploadOne(att: Attachment) {
    setAttachments((prev) =>
      prev.map((a) =>
        a.uid === att.uid ? { ...a, status: "uploading", id: undefined, error: undefined } : a,
      ),
    );
    try {
      const id = await client.uploadAttachment({
        name: att.file.name,
        mimeType: att.file.type,
        data: await uploadBytes(att.file, t),
      });
      setAttachments((prev) =>
        prev.map((a) => (a.uid === att.uid ? { ...a, id, status: "done", error: undefined } : a)),
      );
    } catch (err) {
      // The reason lives on the attachment, not in the shared `error` slot, so
      // a successful retry clears it on its own and one tile's failure cannot
      // mask another's.
      const reason = t.uploadFailed(err instanceof Error ? err.message : String(err));
      setAttachments((prev) =>
        prev.map((a) => (a.uid === att.uid ? { ...a, status: "error", error: reason } : a)),
      );
    }
  }

  function addFiles(files: Iterable<File>) {
    // A submit in flight owns the attachment list: letting an add through
    // here would re-enable Send mid-flight (duplicate record, fresh
    // idempotency key) and the success handler would then discard the file.
    if (status === "submitting") {
      // The guard is right, but returning silently makes the headline
      // interaction of this widget look broken for the seconds a retrying
      // submit takes.
      setError(t.busySubmitting);
      return;
    }
    const { accepted, rejected } = selectAttachableFiles(files, attachments.length);
    setError(attachmentSelectionNotice(rejected, accepted.length, t));
    setStatus("idle");
    if (!accepted.length) return;
    const toAdd = accepted.map((file): Attachment => {
      const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      return { uid: nextUid.current++, file, url, status: "uploading" };
    });
    setAttachments((prev) => [...prev, ...toAdd]);
    for (const att of toAdd) void uploadOne(att);
  }

  function removeAttachment(uid: number) {
    const target = attachments.find((a) => a.uid === uid);
    if (target?.url) URL.revokeObjectURL(target.url);
    setAttachments((prev) => prev.filter((a) => a.uid !== uid));
  }

  function handlePaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return; // let text paste through untouched
    e.preventDefault();
    addFiles(files);
  }

  function handleDrop(e: DragEvent) {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return; // text and cross-tab URL drops keep their default
    e.preventDefault();
    addFiles(files);
  }

  function handleDragOver(e: DragEvent) {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files);
    e.target.value = "";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const gate = attachmentIdsForSubmit(attachments);
    if (gate.blocked) {
      setError(
        gate.blocked === "uploading"
          ? t.attachmentsUploading
          : gate.blocked === "error"
            ? t.attachmentsFailed
            : t.attachmentMissingId,
      );
      setStatus("failed");
      return;
    }
    setStatus("submitting");
    try {
      await client.submit({ type, message, rating, attachment_ids: gate.ids });
      setStatus("succeeded");
      setMessage("");
      setRating(undefined);
      setHoverRating(undefined);
      // Revoke off the updater, not the render-time closure, so the list that
      // is cleared is exactly the list that was revoked.
      setAttachments((prev) => {
        for (const a of prev) if (a.url) URL.revokeObjectURL(a.url);
        return [];
      });
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const shownRating = hoverRating ?? rating ?? 0;

  // The shared slot holds selection and submit messages; a failed upload keeps
  // its reason on its own attachment so a retry clears it without a write here.
  const alert = error || attachments.find((a) => a.status === "error" && a.error)?.error || "";

  return (
    <>
      <button type="button" style={s.button} onClick={() => (isOpen ? close() : open())}>
        <MessageCircle size={18} {...iconProps} />
        {t.fab}
      </button>
      {isOpen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t.dialogLabel}
          style={s.dialog}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <form onSubmit={handleSubmit} style={{ display: "contents" }}>
            <TypeSelect value={type} onChange={setType} strings={t} styles={s} theme={theme} />

            <textarea
              required
              maxLength={10000}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-label={t.messageLabel}
              placeholder={t.messagePlaceholder(key)}
              style={s.textarea}
            />

            {attachments.length > 0 && (
              <div style={s.thumbs}>
                {attachments.map((a) => (
                  <div key={a.uid} style={a.status === "error" ? s.thumbError : s.thumb}>
                    {a.url ? (
                      <img src={a.url} alt={a.file.name} style={s.thumbImg} />
                    ) : (
                      <div style={s.thumbFile} title={a.file.name}>
                        {a.file.name}
                      </div>
                    )}
                    {a.status === "uploading" && <div style={s.thumbBusy}>{t.uploading}</div>}
                    {a.status === "error" && (
                      <button
                        type="button"
                        title={a.error ?? t.retryLabel}
                        aria-label={t.retryLabel}
                        onClick={() => void uploadOne(a)}
                        style={s.thumbRetry}
                      >
                        <RotateCcw size={12} {...iconProps} />
                        {t.retry}
                      </button>
                    )}
                    <button
                      type="button"
                      title={t.removeLabel}
                      aria-label={t.removeLabel}
                      onClick={() => removeAttachment(a.uid)}
                      style={s.thumbRemove}
                    >
                      <X size={12} {...iconProps} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={s.attachRow}>
              <button type="button" style={s.attachBtn} onClick={() => fileInputRef.current?.click()}>
                <Paperclip size={16} {...iconProps} />
                {t.attachButton}
              </button>
              <span style={s.hint}>{t.attachHint(key)}</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_MIME_TYPES.join(",")}
              aria-label={t.fileInputLabel}
              onChange={handleFileInput}
              style={{ display: "none" }}
            />

            <div
              style={s.stars}
              role="group"
              aria-label={t.ratingGroupLabel}
              onMouseLeave={() => setHoverRating(undefined)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  style={s.starBtn}
                  aria-label={t.star(n)}
                  aria-pressed={rating === n}
                  onMouseEnter={() => setHoverRating(n)}
                  onFocus={() => setHoverRating(n)}
                  onBlur={() => setHoverRating(undefined)}
                  onClick={() => setRating(rating === n ? undefined : n)}
                >
                  <Star
                    size={20}
                    fill={shownRating >= n ? theme.star : "none"}
                    {...iconProps}
                  />
                </button>
              ))}
              {shownRating > 0 && (
                <span style={s.starWord}>{t.ratingWords[shownRating as 1 | 2 | 3 | 4 | 5]}</span>
              )}
            </div>

            {status === "succeeded" && <p role="status" style={s.statusOk}>{t.thanks}</p>}
            {alert && <p role="alert" style={s.statusErr}>{alert}</p>}

            <div style={s.actions}>
              <button type="button" style={s.close} onClick={close}>
                {t.close}
              </button>
              <button type="submit" disabled={status === "submitting"} style={status === "submitting" ? s.submitDisabled : s.submit}>
                {status === "submitting" ? t.sending : t.send}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export * from "@pinpost/core";
