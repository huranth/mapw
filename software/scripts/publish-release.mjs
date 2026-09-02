#!/usr/bin/env node
// Publish a mapw release to the public `releases` storage bucket.
//
//   SUPABASE_SERVICE_ROLE=<service key> node scripts/publish-release.mjs \
//     [--exe <path-to-mapw.exe>] [--version <x.y.z>] [--notes "..."]
//
// Defaults: --exe  Frontend/release/mapw.exe (the electron-builder portable
// output), --version the Frontend package.json version.
// Uploads mapw-<version>.exe, then writes latest.json — the single source of
// truth that both the app's auto-updater and the website's download button read.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, "..", "Frontend");
const PROJECT_REF = "pdynfowdtiulrllqetbl";
const BUCKET = "releases";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE;
if (!serviceKey) {
  console.error("Set SUPABASE_SERVICE_ROLE (Supabase dashboard → Settings → API).");
  process.exit(1);
}

const exePath = resolve(arg("exe", resolve(frontendDir, "release", "mapw.exe")));
const pkg = JSON.parse(await readFile(resolve(frontendDir, "package.json"), "utf8"));
const version = arg("version", pkg.version);
const notes = arg("notes", "");

const info = await stat(exePath).catch(() => null);
if (!info?.isFile()) {
  console.error(`Not found: ${exePath} — run "npm run dist" in software/ first.`);
  process.exit(1);
}
const exe = await readFile(exePath);
const sha256 = createHash("sha256").update(exe).digest("hex");
const size = exe.length;
const objectBase = `https://${PROJECT_REF}.supabase.co/storage/v1/object/${BUCKET}`;

const upload = async (path, body, contentType) => {
  const res = await fetch(`${objectBase}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body,
  });
  if (!res.ok) {
    console.error(`Upload failed for ${path}: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
};

console.log(`Uploading mapw-${version}.exe (${(exe.length / 1024 / 1024).toFixed(1)} MB)…`);
await upload(
  `mapw-${version}.exe`,
  new Uint8Array(exe),
  "application/vnd.microsoft.portable-executable",
);

// Also upload .gz if present (for users who prefer gz)
let gzUrl = null;
const gzPath = `${exePath}.gz`;
const gzInfo = await stat(gzPath).catch(() => null);
if (gzInfo?.isFile()) {
  const gz = await readFile(gzPath);
  console.log(`Uploading mapw-${version}.exe.gz (${(gz.length / 1024 / 1024).toFixed(1)} MB)…`);
  await upload(
    `mapw-${version}.exe.gz`,
    new Uint8Array(gz),
    "application/gzip",
  );
  gzUrl = `${objectBase}/mapw-${version}.exe.gz`;
}

const latest = {
  version,
  url: `${objectBase}/mapw-${version}.exe`,
  ...(gzUrl ? { gzUrl } : {}),
  sha256,
  size,
  notes,
  publishedAt: new Date().toISOString(),
};
await upload("latest.json", JSON.stringify(latest, null, 2), "application/json");

console.log(`Published ${version}: ${latest.url}`);
if (gzUrl) console.log(`Also published gz: ${gzUrl}`);
console.log("The app's updater and the website download button will pick it up automatically.");
