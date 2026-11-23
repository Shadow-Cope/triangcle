"use strict";

/* =====================================================================
   Multiplayer client (talks to the Rust relay over WebSocket)
   Client-authoritative: every client simulates itself and broadcasts its
   state; the server only relays.
   ===================================================================== */
const NET = {
  url: "", ws: null, id: null, status: "offline", retry: 0, timer: 0, idle: 0, lastSig: "",
  mode: (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? "supabase" : "ws",
  channel: null, interval: 0,
};
NET.interval = 1 / (NET.mode === "supabase" ? CFG.SUPABASE_SEND_HZ : CFG.NET_SEND_HZ);

function resolveServerUrl() {
  const q = new URLSearchParams(location.search).get("server");
  if (q) return q;
  if (CFG.SERVER_URL) return CFG.SERVER_URL;
  if (location.protocol === "http:" || location.protocol === "https:")
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  return "";   // opened as a local file: single-player unless SERVER_URL is set
}
function netSend(o) {
  if (NET.mode === "supabase") { sbSend(o); return; }
  if (NET.ws && NET.ws.readyState === 1) { try { NET.ws.send(JSON.stringify(o)); } catch (_) {} }
}
function netRetry() {
  NET.retry++;
  setTimeout(netConnect, Math.min(30000, 3000 * NET.retry));
}
/* ---------- Supabase Realtime transport (Broadcast for state, Presence for the player list) ---------- */
let _sb = null;     // one client shared by login (auth + database) and multiplayer (realtime)
function getSB() {
  if (_sb) return _sb;
  if (!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) || !window.supabase || !window.supabase.createClient) return null;
  _sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 20 } } });
  return _sb;
}
function sbConnect() {
  if (!window.supabase || !window.supabase.createClient) { NET.status = "offline (supabase-js failed to load)"; return; }
  NET.id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
  const client = getSB();
  if (!client) { NET.status = "offline (supabase-js failed to load)"; return; }
  const ch = client.channel(CFG.ROOM, { config: { broadcast: { self: false }, presence: { key: NET.id } } });
  ch.on("presence", { event: "sync" }, sbSync)
    .on("broadcast", { event: "s" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== NET.id) remoteState(String(payload.id), payload);
    })
    .on("broadcast", { event: "p" }, ({ payload }) => onPartMsg(payload))
    .on("broadcast", { event: "c" }, ({ payload }) => onChat(payload))
    .on("broadcast", { event: "died" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== NET.id) remoteDied(String(payload.id));
    })
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") { NET.status = "online"; NET.err = ""; ch.track(presenceInfo()); setTimeout(() => netSend({ t: "partreq" }), 700); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { NET.status = "offline – retrying"; NET.err = err && err.message ? String(err.message).slice(0, 80) : status; }
    });
  NET.channel = ch;
  NET.status = "connecting…";
}
function sbSync() {
  const st = NET.channel.presenceState();
  const seen = new Set();
  for (const key of Object.keys(st)) {
    if (key === NET.id) continue;
    seen.add(key);
    const meta = (st[key] && st[key][0]) || {};
    const pl = players.get(key);
    if (!pl) remoteJoin({ id: key, name: meta.name });
    else {
      const n = cleanName(meta.name);
      if (n && n !== pl.name) { pl.name = n; pl.tag.textContent = n; renderBoard(); }
    }
  }
  for (const key of seen) { const rp = players.get(key), mt = (st[key] && st[key][0]) || {}; if (rp) { applyRemoteColors(rp, mt.colors); applyRemoteItems(rp, mt.items); } }
  for (const id of Array.from(players.keys())) if (id !== "me" && !seen.has(id)) removePlayer(id);
}
function sbSend(o) {
  const ch = NET.channel;
  if (!ch || NET.status !== "online") return;
  try {
    if (o.t === "s") ch.send({ type: "broadcast", event: "s", payload: Object.assign({}, o, { id: NET.id }) });
    else if (o.t === "died") ch.send({ type: "broadcast", event: "died", payload: { id: NET.id } });
    else if (o.t === "parts" || o.t === "partdel" || o.t === "partreq") ch.send({ type: "broadcast", event: "p", payload: Object.assign({}, o, { id: NET.id }) });
    else if (o.t === "chat") ch.send({ type: "broadcast", event: "c", payload: { t: "chat", text: o.text, id: NET.id } });
    else if (o.t === "name" || o.t === "colors") ch.track(presenceInfo());
  } catch (_) {}
}

function netConnect() {
  if (NET.mode === "supabase") { sbConnect(); return; }
  NET.url = resolveServerUrl();
  if (!NET.url) { NET.status = "offline (single-player)"; return; }
  let ws;
  try { ws = new WebSocket(NET.url); } catch (_) { NET.status = "offline – retrying"; netRetry(); return; }
  NET.ws = ws; NET.status = "connecting…";
  ws.onopen = () => { NET.status = "online"; NET.retry = 0; netSend({ t: "join", name: myName, colors: myColors }); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
    onNetMessage(m);
  };
  ws.onclose = () => {
    NET.ws = null; NET.id = null; NET.status = "offline – retrying";
    for (const id of Array.from(players.keys())) if (id !== "me") removePlayer(id);
    netRetry();
  };
  ws.onerror = () => {};
}
function onNetMessage(m) {
  switch (m.t) {
    case "welcome": NET.id = m.id; for (const p of (m.players || [])) remoteJoin(p); break;
    case "join": remoteJoin(m); break;
    case "leave": removePlayer(String(m.id)); break;
    case "name": {
      const pl = players.get(String(m.id));
      if (pl && !pl.local) { pl.name = cleanName(m.name) || pl.name; pl.tag.textContent = pl.name; renderBoard(); }
      break;
    }
    case "colors": { const cp = players.get(String(m.id)); if (cp && !cp.local) applyRemoteColors(cp, m.colors); break; }
    case "s": remoteState(String(m.id), m); break;
    case "died": remoteDied(String(m.id)); break;
    case "parts": case "partdel": case "partreq": onPartMsg(m); break;
    case "chat": onChat(m); break;
  }
}
function remoteJoin(p) {
  const id = String(p.id);
  if (players.has(id)) return;
  const npl = addPlayer(id, cleanName(p.name) || "Player", false);
  applyRemoteColors(npl, p.colors); applyRemoteItems(npl, p.items);
  if (p.s) remoteState(id, p.s);
  setTimeout(sendAllMyParts, 400);   // newcomer gets everything we've built
}
function remoteState(id, m) {
  const pl = players.get(id);
  if (!pl || pl.local) return;
  const num = v => typeof v === "number" && isFinite(v);
  if (!num(m.x) || !num(m.y) || !num(m.z)) return;
  const first = !pl.target;
  pl.target = window.TriancleRust && window.TriancleRust.remoteSnapshot && window.TriancleRust.remoteSnapshot(m) || { x: m.x, y: m.y, z: m.z, f: num(m.f) ? m.f : 0, a: Array.isArray(m.a) ? m.a : [0, 0, 0, 0], ff: m.ff ? 1 : 0, l: num(m.l) ? m.l : 0, r: num(m.r) ? m.r : 0, b: num(m.b) ? m.b : 0 };
  if (m.al === 0) { pl.alive = false; return; }
  if (!pl.alive || first) {                       // (re)spawned: snap into place
    clearDebris(id);
    pl.avatar.group.position.set(m.x, m.y, m.z);
    pl.avatar.facing = pl.target.f;
    pl.alive = true;
  }
}
function remoteDied(id) {
  const pl = players.get(id);
  if (!pl || pl.local || !pl.alive || !pl.target) return;
  pl.alive = false;
  explode(pl.avatar, id, new THREE.Vector3());
  pl.avatar.group.visible = false;
}
const LIMBS = ["LeftArm", "RightArm", "LeftLeg", "RightLeg"];
function updateRemotes(dt) {
  const k = animationBlend(dt, 18);
  for (const pl of players.values()) {
    if (pl.local) continue;
    const av = pl.avatar, t = pl.target;
    if (!t || !pl.alive) { av.group.visible = false; continue; }
    av.group.visible = !isBlocked(pl.name);
    setFF(av, !!t.ff);
    const g = av.group.position;
    if (window.TriancleRust && window.TriancleRust.animateRemote) {
      const state = window.TriancleRust.animateRemote([k, av.ln, av.rl, av.by, g.x, g.y, g.z, av.facing,
        ...LIMBS.map(n => av.ang[n]), t.l, t.r, t.b, t.x, t.y, t.z, t.f, ...LIMBS.map((_, i) => +t.a[i] || 0)]);
      if (state) {
        [av.ln, av.rl, av.by, g.x, g.y, g.z, av.facing] = state.slice(1, 8);
        av.group.rotation.z = -av.ln; av.group.rotation.x = av.rl; av.group.rotation.y = av.facing + CFG.MODEL_FRONT_OFFSET;
        for (let i = 0; i < 4; i++) { const n = LIMBS[i]; av.ang[n] = state[8+i]; av.rig[n].rotation.z = av.ang[n]; }
        continue;
      }
    }
    av.ln += (t.l - av.ln) * k; av.rl += (t.r - av.rl) * k; av.by += (t.b - av.by) * k;
    g.x += (t.x - g.x) * k; g.y += (t.y + av.by - g.y) * k; g.z += (t.z - g.z) * k;
    av.group.rotation.z = -av.ln; av.group.rotation.x = av.rl;
    av.facing = wrapPi(av.facing + wrapPi(t.f - av.facing) * k);
    av.group.rotation.y = av.facing + CFG.MODEL_FRONT_OFFSET;
    for (let i = 0; i < 4; i++) {
      const n = LIMBS[i];
      av.ang[n] += ((+t.a[i] || 0) - av.ang[n]) * k;
      av.rig[n].rotation.z = av.ang[n];
    }
  }
}
