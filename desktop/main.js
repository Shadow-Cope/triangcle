"use strict";
/* Triangle desktop app (Electron). It is the website in its own window, plus:
     - it tells the site "you're in the app" (window.TriangleApp + a TriangleApp/x.y.z user-agent), which unlocks Play
     - it handles triangle://join/<gameId> links, which is how the website's Play button opens a game here
   The site address comes from (first match): --url=...  |  TRIANGLE_URL env var  |  config.json -> siteUrl */
const { app, BrowserWindow, Menu, ipcMain, session, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const SCHEME = "triangle";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OFFLINE = path.join(__dirname, "offline.html");

function readSite() {
  const arg = process.argv.find(a => a.startsWith("--url="));
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (_) {}
  const u = String((arg && arg.slice(6)) || process.env.TRIANGLE_URL || cfg.siteUrl || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(u) && !/YOUR-SITE-URL/i.test(u) ? u : "";
}
const SITE = readSite();
let win = null, pendingLink = null;

/* triangle://join/<id> -> id;  triangle://open (or anything else of ours) -> "";  not our scheme -> null */
function linkToGame(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== SCHEME + ":") return null;
    if (u.hostname === "join") { const id = decodeURIComponent(u.pathname.replace(/^\//, "")); return ID_RE.test(id) ? id : ""; }
    return "";
  } catch (_) { return null; }
}
const joinUrl = id => SITE + "/?join=" + encodeURIComponent(id);

function openLink(raw) {
  const id = linkToGame(raw); if (id === null) return;
  if (!win) { pendingLink = raw; return; }                  // not ready yet (macOS can deliver the link before the window exists)
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (id) win.loadURL(joinUrl(id));                         // the page reads ?join=, waits for login, then starts that game
}
function openExternal(url) { if (/^https:\/\//i.test(url)) shell.openExternal(url); }

function createWindow() {
  const iconFile = path.join(__dirname, "build", "icon.png");
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, show: false, backgroundColor: "#120f09", title: "Triangle",
    icon: fs.existsSync(iconFile) ? iconFile : undefined,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  const wc = win.webContents, origin = new URL(SITE).origin;
  wc.setUserAgent(wc.getUserAgent() + " TriangleApp/" + app.getVersion());
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { win = null; });

  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => {
    if (url === pathToFileURL(OFFLINE).href) return;
    try { if (new URL(url).origin === origin) return; } catch (_) {}
    e.preventDefault(); openExternal(url);                  // anything that isn't the site opens in the normal browser
  });
  wc.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && !String(url).startsWith("file:")) win.loadFile(OFFLINE);
  });

  const id = pendingLink ? linkToGame(pendingLink) : "";
  pendingLink = null;
  win.loadURL(id ? joinUrl(id) : SITE + "/");
}

function buildMenu() {
  const mac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    { label: "Triangle", submenu: [
      { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: () => win && win.loadURL(SITE + "/") },
      { role: "reload" }, { role: "togglefullscreen" },
      ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      { type: "separator" }, mac ? { role: "close" } : { role: "quit" },
    ] },
    { role: "editMenu" }, { role: "windowMenu" },
  ]));
}

/* register triangle:// (the installer's Info.plist handles macOS; this covers Windows and dev runs) */
if (process.defaultApp) { if (process.argv.length >= 2) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]); }
else app.setAsDefaultProtocolClient(SCHEME);

app.on("open-url", (e, url) => { e.preventDefault(); openLink(url); });           // macOS
const first = process.argv.find(a => a.startsWith(SCHEME + "://")); if (first) pendingLink = first;   // Windows / Linux cold start

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {                                       // Windows: a link opened while the app is already running
    const l = argv.find(a => a.startsWith(SCHEME + "://"));
    if (l) openLink(l); else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    if (!SITE) {
      dialog.showErrorBox("Triangle isn't set up", "This build has no website address. Put your site's URL in desktop/config.json (siteUrl) and rebuild.");
      app.quit(); return;
    }
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "fullscreen" || perm === "clipboard-sanitized-write"));
    ipcMain.on("retry", e => { if (win && e.sender === win.webContents) win.loadURL(SITE + "/"); });
    buildMenu(); createWindow();
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
