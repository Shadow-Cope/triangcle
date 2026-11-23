/* Legacy Node fallback for environments where Rust is unavailable (zero dependencies, Node 18+).
 * The supported server is rust/triancle-server and is launched by `npm start`.
 *   1. serves the static site (index.html, css/, js/, assets/)
 *   2. relays the game's WebSocket messages between players (only used when Supabase is NOT configured
 *      in js/core/config.js - with Supabase set, multiplayer goes through Supabase Realtime instead).
 * Run fallback:  npm run start:node     (PORT env var is respected)
 * If you deploy as a Render *Static Site* you don't need this file at all. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MAX_MSG = 1024 * 1024;                              // largest WebSocket message we accept (1 MB)
const PUBLIC = ["index.html", "download.html", "studio.html", "css", "js", "assets"];     // only these are served
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".wasm": "application/wasm" };

/* ---------------- static files ---------------- */
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (_) { res.writeHead(400).end(); return; }
  if (p === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }).end("ok"); return; }
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  const rel = path.relative(ROOT, file).split(path.sep);
  if (rel[0] === ".." || !PUBLIC.includes(rel[0])) { res.writeHead(404).end("Not found"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    const ext = path.extname(file).toLowerCase();
    const etag = '"' + crypto.createHash("sha1").update(data).digest("hex").slice(0, 20) + '"';          // lets the browser see when a file changed
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }).end(); return; }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", ETag: etag,
      "Cache-Control": [".html", ".js", ".css"].includes(ext) ? "no-cache" : "public, max-age=3600" });
    req.method === "HEAD" ? res.end() : res.end(data);
  });
});

/* ---------------- tiny WebSocket implementation (RFC 6455) ---------------- */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function frame(op, payload) {
  const len = payload.length; let h;
  if (len < 126) h = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
  return Buffer.concat([h, payload]);
}

/* ---------------- relay: clients simulate themselves, the server only forwards ---------------- */
const clients = new Map();            // id -> { id, sock, name, colors, items, s, joined }
let nextId = 1;
const RELAY = new Set(["s", "died", "parts", "partdel", "partreq", "chat", "name", "colors"]);

function send(c, obj) {
  if (!c.sock.writable || c.sock.writableLength > MAX_MSG) return;
  c.sock.write(frame(0x1, Buffer.from(JSON.stringify(obj))));
}
function others(c, obj) { for (const o of clients.values()) if (o !== c && o.joined) send(o, obj); }

function onMessage(c, text) {
  let m; try { m = JSON.parse(text); } catch (_) { return; }
  if (!m || typeof m.t !== "string") return;
  if (m.t === "join") {
    if (c.joined) return;
    c.joined = true; c.name = String(m.name || "Player").slice(0, 20); c.colors = m.colors; c.items = m.items;
    send(c, { t: "welcome", id: c.id, players: [...clients.values()].filter(o => o !== c && o.joined)
      .map(o => ({ id: o.id, name: o.name, colors: o.colors, items: o.items, s: o.s })) });
    others(c, { t: "join", id: c.id, name: c.name, colors: c.colors, items: c.items });
    return;
  }
  if (!c.joined || !RELAY.has(m.t)) return;
  if (m.t === "name") c.name = String(m.name || c.name).slice(0, 20);
  if (m.t === "colors") c.colors = m.colors;
  if (m.t === "s") c.s = m;
  m.id = c.id;                                   // never trust an id sent by the client
  others(c, m);
}

server.on("upgrade", (req, sock) => {
  const key = req.headers["sec-websocket-key"];
  if (!key || String(req.headers.upgrade).toLowerCase() !== "websocket") { sock.destroy(); return; }
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  sock.setNoDelay(true);
  const c = { id: String(nextId++), sock, joined: false, alive: true };
  clients.set(c.id, c);
  let buf = Buffer.alloc(0), frag = null, fragOp = 0;
  const kill = () => { sock.destroy(); };
  sock.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f, masked = !!(buf[1] & 0x80);
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; if (buf.readUInt32BE(2)) return kill(); len = buf.readUInt32BE(6); off = 10; }
      if (!masked || len > MAX_MSG) return kill();
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 0x8) { sock.end(frame(0x8, Buffer.alloc(0))); return; }
      if (op === 0x9) { sock.write(frame(0xA, data)); continue; }
      if (op === 0xA) { c.alive = true; continue; }
      if (op === 0x1 || op === 0x2) { frag = [data]; fragOp = op; } else if (op === 0x0 && frag) frag.push(data); else return kill();
      if (frag.reduce((n, b) => n + b.length, 0) > MAX_MSG) return kill();
      if (fin) { const full = Buffer.concat(frag); frag = null; if (fragOp === 0x1) onMessage(c, full.toString("utf8")); }
    }
  });
  const gone = () => { if (!clients.delete(c.id)) return; if (c.joined) others(c, { t: "leave", id: c.id }); };
  sock.on("close", gone); sock.on("error", () => { gone(); sock.destroy(); });
});

/* keep idle connections alive through Render's proxy and drop dead ones */
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.sock.destroy(); continue; }
    c.alive = false; if (c.sock.writable) c.sock.write(frame(0x9, Buffer.alloc(0)));
  }
}, 30000).unref();

server.listen(PORT, () => console.log("Triancle server on http://localhost:" + PORT));
