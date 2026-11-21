"use strict";

/* =====================================================================
   In-game menu (Esc): Players / Settings / Controls / Stats
   ===================================================================== */
var menuOpen = false, shiftLockEnabled = true;
var gmStatsEl = $("gmStats");
const SET_KEY = "tri_settings";
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY) || "{}");
    if (typeof s.sl === "boolean") shiftLockEnabled = s.sl;
    if (isFinite(s.off)) CFG.SHIFTLOCK_OFFSET = s.off;
    if (isFinite(s.turn)) CFG.SHIFTLOCK_TURN = s.turn;
    if (isFinite(s.sens)) CFG.CAM_SENS = s.sens;
    if (s.board === false) boardEl.style.display = "none";
  } catch (_) {}
}
function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify({ sl: shiftLockEnabled, off: CFG.SHIFTLOCK_OFFSET, turn: CFG.SHIFTLOCK_TURN, sens: CFG.CAM_SENS, board: boardEl.style.display !== "none" })); } catch (_) {}
}
loadSettings();

const gm = $("gmenu");
function setSeg(id, val) { for (const b of $(id).children) b.classList.toggle("on", b.dataset.v === String(val)); }
function syncSettings() {
  setSeg("sGfx", gfxLevel); setSeg("sSL", shiftLockEnabled ? 1 : 0);
  setSeg("sBoard", boardEl.style.display === "none" ? 0 : 1); setSeg("sHit", hitOn ? 1 : 0);
  const sl = [["sOff", CFG.SHIFTLOCK_OFFSET, v => v.toFixed(2)], ["sTurn", CFG.SHIFTLOCK_TURN, v => String(Math.round(v))], ["sSens", CFG.CAM_SENS, v => (v / 0.0045).toFixed(1) + "x"]];
  for (const [id, v, f] of sl) { $(id).value = v; $(id + "V").textContent = f(+v); }
  $("gmWho").textContent = acct.user ? "Signed in as " + acct.username : "Playing as guest";
}
let gmTab = "settings", gmTimer = 0;
function gmShow(tab) {
  gmTab = tab;
  for (const b of document.querySelectorAll("#gmTabs button")) b.classList.toggle("on", b.dataset.gm === tab);
  for (const p of document.querySelectorAll(".gmp")) p.classList.toggle("on", p.id === "gm-" + tab);
  $("gmTitle").textContent = tab[0].toUpperCase() + tab.slice(1);
  if (tab === "players") renderMenuPlayers(true);
}
function openMenu() {
  if (menuOpen || !inGame) return;
  menuOpen = true; freeMouse(); syncSettings(); gm.classList.add("open"); gmShow(gmTab);
  loadSocial().then(() => renderMenuPlayers(true));
  gmTimer = setInterval(() => { if (gmTab === "players") renderMenuPlayers(); }, 600);
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false; clearInterval(gmTimer); gm.classList.remove("open"); saveSettings();
  if (document.activeElement) document.activeElement.blur();
}
function toggleMenu() { menuOpen ? closeMenu() : openMenu(); }
function leaveGame() { freeMouse(); flushSave().then(() => location.reload(), () => location.reload()); }
function menuKey(e) {
  if (e.target && e.target.type === "range") return;
  if (e.code === "KeyL") leaveGame();
  else if (e.code === "KeyR") { resetCharacter(); closeMenu(); }
}
for (const b of document.querySelectorAll("#gmTabs button")) b.addEventListener("click", () => gmShow(b.dataset.gm));
$("gmClose").addEventListener("click", closeMenu); $("gmRes").addEventListener("click", closeMenu);
$("gmLeave").addEventListener("click", leaveGame);
$("gmResp").addEventListener("click", () => { resetCharacter(); closeMenu(); });
$("gmLogout").addEventListener("click", signOutNow);
gm.addEventListener("mousedown", e => { if (e.target === gm) closeMenu(); });
$("tbLogo").addEventListener("click", openMenu); $("tbMenu").addEventListener("click", openMenu);
$("tbChat").addEventListener("click", () => { if (!menuOpen) toggleChat(); });

$("sGfx").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { setGraphics(+b.dataset.v); setSeg("sGfx", b.dataset.v); } });
$("sSL").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
  shiftLockEnabled = b.dataset.v === "1"; if (!shiftLockEnabled && shiftLock) setShiftLock(false); setSeg("sSL", b.dataset.v); saveSettings(); });
$("sBoard").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
  boardEl.style.display = b.dataset.v === "1" ? "block" : "none"; setSeg("sBoard", b.dataset.v); saveSettings(); });
$("sHit").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; hitOn = b.dataset.v === "1"; setSeg("sHit", b.dataset.v); });
$("sOff").addEventListener("input", e => { CFG.SHIFTLOCK_OFFSET = +e.target.value; $("sOffV").textContent = (+e.target.value).toFixed(2); });
$("sTurn").addEventListener("input", e => { CFG.SHIFTLOCK_TURN = +e.target.value; $("sTurnV").textContent = e.target.value; });
$("sSens").addEventListener("input", e => { CFG.CAM_SENS = +e.target.value; $("sSensV").textContent = (e.target.value / 0.0045).toFixed(1) + "x"; });
for (const id of ["sOff", "sTurn", "sSens"]) $(id).addEventListener("change", saveSettings);
