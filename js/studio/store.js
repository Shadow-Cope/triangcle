"use strict";

/* =====================================================================
   Triancle Studio - saved games (first version: kept on this device)
   A studio game uses the same part-row format as the game maps:
   [sx, sy, sz, x, y, z, rotation(3x3), colour, transparency, canCollide, shape]
   ===================================================================== */
const STUDIO_LS = "triangle_studio_games";

function studioBaseplateMap() {
  return {
    spawn: [0, 3, 0],
    parts: [
      [512, 20, 512, 0, -10, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0x636262, 0, 1, 1],
      [12, 1, 12, 0, 0.5, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0xa3a2a5, 0, 1, 1],
    ],
  };
}

function studioNewGame(name) {
  const now = Date.now();
  return {
    id: "s" + now.toString(36) + Math.random().toString(36).slice(2, 6),
    name: studioCleanName(name) || "Untitled game",
    created: now,
    updated: now,
    thumb: "",
    map: studioBaseplateMap(),
  };
}

function studioCleanName(name) {
  return typeof name === "string"
    ? name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40)
    : "";
}

function studioLoadAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(STUDIO_LS) || "{}");
    if (!raw || typeof raw !== "object") return [];
    return Object.keys(raw)
      .map(id => raw[id])
      .filter(g => g && typeof g.id === "string" && g.map && Array.isArray(g.map.parts))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  } catch (_) {
    return [];
  }
}

function studioWriteAll(list) {
  try {
    const out = {};
    for (const g of list) out[g.id] = g;
    localStorage.setItem(STUDIO_LS, JSON.stringify(out));
    return true;
  } catch (_) {
    return false;
  }
}

function studioGet(id) {
  return studioLoadAll().find(g => g.id === id) || null;
}

function studioUpsert(game) {
  const list = studioLoadAll();
  const i = list.findIndex(g => g.id === game.id);
  if (i >= 0) list[i] = game; else list.push(game);
  studioWriteAll(list);
  return game;
}

function studioRemove(id) {
  const list = studioLoadAll().filter(g => g.id !== id);
  studioWriteAll(list);
}

function studioTimeAgo(ts) {
  const secs = Math.max(0, Math.floor((Date.now() - (ts || 0)) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hours / 24);
  if (days < 30) return days + (days === 1 ? " day ago" : " days ago");
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
