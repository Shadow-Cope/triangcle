"use strict";

/* ---- home screen: Games + Avatar tabs ---- */
let starting = false;
function startGame() {
  if (!acct.user) { openAuth("login"); return; }
  if (starting) return; starting = true;
  const veil = $("veil"); veil.classList.add("on");                  // quick fade to black, swap to the game, fade back in
  setTimeout(async () => {
    if (curGame.custom && !curGame.map) { try { await loadCustomMap(curGame); } catch (_) { veil.classList.remove("on"); starting = false; alert("Couldn't load that map."); return; } }
    buildWorld(curGame); CFG.ROOM = curGame.room;                // the map you picked, and its own multiplayer room
    inGame = true; document.body.classList.remove("home");
    if (document.activeElement) document.activeElement.blur();
    last = performance.now();
    if (!netStarted) { netStarted = true; netConnect(); }          // you only show up for other players once you press Play
    veil.classList.remove("on");
  }, 220);
}
function openGamePage(id) {
  curGame = GAMES.find(g => g.id === id) || GAMES[0]; fillGamePage();
  prevOn = false;
  for (const s of document.querySelectorAll(".tabsec")) s.hidden = true; $("pageItem").hidden = true; $("pageGame").hidden = false;
  playIn($("pageGame"));
}
/* ---- games: Home cards, game page, and Owner editing of names / owners / thumbnails / icons ---- */
const gesc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GAME_TABLE = "game_settings", GAME_LS = "triangle_game_settings";
const BLANK = (function () { const c = document.createElement("canvas"); c.width = c.height = 8; const g = c.getContext("2d"); g.fillStyle = "#2a2418"; g.fillRect(0, 0, 8, 8); return c.toDataURL("image/png"); })();
const GAMES = [
  { id: "baseplate", room: "baseplate-1", ovr: {}, def: { name: "Baseplate", by: "Owen", thumb: $("playBase").querySelector("img").src, icon: $("gpIcon").src, banner: $("gpBannerImg").src, about: $("gpAbout").querySelector("p").textContent } },
  { id: "sharknado", room: "sharknado-1", ovr: {}, def: { name: "Sharknado", by: "Zed", thumb: BLANK, icon: BLANK, banner: BLANK, about: "A map by Zed. Climb the ramps and platforms, jump across the colourful pads, and chat with whoever else is here." } },
];
let curGame = GAMES[0];
const okImg = v => typeof v === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(v) && v.length < 400000;
const okTxt = (v, n) => typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n) : "";
function gv(g, k) { const o = g.ovr[k]; return o ? o : g.def[k]; }
function gBanner(g) { return g.ovr.thumb || g.def.banner; }
function applyGameRow(id, r) {                                        // r = { name, by, thumb, icon } (any may be missing)
  const g = GAMES.find(x => x.id === id); if (!g || !r) return;
  const o = {};
  if (okTxt(r.name, 40)) o.name = okTxt(r.name, 40);
  if (okTxt(r.by, 20)) o.by = okTxt(r.by, 20);
  if (okImg(r.thumb)) o.thumb = r.thumb;
  if (okImg(r.icon)) o.icon = r.icon;
  g.ovr = o;
}
function renderGames() {
  $("gameGrid").innerHTML = GAMES.map(g => `<button class="gcard" data-game="${g.id}" type="button"><span class="gimg"><img alt="${gesc(gv(g, "name"))}" src="${gesc(gv(g, "thumb"))}"><img class="gico" alt="" src="${gesc(gv(g, "icon"))}"></span><span class="gname">${gesc(gv(g, "name"))}</span><span class="gby">made by ${gesc(gv(g, "by"))}</span></button>`).join("");
}
function fillGamePage() {
  const g = curGame;
  $("gpTitle").textContent = gv(g, "name"); $("gpBy").innerHTML = "By <b>" + gesc(gv(g, "by")) + "</b>";
  $("gpIcon").src = gv(g, "icon"); $("gpBannerImg").src = gBanner(g);
  $("gpAbout").querySelector("p").textContent = gv(g, "about");
  if (window.refreshFav) window.refreshFav();
}
$("gameGrid").addEventListener("click", e => { const c = e.target.closest("[data-game]"); if (c) openGamePage(c.dataset.game); });
try { const saved = JSON.parse(localStorage.getItem(GAME_LS) || "{}"); for (const id in saved) applyGameRow(id, saved[id]); } catch (_) {}
renderGames();
async function loadGameSettings() {                                    // everyone reads the owner's saved names / pictures from Supabase
  const sb = getSB(); if (!sb) return;
  try {
    const r = await sb.from(GAME_TABLE).select("id, name, owner_name, thumb, icon"); if (r.error) throw r.error;
    const cache = {};
    for (const row of (r.data || [])) { const v = { name: row.name, by: row.owner_name, thumb: row.thumb, icon: row.icon }; applyGameRow(row.id, v); cache[row.id] = v; }
    try { localStorage.setItem(GAME_LS, JSON.stringify(cache)); } catch (_) {}
    renderGames(); if (!$("pageGame").hidden) fillGamePage(); if (!$("tabOwner").hidden) renderOwnerGames();
  } catch (_) {}
}
async function loadAllGames() { await loadCustomGames(); await loadGameSettings(); }
$("hLogo").addEventListener("click", () => showTab("home"));              // the triangle logo goes home
