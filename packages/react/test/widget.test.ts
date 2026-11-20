// Component-level coverage for the widget's attachment handlers. Three review
// rounds landed on this logic (the drop gating, the in-flight submit guard, the
// upload error lifecycle) and until now nothing in CI executed any of it — the
// only React test was an SSR smoke render that never reaches a handler.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createElement } from "react";

let dom: JSDOM;
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let PinpostProvider: typeof import("@pinpost/react").PinpostProvider;
let FeedbackWidget: typeof import("@pinpost/react").FeedbackWidget;
let usePinpost: typeof import("@pinpost/react").usePinpost;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  // `navigator` is a getter-only global on Node 24, so every one of these goes
  // in through defineProperty rather than assignment.
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", dom.window);
  define("document", dom.window.document);
  define("navigator", dom.window.navigator);
  define("HTMLElement", dom.window.HTMLElement);
  define("Event", dom.window.Event);
  define("File", dom.window.File);
  define("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom implements neither, and both are on the attachment path.
  dom.window.URL.createObjectURL = () => "blob:stub";
  dom.window.URL.revokeObjectURL = () => {};
  define("URL", dom.window.URL);

  ({ act } = await import("react"));
  ({ createRoot } = await import("react-dom/client"));
  ({ PinpostProvider, FeedbackWidget, usePinpost } = await import("@pinpost/react"));
});

after(() => dom.window.close());

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers: { get: (name: string) => string | null };
};

/** The subset of Response the client actually reads. */
function res(status: number, body: unknown = {}): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  };
}

/** Mounts the widget with a stubbed fetch and returns helpers for the test. */
async function mount(opts: { upload?: () => Promise<unknown> } = {}) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const calls: string[] = [];
  const fetchStub = async (url: string | URL, init?: { method?: string }) => {
    const path = String(url);
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.includes("/v1/attachment-uploads")) {
      if (opts.upload) return opts.upload() as never;
      return res(200, {
        attachment_id: `att_${calls.length}`,
        upload_url: "http://o/put",
        expires_at: "",
      }) as never;
    }
    if (path === "http://o/put") return res(200) as never;
    if (path.includes("/v1/feedback")) return res(200, { id: "fb_1", status: "received" }) as never;
    return res(200) as never;
  };

  Object.defineProperty(globalThis, "fetch", {
    value: fetchStub,
    configurable: true,
    writable: true,
  });

  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        PinpostProvider,
        { writeKey: "wk_test", apiUrl: "http://api" },
        createElement(FeedbackWidget),
      ),
    );
  });
  // Open the panel.
  await act(async () => {
    container.querySelector("button")!.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
  return { container, calls, root };
}

test("provider disables automatic browser context", async (t) => {
  const location = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("https://example.test/settings?fixture=value"),
  });
  t.after(() => {
    if (location) Object.defineProperty(globalThis, "location", location);
    else Reflect.deleteProperty(globalThis, "location");
  });

  for (const collectContext of [undefined, false]) {
    let captured: { context: Record<string, string> } | undefined;
    let pinpost: ReturnType<typeof usePinpost> | undefined;
    function ReadProvider() {
      pinpost = usePinpost();
      return null;
    }
    globalThis.fetch = async (_url, request) => {
      captured = JSON.parse(String(request?.body));
      return Response.json({ feedback_id: "fixture-feedback" }, { status: 201 });
    };
    const root = createRoot(dom.window.document.createElement("div"));
    try {
      await act(async () => {
        root.render(
          createElement(
            PinpostProvider,
            { writeKey: "wk_fixture", apiUrl: "https://pinpost.test", collectContext },
            createElement(ReadProvider),
          ),
        );
      });
      assert.ok(pinpost);
      pinpost.setContext({ section: "settings" });
      await pinpost.submit({ type: "suggestion", message: "Fixture feedback" });
      assert.ok(captured);
      if (collectContext === false) {
        assert.deepEqual(captured.context, { section: "settings" });
      } else {
        assert.equal(captured.context.url, "https://example.test/settings");
      }
    } finally {
      await act(async () => root.unmount());
    }
  }
});

test("dialog limits its width and wraps the rating row", async () => {
  const { container, root } = await mount();
  try {
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const rating = container.querySelector<HTMLElement>('[aria-label="Satisfaction rating (optional)"]')!;
    assert.equal(dialog.style.maxWidth, "calc(100% - 40px)");
    assert.equal(dialog.style.boxSizing, "border-box");
    assert.equal(rating.style.flexWrap, "wrap");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

const textFile = (name: string, body = "hello") =>
  new dom.window.File([body], name, { type: "text/plain" });

const alertText = (c: Element) => c.querySelector('[role="alert"]')?.textContent ?? "";
const thumbCount = (c: Element) => c.querySelectorAll('img, [title]').length;

test("drop with no files is not intercepted", async () => {
  const { container } = await mount();
  const dialog = container.querySelector('[role="dialog"]')!;

  const ev = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { files: [], types: ["text/plain"] } });
  await act(async () => {
    dialog.dispatchEvent(ev);
  });

  assert.equal(ev.defaultPrevented, false, "a text drop must keep its native behaviour");
  assert.equal(alertText(container), "");
});

test("drop carrying a file attaches it and uploads", async () => {
  const { container, calls } = await mount();
  const dialog = container.querySelector('[role="dialog"]')!;

  const ev = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: { files: [textFile("log.txt")], types: ["Files"] },
  });
  await act(async () => {
    dialog.dispatchEvent(ev);
  });

  assert.equal(ev.defaultPrevented, true, "a file drop must be intercepted");
  assert.ok(
    calls.some((c) => c.includes("/v1/attachment-uploads")),
    `expected an upload to start, saw: ${calls.join(", ")}`,
  );
});

test("dragover is only cancelled for file drags", async () => {
  const { container } = await mount();
  const dialog = container.querySelector('[role="dialog"]')!;

  const textDrag = new dom.window.Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(textDrag, "dataTransfer", { value: { files: [], types: ["text/plain"] } });
  const fileDrag = new dom.window.Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(fileDrag, "dataTransfer", { value: { files: [], types: ["Files"] } });

  await act(async () => {
    dialog.dispatchEvent(textDrag);
    dialog.dispatchEvent(fileDrag);
  });

  assert.equal(textDrag.defaultPrevented, false);
  assert.equal(fileDrag.defaultPrevented, true);
});

test("paste without file items keeps the default text paste", async () => {
  const { container } = await mount();
  const dialog = container.querySelector('[role="dialog"]')!;

  const ev = new dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { items: [{ kind: "string", getAsFile: () => null }] },
  });
  await act(async () => {
    dialog.dispatchEvent(ev);
  });

  assert.equal(ev.defaultPrevented, false, "plain-text paste must reach the textarea");
});

test("a rejected file reports why and attaches nothing", async () => {
  const { container, calls } = await mount();
  const dialog = container.querySelector('[role="dialog"]')!;

  const gif = new dom.window.File(["x"], "nope.gif", { type: "image/gif" });
  const ev = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { files: [gif], types: ["Files"] } });
  await act(async () => {
    dialog.dispatchEvent(ev);
  });

  assert.match(alertText(container), /1 rejected/);
  assert.ok(!calls.some((c) => c.includes("/v1/attachment-uploads")), "rejected file must not upload");
});

test("a failed upload shows its reason, and a successful retry clears it", async () => {
  let failNext = true;
  const { container } = await mount({
    // A 4xx, not a thrown network error: the client retries network failures
    // with backoff, which would push the error past this test's act() block.
    upload: async () => {
      if (failNext) {
        failNext = false;
        return res(400, { error: { code: "validation_failed", message: "presign expired" } });
      }
      return res(200, { attachment_id: "att_ok", upload_url: "http://o/put", expires_at: "" });
    },
  });
  const dialog = container.querySelector('[role="dialog"]')!;

  const ev = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: { files: [textFile("a.txt")], types: ["Files"] },
  });
  await act(async () => {
    dialog.dispatchEvent(ev);
  });

  assert.match(alertText(container), /Attachment upload failed/, "the reason must be surfaced");

  const retry = container.querySelector('button[aria-label="Retry upload"]');
  assert.ok(retry, "a failed attachment must offer a retry button");
  await act(async () => {
    retry!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  assert.equal(alertText(container), "", "a successful retry must clear the failure text");
});

test("attaching during an in-flight submit is refused with a message", async () => {
  let releaseSubmit: () => void = () => {};
  const held = new Promise<void>((r) => (releaseSubmit = r));

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const fetchStub = async (url: string | URL) => {
    if (String(url).includes("/v1/feedback")) {
      await held;
      return res(200, { id: "fb", status: "received" }) as never;
    }
    return res(200) as never;
  };

  Object.defineProperty(globalThis, "fetch", {
    value: fetchStub,
    configurable: true,
    writable: true,
  });

  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        PinpostProvider,
        { writeKey: "wk", apiUrl: "http://api" },
        createElement(FeedbackWidget),
      ),
    );
  });
  await act(async () => {
    container.querySelector("button")!.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });

  const dialog = container.querySelector('[role="dialog"]')!;
  const textarea = dialog.querySelector("textarea")! as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, "something broke");
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });

  // Start the submit but do not let it settle.
  await act(async () => {
    dialog.querySelector("form")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  });

  const ev = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: { files: [textFile("late.txt")], types: ["Files"] },
  });
  await act(async () => {
    dialog.dispatchEvent(ev);
  });

  assert.match(
    alertText(container),
    /Still sending your feedback/,
    "an attach during an in-flight submit must say so rather than vanish",
  );

  await act(async () => {
    releaseSubmit();
    await held;
  });
});

// --- type dropdown ---------------------------------------------------------

test("type dropdown opens, lists every type, and selecting updates the trigger", async () => {
  const { container } = await mount();
  const trigger = container.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement;
  assert.ok(trigger, "expected a listbox trigger rather than a row of pills");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.match(trigger.textContent ?? "", /Bug/);

  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const options = [...container.querySelectorAll('[role="option"]')];
  assert.deepEqual(
    options.map((o) => o.textContent),
    ["BugSomething is broken", "SuggestionAn idea for us", "OtherAnything else"],
  );
  assert.equal(
    options.filter((o) => o.getAttribute("aria-selected") === "true").length,
    1,
    "exactly one option is selected",
  );

  await act(async () => {
    options[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  assert.match(trigger.textContent ?? "", /Suggestion/);
  assert.equal(trigger.getAttribute("aria-expanded"), "false", "choosing closes the menu");
  assert.equal(container.querySelectorAll('[role="option"]').length, 0);
});

test("type dropdown is keyboard operable and Escape restores focus", async () => {
  const { container } = await mount();
  const trigger = container.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement;

  const key = (el: Element, k: string) =>
    el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));

  await act(async () => { key(trigger, "ArrowDown"); });
  assert.equal(trigger.getAttribute("aria-expanded"), "true", "ArrowDown opens the menu");

  const list = container.querySelector('[role="listbox"]')!;
  await act(async () => { key(list, "ArrowDown"); });
  await act(async () => { key(list, "Enter"); });

  assert.match(trigger.textContent ?? "", /Suggestion/, "ArrowDown+Enter selects the next type");

  await act(async () => { key(trigger, "Enter"); });
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  await act(async () => { key(container.querySelector('[role="listbox"]')!, "Escape"); });
  assert.equal(trigger.getAttribute("aria-expanded"), "false", "Escape closes the menu");
  assert.equal(dom.window.document.activeElement, trigger, "focus returns to the trigger");
});

// --- star rating -----------------------------------------------------------

// Star paints the fill on the <svg>, not the <polygon>.
const filledStars = (c: Element) =>
  [...c.querySelectorAll('[aria-label$="star"], [aria-label$="stars"]')].filter(
    (b) => (b.querySelector("svg")?.getAttribute("fill") ?? "none") !== "none",
  ).length;

test("hovering a star previews that rating without committing it", async () => {
  const { container } = await mount();
  const stars = [...container.querySelectorAll('[aria-label$="star"], [aria-label$="stars"]')];
  assert.equal(stars.length, 5);
  assert.equal(filledStars(container), 0);

  await act(async () => {
    stars[3].dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }));
  });

  assert.equal(filledStars(container), 4, "hover fills up to the hovered star");
  assert.match(container.textContent ?? "", /Good/, "hover shows the value's word");
  assert.equal(
    stars.filter((b) => b.getAttribute("aria-pressed") === "true").length,
    0,
    "hover must not commit a rating",
  );

  // Leaving the row drops the preview back to the held value (none).
  await act(async () => {
    container
      .querySelector('[role="group"][aria-label*="rating" i]')!
      .dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true }));
  });
  assert.equal(filledStars(container), 0, "the preview clears on mouse leave");
});

test("clicking a star commits it and clicking it again clears it", async () => {
  const { container } = await mount();
  const stars = [...container.querySelectorAll('[aria-label$="star"], [aria-label$="stars"]')];

  await act(async () => {
    stars[2].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(stars[2].getAttribute("aria-pressed"), "true");
  assert.equal(filledStars(container), 3);

  await act(async () => {
    stars[2].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(stars[2].getAttribute("aria-pressed"), "false", "clicking the held value clears it");
});
