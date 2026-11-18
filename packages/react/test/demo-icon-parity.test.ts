// web/demo/index.html is a deliberately build-free static page: no bundler, no
// React, so it cannot import lucide-react the way the admin app and this widget
// do. Its icons are therefore hand-inlined Lucide geometry — which silently
// goes stale when Lucide redraws a glyph, and silently drifts if someone hand-
// draws a new one.
//
// This test is the guard. It lives in the sdk workspace because that is where
// lucide-react and a CI-run test command already exist; it reaches out to the
// demo file by path rather than owning it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Bug,
  Check,
  ChevronDown,
  CircleCheck,
  Lightbulb,
  MessageCircle,
  Paperclip,
  RotateCcw,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";

const DEMO = fileURLToPath(new URL("../../../../web/demo/index.html", import.meta.url));

/** Every Lucide glyph the demo page is allowed to inline. */
const ALLOWED: Record<string, LucideIcon> = {
  Bug,
  Check,
  ChevronDown,
  CircleCheck,
  Lightbulb,
  MessageCircle,
  Paperclip,
  RotateCcw,
  Star,
  X,
};

/**
 * Reduces SVG markup to an ordered list of "tag:geometry" pairs, so the
 * comparison survives formatting differences (self-closing slashes, attribute
 * order, the wrapper's own width/height/class).
 */
function geometry(svgMarkup: string): string {
  const parts: string[] = [];
  const re = /<(path|polygon|circle|rect|line|polyline)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svgMarkup))) {
    const [, tag, attrs] = m;
    const keep = [...attrs.matchAll(/\b(d|points|cx|cy|r|x|y|width|height|x1|y1|x2|y2)="([^"]*)"/g)]
      .map(([, k, v]) => `${k}=${v.replace(/\s+/g, " ").trim()}`)
      .sort()
      .join(",");
    parts.push(`${tag}:${keep}`);
  }
  return parts.join("|");
}

/** The official geometry for each allowed icon, keyed by that geometry. */
const official = new Map<string, string>();
for (const [name, Cmp] of Object.entries(ALLOWED)) {
  const g = geometry(renderToStaticMarkup(createElement(Cmp)));
  assert.ok(g, `could not read geometry for ${name}`);
  official.set(g, name);
}

/** Every inline SVG body in the demo: both lucideSvg('…') calls and markup. */
function demoIcons(html: string): Array<{ where: string; geom: string }> {
  const found: Array<{ where: string; geom: string }> = [];
  for (const m of html.matchAll(/lucideSvg\(\s*'([^']*)'/g)) {
    found.push({ where: `lucideSvg('${m[1].slice(0, 40)}…')`, geom: geometry(m[1]) });
  }
  for (const m of html.matchAll(/<svg\b[^>]*>([\s\S]*?)<\/svg>/g)) {
    found.push({ where: `<svg> in markup: ${m[1].slice(0, 40).replace(/\s+/g, " ")}…`, geom: geometry(m[1]) });
  }
  // TYPE_ICONS entries are plain strings, not lucideSvg() call arguments.
  for (const m of html.matchAll(/^\s*(bug|suggestion|other):\s*'(<path[^']*)'/gm)) {
    found.push({ where: `TYPE_ICONS.${m[1]}`, geom: geometry(m[2]) });
  }
  return found.filter((f) => f.geom);
}

test("every inline icon in the demo page matches the Lucide original", () => {
  const html = readFileSync(DEMO, "utf8");
  const icons = demoIcons(html);

  assert.ok(icons.length >= 8, `expected to find the demo's inline icons, found ${icons.length}`);

  const unknown = icons.filter((i) => !official.has(i.geom));
  assert.deepEqual(
    unknown.map((u) => u.where),
    [],
    "these inline SVGs do not match any allowed Lucide icon at the installed version — " +
      "either Lucide redrew the glyph (copy the new geometry across) or someone hand-drew one " +
      "(use a Lucide icon instead, and add it to ALLOWED)",
  );
});

test("the demo uses the same glyphs the React widget imports", () => {
  const html = readFileSync(DEMO, "utf8");
  const used = new Set(demoIcons(html).map((i) => official.get(i.geom)!));
  // The widget's own icon set, which lucide-react now guarantees is current.
  for (const name of ["Bug", "Lightbulb", "MessageCircle", "ChevronDown", "Check", "Star", "X", "RotateCcw", "Paperclip"]) {
    assert.ok(used.has(name), `the demo no longer renders ${name}; the two surfaces have diverged`);
  }
});
