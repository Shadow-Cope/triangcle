"use strict";
const fs = require("node:fs");
const path = require("node:path");

const platform = process.argv[2];
const studio = platform === "studio-win" || platform === "studio-mac";
const win = platform === "win" || platform === "studio-win";
const mac = platform === "mac" || platform === "studio-mac";
if (!win && !mac) throw new Error("Usage: node scripts/collect-artifact.cjs win|mac|studio-win|studio-mac");

const extension = win ? ".exe" : ".dmg";
const target = path.join(__dirname, "..", "src-tauri", "target");
const found = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.toLowerCase().endsWith(extension) && file.includes(`${path.sep}bundle${path.sep}`)) found.push(file);
  }
}
walk(target);

// The game and Studio builds share target/, so only collect the bundle for this app.
const mine = found
  .filter(file => studio ? /studio/i.test(path.basename(file)) : !/studio/i.test(path.basename(file)))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
if (!mine.length) throw new Error(`No ${studio ? "Studio " : ""}${extension} bundle found in ${target}`);
const source = mine[0];

const output = path.join(__dirname, "..", "dist");
fs.mkdirSync(output, {recursive:true});
const name = studio
  ? (win ? "Triancle-Studio-Setup.exe" : "Triancle-Studio-mac.dmg")
  : (win ? "Triancle-Setup.exe" : "Triancle-mac.dmg");
const destination = path.join(output, name);
fs.copyFileSync(source, destination);
console.log(`Collected ${path.relative(process.cwd(), destination)}`);
