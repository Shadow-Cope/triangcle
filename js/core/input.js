"use strict";

/* =====================================================================
   Input
   ===================================================================== */
const keys = Object.create(null);
window.addEventListener("keydown", e => {
  const tg = e.target, typingEl = tg && (tg.tagName === "TEXTAREA" || (tg.tagName === "INPUT" && tg.type !== "range"));
  if (e.code === "Escape" && inGame && !typingEl && !uiAuthOpen()) { e.preventDefault(); if (performance.now() - menuOpenedAt > 250) toggleMenu(); return; }
  if (menuOpen) { menuKey(e); return; }
  if (isTyping()) return;
  keys[e.code] = true;
  if (e.code === "Space" || e.code.startsWith("Arrow") || e.code === "Slash" || e.code === "Backquote") e.preventDefault();
  if (e.code === "Tab") { e.preventDefault(); boardEl.style.display = boardEl.style.display === "none" ? "block" : "none"; return; }
  if (e.repeat) return;
  if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && shiftLockEnabled && inGame && !uiOpen()) toggleShiftLock();
  if (e.code === "KeyR") resetCharacter();
  if (e.code === "Slash") document.body.classList.toggle("nohud");
  if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); openChat(); }
  if (e.code === "Backquote") hitOn = !hitOn;
  if (e.code === "Digit1") toggleBT();
});
window.addEventListener("keyup", e => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

let rmbDown = false;
let shiftLock = false;                                  // what the player WANTS (the Shift toggle). Stays on through the menu, chat and Esc.
const crossEl = document.getElementById("cross");
const hasLock = () => document.pointerLockElement === canvas;
let firstPerson = false, lockTry = 0, lockErrAt = 0;
function wantLock() { return !uiOpen() && (shiftLock || firstPerson); }
function ensureLock() {                                 // (re)grab the mouse whenever shift lock / first person wants it
  if (!inGame || !wantLock() || hasLock()) return;
  if (performance.now() - lockErrAt < 1300) return;     // browsers refuse for ~1 s after Esc / an error; don't spam
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
}
function setShiftLock(on) {
  shiftLock = on;
  canvas.style.cursor = on ? "none" : "";
  if (on) ensureLock(); else if (hasLock() && !rmbDown && !firstPerson) document.exitPointerLock();
}
function toggleShiftLock() { setShiftLock(!shiftLock); }
window.addEventListener("wheel", ensureLock, { passive: true });
window.addEventListener("mousemove", ensureLock);
window.addEventListener("pointerdown", ensureLock);
window.addEventListener("keydown", () => { if (!isTyping()) ensureLock(); });
document.addEventListener("pointerlockerror", () => { lockErrAt = performance.now(); });
document.addEventListener("pointerlockchange", () => {
  if (hasLock()) return;
  /* The mouse was released. If nothing of ours did it (Esc, or the browser), it was the player pressing Esc: browsers swallow
     that key press while the mouse is locked, so open the menu ourselves. Shift lock itself stays on. */
  if (inGame && wantLock() && !rmbDown && document.hasFocus()) { lockErrAt = performance.now(); openMenu(); }
});
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("mousedown", e => {
  if (isTyping()) document.activeElement.blur();
  ensureLock();
  if (e.button === 2) {
    rmbDown = true;
    if (!hasLock()) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  }
});
window.addEventListener("mouseup", e => {
  if (e.button === 2) {
    rmbDown = false;
    if (hasLock() && !wantLock()) document.exitPointerLock();
  }
});
window.addEventListener("mousemove", e => {
  if (!(rmbDown || (hasLock() && (shiftLock || firstPerson)))) return;    // a free cursor never steers the camera
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;   // ignore lock-jump spikes
  cam.yaw   -= e.movementX * CFG.CAM_SENS;
  cam.pitch += e.movementY * CFG.CAM_SENS;
  cam.pitch = Math.max(-CFG.CAM_PITCH_LIMIT, Math.min(CFG.CAM_PITCH_LIMIT, cam.pitch));
});
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const f = e.deltaY > 0 ? 1.14 : 1 / 1.14;
  cam.zoomTarget = Math.max(CFG.CAM_ZOOM_MIN, Math.min(CFG.CAM_ZOOM_MAX, cam.zoomTarget * f));
}, { passive: false });
