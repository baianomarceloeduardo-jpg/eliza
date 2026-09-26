/** Exercises the content-addressed media store on the real filesystem: a truncated file left under the payload's hash is repaired on persist and restore, writes leave no temporary siblings, repeated writers of one hash stay complete. */
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

let stateDir: string;
let store: typeof import("../src/api/media-store.ts");

beforeAll(async () => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-store-atomic-"));
  vi.stubEnv("ELIZA_STATE_DIR", stateDir);
  store = await import("../src/api/media-store.ts");
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(stateDir, { recursive: true, force: true });
});

const PAYLOAD_BYTES = 4096;

function mediaDir(): string {
  return path.join(stateDir, "media");
}

function payload(seed: string): { bytes: Buffer; hash: string } {
  const bytes = Buffer.alloc(PAYLOAD_BYTES, seed);
  return {
    bytes,
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function seedTruncated(fileName: string): string {
  fs.mkdirSync(mediaDir(), { recursive: true });
  const filePath = path.join(mediaDir(), fileName);
  fs.writeFileSync(filePath, Buffer.alloc(100, "x"));
  return filePath;
}

function temporarySiblings(): string[] {
  return fs.readdirSync(mediaDir()).filter((name) => name.endsWith(".tmp"));
}

it("repairs a truncated file under the payload hash on persist and serves the complete bytes", () => {
  const { bytes, hash } = payload("a");
  const filePath = seedTruncated(`${hash}.bin`);

  const stored = store.persistMediaBytes(bytes, "application/octet-stream");

  expect(stored.fileName).toBe(`${hash}.bin`);
  expect(fs.readFileSync(filePath).equals(bytes)).toBe(true);
  const served = store.handleMediaRouteRequest(stored.url, "GET");
  expect(served.status).toBe(200);
  expect(served.body?.length).toBe(PAYLOAD_BYTES);
  expect(temporarySiblings()).toEqual([]);
});

it("repairs a truncated file on the backup-restore path", () => {
  const { bytes, hash } = payload("b");
  const fileName = `${hash}.bin`;
  const filePath = seedTruncated(fileName);

  expect(store.writeStoredMediaFile(fileName, bytes)).toBe(true);

  expect(fs.readFileSync(filePath).equals(bytes)).toBe(true);
  expect(temporarySiblings()).toEqual([]);
});

it("keeps repeated persists of the same content idempotent and complete", () => {
  const { bytes, hash } = payload("c");
  const results = Array.from({ length: 4 }, () =>
    store.persistMediaBytes(bytes, "image/png"),
  );
  for (const result of results) expect(result.fileName).toBe(`${hash}.png`);
  expect(
    fs.readFileSync(path.join(mediaDir(), `${hash}.png`)).equals(bytes),
  ).toBe(true);
  expect(temporarySiblings()).toEqual([]);
});

it("surfaces a failed write without leaving a partial file under the final name", () => {
  const { bytes, hash } = payload("d");
  const blocked = path.join(mediaDir(), `${hash}.bin`);
  // A directory under the final name makes the rename fail for real.
  fs.mkdirSync(path.join(blocked, "occupied"), { recursive: true });

  expect(() =>
    store.persistMediaBytes(bytes, "application/octet-stream"),
  ).toThrow();
  expect(fs.statSync(blocked).isDirectory()).toBe(true);
  expect(temporarySiblings()).toEqual([]);
  fs.rmSync(blocked, { recursive: true, force: true });
});
