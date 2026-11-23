"use strict";

/* ---- custom games: made from an uploaded Roblox .rbxl ---- */
const CUSTOM_LS = "triangle_custom_games_v2", CUSTOM_TABLE = "custom_games";
function addCustomEntry(id, name, by, thumb, icon, map, description, maxPlayers) {
  if (GAMES.some(g => g.id === id)) return GAMES.find(g => g.id === id);
  const about = okTxt(description, 600) || "A game made in Triancle Studio.";
  const g = { id, room: "c-" + id.toLowerCase(), custom: true, map: map || null, maxPlayers: Math.max(0, Math.min(100, maxPlayers | 0)), ovr: {}, def: { name: okTxt(name, 40) || "New game", by: okTxt(by, 20) || "Unknown", thumb: okImg(thumb) ? thumb : BLANK, icon: okImg(icon) ? icon : BLANK, banner: okImg(thumb) ? thumb : BLANK, about } };
  GAMES.push(g); return g;
}
try { const loc = JSON.parse(localStorage.getItem(CUSTOM_LS) || "{}"); for (const id in loc) { const r = loc[id]; let m = null; try { m = JSON.parse(r.map); } catch (_) {} if (m && m.parts) addCustomEntry(id, r.name, r.by, r.thumb, r.icon, m); } renderGames(); } catch (_) {}
function saveCustomLocal() {
  try { const o = {}; for (const g of GAMES) if (g.custom && g.map) o[g.id] = { name: g.def.name, by: g.def.by, map: JSON.stringify(g.map) }; localStorage.setItem(CUSTOM_LS, JSON.stringify(o)); return true; } catch (_) { return false; }
}
async function loadCustomGames() {
  const sb = getSB(); if (!sb) return;
  try {
    let r = await sb.from(CUSTOM_TABLE).select("id, name, owner_name, thumb, icon, description, max_players");
    if (r.error) r = await sb.from(CUSTOM_TABLE).select("id, name, owner_name, thumb, icon");     // older table (supabase_publish.sql not run yet)
    if (r.error) throw r.error;
    for (const row of (r.data || [])) if (/^c[a-z0-9]{3,20}$/.test(row.id)) addCustomEntry(row.id, row.name, row.owner_name, row.thumb, row.icon, null, row.description, row.max_players);
    renderGames();
  } catch (_) {}
}
async function loadCustomMap(g) {
  const sb = getSB(); if (!sb) throw new Error("no supabase");
  const r = await sb.from(CUSTOM_TABLE).select("map").eq("id", g.id).single(); if (r.error) throw r.error;
  const m = JSON.parse(r.data.map); if (!m || !Array.isArray(m.parts)) throw new Error("bad map"); g.map = m;
}

/* ---- reading a binary .rbxl in the browser ---- */
const RBX_ROT = {2:[1,0,0,0,1,0,0,0,1],3:[1,0,0,0,0,-1,0,1,0],5:[1,0,0,0,-1,0,0,0,-1],6:[1,0,0,0,0,1,0,-1,0],7:[0,1,0,1,0,0,0,0,-1],9:[0,0,1,1,0,0,0,1,0],10:[0,-1,0,1,0,0,0,0,1],12:[0,0,-1,1,0,0,0,-1,0],13:[0,1,0,0,0,1,1,0,0],14:[0,0,-1,0,1,0,1,0,0],16:[0,-1,0,0,0,-1,1,0,0],17:[0,0,1,0,-1,0,1,0,0],20:[-1,0,0,0,1,0,0,0,-1],21:[-1,0,0,0,0,1,0,1,0],23:[-1,0,0,0,-1,0,0,0,1],24:[-1,0,0,0,0,-1,0,-1,0],25:[0,1,0,-1,0,0,0,0,1],27:[0,0,-1,-1,0,0,0,1,0],28:[0,-1,0,-1,0,0,0,0,-1],30:[0,0,1,-1,0,0,0,-1,0],31:[0,1,0,0,0,-1,-1,0,0],32:[0,0,1,0,1,0,-1,0,0],34:[0,-1,0,0,0,1,-1,0,0],35:[0,0,-1,0,-1,0,-1,0,0]};
const RBX_PARTS = new Set(["Part", "SpawnLocation", "Seat", "VehicleSeat", "MeshPart", "WedgePart", "CornerWedgePart", "TrussPart"]);
const RBX_MAX_PARTS = 6000;
function lz4Block(src, n) {
  if (window.TriancleRust && window.TriancleRust.lz4) { const result = window.TriancleRust.lz4(src, n); if (result) return result; }
  const dst = new Uint8Array(n); let s = 0, d = 0;
  while (s < src.length && d < n) {
    const tok = src[s++]; let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    for (let i = 0; i < lit; i++) dst[d++] = src[s++];
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let ml = tok & 15; if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
    ml += 4; let m = d - off; for (let i = 0; i < ml; i++) dst[d++] = dst[m++];
  }
  return dst;
}
function loadZstd() {
  if (window.fzstd) return Promise.resolve();
  return new Promise((res, rej) => { const el = document.createElement("script"); el.src = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js"; el.onload = () => window.fzstd ? res() : rej(new Error("zstd")); el.onerror = () => rej(new Error("zstd")); document.head.appendChild(el); });
}
async function rbxToMap(buf) {
  const u8 = new Uint8Array(buf), dv0 = new DataView(buf);
  const sig = String.fromCharCode.apply(null, u8.subarray(0, 8));
  if (sig === "<roblox ") throw new Error("xml");
  if (sig !== "<roblox!") throw new Error("notrbx");
  const chunks = []; let off = 32;
  while (off + 16 <= u8.length) {
    const name = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]).replace(/\x00/g, "");
    const cl = dv0.getUint32(off + 4, true), ul = dv0.getUint32(off + 8, true); off += 16;
    let data;
    if (cl === 0) { data = u8.slice(off, off + ul); off += ul; }
    else {
      const raw = u8.subarray(off, off + cl); off += cl;
      if (raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd) { await loadZstd(); data = window.fzstd.decompress(raw); }
      else data = lz4Block(raw, ul);
    }
    chunks.push({ name, data }); if (name === "END") break;
  }
  if (window.TriancleRust && window.TriancleRust.rbxlMap) { const map = window.TriancleRust.rbxlMap(chunks); if (map) return map; }
  const td = new TextDecoder(), dvOf = d => new DataView(d.buffer, d.byteOffset, d.byteLength);
  const rdStr = (d, o) => { const n = dvOf(d).getUint32(o, true); return [td.decode(d.subarray(o + 4, o + 4 + n)), o + 4 + n]; };
  const deint = (d, o, n) => { if (window.TriancleRust && window.TriancleRust.deinterleave) { const result = window.TriancleRust.deinterleave(d, o, n); if (result) return result; } const out = new Array(n); for (let i = 0; i < n; i++) out[i] = ((d[o + i] * 16777216) + (d[o + n + i] << 16) + (d[o + 2 * n + i] << 8) + d[o + 3 * n + i]) >>> 0; return out; };
  const zz = v => window.TriancleRust && window.TriancleRust.zigzag ? window.TriancleRust.zigzag(v) : (v >>> 1) ^ -(v & 1);
  const fl = v => { if (window.TriancleRust && window.TriancleRust.rbxlFloat) return window.TriancleRust.rbxlFloat(v); v = ((v >>> 1) | (v << 31)) >>> 0; const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v); return b.getFloat32(0); };
  const refsOf = arr => { if (window.TriancleRust && window.TriancleRust.references) { const result = window.TriancleRust.references(arr); if (result) return result; } let a = 0; return arr.map(v => a += zz(v)); };
  const classes = {}, inst = new Map(), parent = new Map();
  const rustIndex = window.TriancleRust && window.TriancleRust.rbxlIndex ? window.TriancleRust.rbxlIndex(chunks) : null;
  if (rustIndex) {
    for (const [id, nm, refs] of rustIndex.classes) { classes[id] = { name: nm, refs }; for (const r of refs) inst.set(r, { c: nm, p: {} }); }
    for (const [child, par] of rustIndex.parents) parent.set(child, par);
  } else for (const c of chunks) if (c.name === "INST") {
    const d = c.data, dv = dvOf(d), id = dv.getUint32(0, true); let [nm, o] = rdStr(d, 4); o++;
    const n = dv.getUint32(o, true); o += 4; const refs = refsOf(deint(d, o, n));
    classes[id] = { name: nm, refs }; for (const r of refs) inst.set(r, { c: nm, p: {} });
  }
  const WANT = { Name: 1, size: 1, Size: 1, CFrame: 1, Color3uint8: 1, Transparency: 1, CanCollide: 1, shape: 1, Shape: 1 };
  for (const c of chunks) {
    const d = c.data, dv = dvOf(d);
    if (c.name === "PROP") {
      const id = dv.getUint32(0, true); let [pn, o] = rdStr(d, 4); const t = d[o++], cl = classes[id];
      if (!cl || !RBX_PARTS.has(cl.name) || !WANT[pn]) continue;
      const n = cl.refs.length; let vals = window.TriancleRust && window.TriancleRust.rbxlProperty ? window.TriancleRust.rbxlProperty(d, o, n, t) : null;
      if (!vals) {
      if (t === 1) { vals = []; for (let i = 0; i < n; i++) { let v; [v, o] = rdStr(d, o); vals.push(v); } }
      else if (t === 2) { vals = []; for (let i = 0; i < n; i++) vals.push(!!d[o + i]); }
      else if (t === 4) vals = deint(d, o, n).map(fl);
      else if (t === 18) vals = deint(d, o, n);
      else if (t === 14) { const X = deint(d, o, n).map(fl), Y = deint(d, o + 4 * n, n).map(fl), Z = deint(d, o + 8 * n, n).map(fl); vals = X.map((x, i) => [x, Y[i], Z[i]]); }
      else if (t === 26) { vals = []; for (let i = 0; i < n; i++) vals.push([d[o + i], d[o + n + i], d[o + 2 * n + i]]); }
      else if (t === 16) {
        const rot = [];
        for (let i = 0; i < n; i++) { const idb = d[o++]; if (idb === 0) { const m = []; for (let k = 0; k < 9; k++) { m.push(dv.getFloat32(o, true)); o += 4; } rot.push(m); } else rot.push(RBX_ROT[idb] || RBX_ROT[2]); }
        const X = deint(d, o, n).map(fl), Y = deint(d, o + 4 * n, n).map(fl), Z = deint(d, o + 8 * n, n).map(fl);
        vals = rot.map((r, i) => ({ pos: [X[i], Y[i], Z[i]], rot: r }));
      }
      }
      if (vals) cl.refs.forEach((r, i) => { inst.get(r).p[pn] = vals[i]; });
    } else if (c.name === "PRNT" && !rustIndex) {
      const n = dv.getUint32(1, true), ch = refsOf(deint(d, 5, n)), pa = refsOf(deint(d, 5 + 4 * n, n));
      ch.forEach((k, i) => parent.set(k, pa[i]));
    }
  }
  const memo = new Map();
  const inWs = r => { if (memo.has(r)) return memo.get(r); let x = r, res = false, guard = 0; while (x !== undefined && x >= 0 && guard++ < 200) { const q = inst.get(x); if (q && q.c === "Workspace") { res = true; break; } x = parent.get(x); } memo.set(r, res); return res; };
  const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
  const rows = []; let spawn = null, cut = 0;
  for (const [ref, q] of inst) {
    if (!RBX_PARTS.has(q.c) || !q.p.CFrame || !(q.p.size || q.p.Size) || !inWs(ref)) continue;
    if (rows.length >= RBX_MAX_PARTS) { cut++; continue; }
    const sz = q.p.size || q.p.Size, cf = q.p.CFrame, c = q.p.Color3uint8 || [163, 162, 165];
    const shape = q.p.shape !== undefined ? q.p.shape : q.p.Shape;
    const row = [r3(sz[0]), r3(sz[1]), r3(sz[2]), r3(cf.pos[0]), r3(cf.pos[1]), r3(cf.pos[2]), cf.rot.map(r4), (c[0] << 16) | (c[1] << 8) | c[2], r3(q.p.Transparency || 0), q.p.CanCollide === false ? 0 : 1, [0, 1, 2, 3, 4].includes(shape) ? shape : (q.c === "WedgePart" ? 3 : q.c === "CornerWedgePart" ? 4 : 1)];
    rows.push(row);
    if (q.c === "SpawnLocation" && !spawn) spawn = [row[3], row[4] + row[1] / 2 + 3, row[5]];
  }
  if (!rows.length) throw new Error("noparts");
  if (!spawn && window.TriancleRust && window.TriancleRust.defaultSpawn) spawn = window.TriancleRust.defaultSpawn(rows);
  if (!spawn) {
    let best = null;
    for (const r of rows) {
      const R = r[6], ex = Math.abs(R[0]) * r[0] + Math.abs(R[1]) * r[1] + Math.abs(R[2]) * r[2], ey = Math.abs(R[3]) * r[0] + Math.abs(R[4]) * r[1] + Math.abs(R[5]) * r[2], ez = Math.abs(R[6]) * r[0] + Math.abs(R[7]) * r[1] + Math.abs(R[8]) * r[2];
      if (Math.abs(r[3]) <= ex / 2 && Math.abs(r[5]) <= ez / 2) { const top = r[4] + ey / 2; if (!best || top > best) best = top; }
    }
    if (best !== null) spawn = [0, best + 3, 0];
    else { const r = rows.reduce((p, q) => (q[0] * q[2] > p[0] * p[2] ? q : p)); spawn = [r[3], r[4] + r[1] / 2 + 3, r[5]]; }
  }
  return { spawn: spawn.map(r3), parts: rows, cut };
}
function addCustomGame(name, by, map) {
  const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return addCustomEntry(id, name, by, null, null, map);
}
