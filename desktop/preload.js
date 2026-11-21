"use strict";
/* The only thing the website gets from the app: a flag that says "I'm the app", plus a retry button for the offline page. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("TriancleApp", Object.freeze({
  isApp: true,
  platform: process.platform,
  retry: () => ipcRenderer.send("retry"),
}));
