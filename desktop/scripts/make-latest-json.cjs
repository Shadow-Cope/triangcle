// Builds the update manifests (latest.json / latest-studio.json) from the release artifacts.
//
//   node scripts/make-latest-json.cjs <artifacts-dir> <version-or-tag>
//
// Expects the updater bundles Tauri writes when bundle.createUpdaterArtifacts is on:
//   Windows: Triancle_1.0.8_x64-setup.nsis.zip      (+ .sig)
//   macOS:   Triancle.app.tar.gz                    (+ .sig)     [universal build]
//   Studio:  the same files with "Triancle Studio" in the name.
// Spaces in asset names are replaced with '-' so the download URL is stable.
"use strict";

const fs = require("fs");
const path = require("path");

const dir = process.argv[2] || "artifacts";
const version = String(process.argv[3] || "").replace(/^v/, "");
const REPO = "https://github.com/Shadow-Cope/triangcle/releases/latest/download";

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("usage: make-latest-json.cjs <artifacts-dir> <version>");
  process.exit(1);
}

const files = fs.readdirSync(dir);

function rename(asset) {
  const clean = asset.replace(/\s+/g, "-");
  if (clean !== asset) fs.renameSync(path.join(dir, asset), path.join(dir, clean));
  const sigName = asset + ".sig";
  if (files.includes(sigName)) {
    const cleanSig = clean + ".sig";
    if (cleanSig !== sigName) fs.renameSync(path.join(dir, sigName), path.join(dir, cleanSig));
  }
  return clean;
}

function manifest(wantStudio) {
  const platforms = {};
  const used = [];
  for (const file of files) {
    if (file.endsWith(".sig")) continue;
    const isStudio = /studio/i.test(file);
    if (isStudio !== wantStudio) continue;
    if (!/\.nsis\.zip$|\.app\.tar\.gz$/i.test(file)) continue;

    const sigFile = path.join(dir, file + ".sig");
    if (!fs.existsSync(sigFile)) continue;

    const asset = rename(file);
    const entry = {
      signature: fs.readFileSync(path.join(dir, asset + ".sig"), "utf8").trim(),
      url: REPO + "/" + encodeURIComponent(asset),
    };
    if (/\.nsis\.zip$/i.test(asset)) {
      platforms[/aarch64/i.test(asset) ? "windows-aarch64" : "windows-x86_64"] = entry;
    } else {
      platforms["darwin-x86_64"] = entry;          // universal build covers both Macs
      platforms["darwin-aarch64"] = entry;
    }
    used.push(asset);
  }
  if (!used.length) return null;
  return {
    version,
    notes: "Triancle update",
    pub_date: new Date().toISOString(),
    platforms,
  };
}

const game = manifest(false);
const studio = manifest(true);
if (game) fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(game, null, 2));
if (studio) fs.writeFileSync(path.join(dir, "latest-studio.json"), JSON.stringify(studio, null, 2));

console.log("latest.json:", game ? Object.keys(game.platforms).join(", ") : "none");
console.log("latest-studio.json:", studio ? Object.keys(studio.platforms).join(", ") : "none");
if (!game && !studio) {
  console.error("No updater bundles (*.nsis.zip / *.app.tar.gz with .sig) found in " + dir);
  process.exit(1);
}
