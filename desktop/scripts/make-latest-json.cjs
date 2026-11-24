// Builds the update manifests (latest.json / latest-studio.json) from the release artifacts.
//
//   node scripts/make-latest-json.cjs <artifacts-dir> <version-or-tag>
//
// Expects the updater bundles Tauri writes when bundle.createUpdaterArtifacts is on:
//   Windows: Triancle_1.0.8_x64-setup.nsis.zip      (+ .sig)
//   macOS:   Triancle.app.tar.gz                    (+ .sig)     [universal build]
//   Studio:  the same files with "Triancle Studio" in the name.
// Files can sit in nested folders (artifacts are extracted that way), so the folder is
// walked recursively. Spaces in asset names become '-' so the download URL is stable.
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.argv[2] || "artifacts";
const version = String(process.argv[3] || "").replace(/^v/, "");
const REPO = "https://github.com/Shadow-Cope/triangcle/releases/latest/download";

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("usage: make-latest-json.cjs <artifacts-dir> <version>");
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(root).filter((file) => !file.endsWith(".sig"));

function assetFor(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  // Tauri v2 signs the NSIS installer itself; the .nsis.zip form is the legacy v1 layout.
  if (!/\.nsis\.zip$|\.app\.tar\.gz$|-setup\.exe$/i.test(base)) return null;
  const sig = file + ".sig";
  if (!fs.existsSync(sig)) {
    console.warn("missing signature for", file);
    return null;
  }
  const clean = base.replace(/\s+/g, "-");
  if (clean !== base) fs.renameSync(file, path.join(dir, clean));
  const cleanSig = clean + ".sig";
  if (cleanSig !== base + ".sig") fs.renameSync(sig, path.join(dir, cleanSig));
  return {
    asset: clean,
    signature: fs.readFileSync(path.join(dir, cleanSig), "utf8").trim(),
  };
}

function manifest(wantStudio) {
  const platforms = {};
  const used = [];
  for (const file of files) {
    const base = path.basename(file);
    if (/studio/i.test(base) !== wantStudio) continue;
    const item = assetFor(file);
    if (!item) continue;
    const entry = { signature: item.signature, url: REPO + "/" + encodeURIComponent(item.asset) };
    if (/\.nsis\.zip$|-setup\.exe$/i.test(item.asset)) {
      platforms[/aarch64/i.test(item.asset) ? "windows-aarch64" : "windows-x86_64"] = entry;
    } else {
      platforms["darwin-x86_64"] = entry;          // universal build covers both Macs
      platforms["darwin-aarch64"] = entry;
    }
    used.push(item.asset);
  }
  if (!used.length) return null;
  return { version, notes: "Triancle update", pub_date: new Date().toISOString(), platforms };
}

const game = manifest(false);
const studio = manifest(true);
if (game) fs.writeFileSync(path.join(root, "latest.json"), JSON.stringify(game, null, 2));
if (studio) fs.writeFileSync(path.join(root, "latest-studio.json"), JSON.stringify(studio, null, 2));

console.log("latest.json:", game ? Object.keys(game.platforms).join(", ") : "none");
console.log("latest-studio.json:", studio ? Object.keys(studio.platforms).join(", ") : "none");
if (!game && !studio) {
  console.error("No updater bundles (*.nsis.zip / *.app.tar.gz with .sig) found under " + root);
  console.error("files seen:\n" + files.map((f) => "  " + path.relative(root, f)).join("\n"));
  process.exit(1);
}
