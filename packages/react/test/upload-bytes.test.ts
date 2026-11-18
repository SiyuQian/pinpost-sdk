// uploadBytes is the privacy control: it re-encodes images so EXIF (GPS, device
// serial, capture time) never reaches the server. Its contract is that a
// failure throws rather than falling back to the original bytes — without a
// test, a later "make it robust" catch would silently reinstate the leak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadBytes, MAX_ATTACHMENT_SIZE } from "@pinpost/react";

type Stubs = { blobs: Uint8Array[]; ctx: boolean; drawn: Array<[number, number]> };

/** Installs canvas + createImageBitmap stubs; returns a restore function. */
function stubCanvas(opts: Partial<Stubs> & { blobs: Array<Uint8Array | null> }) {
  const g = globalThis as Record<string, unknown>;
  const saved = { doc: g.document, cib: g.createImageBitmap };
  const drawn: Array<[number, number]> = [];
  let call = 0;

  g.createImageBitmap = async () => ({ width: 1000, height: 500, close() {} });
  g.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () =>
        opts.ctx === false
          ? null
          : {
              drawImage(_b: unknown, _x: number, _y: number, w: number, h: number) {
                drawn.push([w, h]);
              },
            },
      toBlob(cb: (b: unknown) => void) {
        const bytes = opts.blobs[Math.min(call++, opts.blobs.length - 1)];
        cb(bytes === null ? null : { arrayBuffer: async () => bytes.buffer });
      },
    }),
  };
  return { drawn, restore: () => Object.assign(g, { document: saved.doc, createImageBitmap: saved.cib }) };
}

const fileOf = (type: string, bytes: Uint8Array) => ({
  type,
  arrayBuffer: async () => bytes.buffer as ArrayBuffer,
});

test("uploadBytes passes non-re-encodable types through untouched", async () => {
  const raw = new Uint8Array([1, 2, 3, 4]);
  // No canvas stubs installed: a text file must never reach the canvas path.
  const out = await uploadBytes(fileOf("text/plain", raw));
  assert.deepEqual(Array.from(out), [1, 2, 3, 4]);
});

test("uploadBytes returns the re-encoded bytes for an image, not the original", async () => {
  const original = new Uint8Array([9, 9, 9, 9, 9, 9]);
  const reencoded = new Uint8Array([7, 7, 7]);
  const { restore } = stubCanvas({ blobs: [reencoded] });
  try {
    const out = await uploadBytes(fileOf("image/jpeg", original));
    assert.deepEqual(Array.from(out), [7, 7, 7]);
  } finally {
    restore();
  }
});

test("uploadBytes throws rather than returning raw bytes when re-encoding fails", async () => {
  const original = new Uint8Array([9, 9, 9]);
  const { restore } = stubCanvas({ blobs: [null] });
  try {
    await assert.rejects(
      () => uploadBytes(fileOf("image/png", original)),
      /could not re-encode/,
      "a re-encode failure must not fall back to the original bytes",
    );
  } finally {
    restore();
  }
});

test("uploadBytes throws when there is no 2d context", async () => {
  const { restore } = stubCanvas({ blobs: [new Uint8Array([1])], ctx: false });
  try {
    await assert.rejects(
      () => uploadBytes(fileOf("image/webp", new Uint8Array([1]))),
      /canvas 2d context unavailable/,
    );
  } finally {
    restore();
  }
});

test("uploadBytes downscales when the re-encode grows past the size cap", async () => {
  // First encode comes back over the cap, the second fits: the caller must get
  // the smaller one, and the second draw must be at reduced dimensions.
  const tooBig = new Uint8Array(MAX_ATTACHMENT_SIZE + 1024);
  const fits = new Uint8Array(1024);
  const { drawn, restore } = stubCanvas({ blobs: [tooBig, fits] });
  try {
    const out = await uploadBytes(fileOf("image/jpeg", new Uint8Array([1])));
    assert.equal(out.length, 1024);
    assert.equal(drawn.length, 2, "expected a second encode at a smaller scale");
    assert.ok(drawn[1][0] < drawn[0][0], `second draw should be narrower: ${JSON.stringify(drawn)}`);
  } finally {
    restore();
  }
});

test("uploadBytes gives up with a user-facing message when it cannot get under the cap", async () => {
  const tooBig = new Uint8Array(MAX_ATTACHMENT_SIZE + 1024);
  const { restore } = stubCanvas({ blobs: [tooBig] });
  try {
    await assert.rejects(
      () => uploadBytes(fileOf("image/jpeg", new Uint8Array([1]))),
      /still over 10 MiB after processing/,
    );
  } finally {
    restore();
  }
});
