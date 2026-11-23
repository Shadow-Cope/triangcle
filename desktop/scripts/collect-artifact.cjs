"use strict";
const fs = require("node:fs");
const path = require("node:path");

const platform = process.argv[2];
const extension = platform === "win" ? ".exe" : platform === "mac" ? ".dmg" : "";
if (!extension) throw new Error("Usage: node scripts/collect-artifact.cjs win|mac");
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
if (found.length !== 1) throw new Error(`Expected one ${extension} bundle, found ${found.length}: ${found.join(", ")}`);
const output = path.join(__dirname, "..", "dist");
fs.mkdirSync(output, {recursive:true});
const destination = path.join(output, platform === "win" ? "Triancle-Setup.exe" : "Triancle-mac.dmg");
fs.copyFileSync(found[0], destination);
console.log(`Collected ${path.relative(process.cwd(), destination)}`);
