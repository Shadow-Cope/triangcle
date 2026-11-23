"use strict";
const {spawn} = require("node:child_process");

const args = process.argv.slice(2);
const urlArg = args.find(arg => arg.startsWith("--url="));
if (urlArg) process.env.TRIANGLE_URL = urlArg.slice(6);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [cli, "dev", ...args.filter(arg => arg !== urlArg)], {
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
