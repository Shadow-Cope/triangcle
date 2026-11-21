"use strict";

/* =====================================================================
   Input
   ===================================================================== */
const keys = Object.create(null);
window.addEventListener("keydown", e => {
  const tg = e.target, typingEl = tg && (tg.tagName === "TEXTAREA" || (tg.tagName === "INPUT" && tg.type !== "range"));
  if (e.code === "Escape" && inGame && !typingEl && !uiAuthOpen()) { e.preventDefault(); toggleMenu(); return; }
  if (menuOpen) { menuKey(e); return; }
  if (isTyping()) return;
  keys[e.code] = true;
  if (e.code === "Space" || e.code.startsWith("Arrow") || e.code === "Slash" || e.code === "Backquote") e.preventDefault();
  if (e.code === "Tab") { e.preventDefault(); boardEl.style.display = boardEl.style.display === "none" ? "block" : "none"; return; }
  if (e.repeat) return;
  if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && shiftLockEnabled) toggleShiftLock();
  if (e.code === "KeyR") resetCharacter();
  if (e.code === "Slash") document.body.classList.toggle("nohud");
  if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); openChat(); }
  if (e.code === "Backquote") hitOn = !hitOn;
  if (e.code === "Digit1") toggleBT();
});
window.addEventListener("keyup", e => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

let rmbDown = false;
let shiftLock = false;
const crossEl = document.getElementById("cross");
function setShiftLock(on) {
  shiftLock = on;
  crossEl.style.display = on ? "block" : "none";
  canvas.style.cursor = on ? "none" : "";
  if (on) { try { canvas.requestPointerLock(); } catch (_) {} }
  else if (document.pointerLockElement && !rmbDown) document.exitPointerLock();
}
function toggleShiftLock() { setShiftLock(!shiftLock); }
let firstPerson = false;
function wantLock() { return !uiOpen() && (shiftLock || firstPerson); }
function ensureLock() {
  if (!wantLock() || document.pointerLockElement === canvas) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
}
window.addEventListener("wheel", ensureLock, { passive: true });
window.addEventListener("mousemove", ensureLock);
let lockTry = 0;
window.addEventListener("pointerdown", ensureLock);
window.addEventListener("keydown", () => { if (!isTyping()) ensureLock(); });
document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement && shiftLock) setShiftLock(false);
});
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("mousedown", e => {
  if (isTyping()) document.activeElement.blur();
  ensureLock();
  if (e.button === 2) {
    rmbDown = true;
    try { canvas.requestPointerLock(); } catch (_) {}
  }
});
window.addEventListener("mouseup", e => {
  if (e.button === 2) {
    rmbDown = false;
    if (document.pointerLockElement && !shiftLock) document.exitPointerLock();
  }
});
window.addEventListener("mousemove", e => {
  if (!rmbDown && !shiftLock && !(firstPerson && document.pointerLockElement)) return;
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
