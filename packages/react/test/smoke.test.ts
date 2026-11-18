// Runtime smoke against the built package: the widget server-renders without
// crashing. Uses createElement so no JSX transform is involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PinpostProvider, FeedbackWidget } from "@pinpost/react";

test("FeedbackWidget renders inside PinpostProvider", () => {
  const html = renderToString(
    createElement(PinpostProvider, { writeKey: "wk_test" }, createElement(FeedbackWidget)),
  );
  assert.ok(html.includes("button"));
});
