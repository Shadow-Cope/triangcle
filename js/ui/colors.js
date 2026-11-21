"use strict";

/* =====================================================================
   Body colours (in-game popup) + account (login / saving)
   Colours are stored as { Head: "#rrggbb", Torso: ..., LeftArm, RightArm, LeftLeg, RightLeg }.
   Guests save to this device; logged-in players save to Supabase (CFG.SAVE_TABLE).
   ===================================================================== */
const PART_ORDER = ["Head", "Torso", "LeftArm", "RightArm", "LeftLeg", "RightLeg"];
const PART_LABEL = { Head: "Head", Torso: "Torso", LeftArm: "Left Arm", RightArm: "Right Arm", LeftLeg: "Left Leg", RightLeg: "Right Leg" };
const PALETTE = [
  "#f2f3f3", "#e5e4df", "#a3a2a5", "#635f62", "#1b2a35", "#0b0b0b",
  "#f8d9b8", "#e7b98f", "#cc8e69", "#a05f35", "#694028", "#4a2d1b",
  "#c4281c", "#da8541", "#f5cd30", "#a4bd47", "#4b974b", "#287f47",
  "#18b3ad", "#75c6f0", "#0d69ac", "#203a56", "#6b327c", "#a06bbf",
  "#e8bac8", "#ff66cc", "#cd6298", "#7b2e2f", "#9a5b2b", "#d7c59a",
];
const HEX_RE = /^#[0-9a-f]{6}$/i;
const GUEST_KEY = "bodyColors";
const DEFAULT_COLORS = {};
for (const n of PART_ORDER) DEFAULT_COLORS[n] = "#" + PART_STYLE[n].toString(16).padStart(6, "0");

function sanitizeColors(o) {
  const out = {};
  for (const n of PART_ORDER) out[n] = (o && typeof o[n] === "string" && HEX_RE.test(o[n])) ? o[n].toLowerCase() : DEFAULT_COLORS[n];
  out.face = (o && Number.isInteger(o.face) && o.face >= 0 && o.face < 100000) ? o.face : 0;
  out.body = (o && o.body === "female") ? "female" : "male";
  return out;
}
const colorSig = c => PART_ORDER.map(n => c[n]).join() + "|" + c.face + "|" + (c.body === "female" ? "f" : "m");
function setAvatarColors(av, colors) {
  for (const n of PART_ORDER) { const pv = av.rig[n]; if (pv) pv.children[0].material.color.set(colors[n]); }
  setAvatarFace(av, colors.face | 0);
  setAvatarBody(av, colors.body === "female");
}
function applyRemoteColors(pl, colors) {
  if (!colors || typeof colors !== "object") return;
  const c = sanitizeColors(colors), sig = colorSig(c);
  if (pl.colorSig === sig) return;
  pl.colorSig = sig; pl.colors = c; setAvatarColors(pl.avatar, c);
}
function loadGuestColors() {
  try { return sanitizeColors(JSON.parse(localStorage.getItem(GUEST_KEY) || "null")); } catch (_) { return sanitizeColors(null); }
}
let myColors = loadGuestColors();
setAvatarColors(localAvatar, myColors);
const WEAR = { mine: [] };                       // ids of the UGC items you are wearing
function presenceInfo() { return { name: myName, colors: myColors, items: WEAR.mine }; }

const authEl = $("auth");
function uiAuthOpen() { return authEl.classList.contains("open"); }
function uiOpen() { return uiAuthOpen() || menuOpen; }
function freeMouse() {                          // popups need a normal cursor: let go of the mouse (shift lock stays ON and comes back after)
  for (const k in keys) keys[k] = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

/* ---- body colour popup ---- */
let colPart = "Head", saveTimer = 0, netColT = 0;
function saveStatus(t) { $("colSave").textContent = t; }
let hsv = { h: 0, s: 0, v: 1 };
function hsv2rgb(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
function hsvToHex(c) { return "#" + hsv2rgb(c.h, c.s, c.v).map(x => x.toString(16).padStart(2, "0")).join(""); }
function hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, v: mx };
}
function drawWheel() {
  const cv = $("wheel"), c = cv.getContext("2d"), N = cv.width, R = N / 2 - 3, img = c.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5, r = Math.hypot(dx, dy) / R;
    if (r > 1) continue;
    const i = (y * N + x) * 4, rgb = hsv2rgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r, hsv.v);
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const a = hsv.h * Math.PI / 180, mx = N / 2 + Math.cos(a) * hsv.s * R, my = N / 2 + Math.sin(a) * hsv.s * R;
  c.beginPath(); c.arc(mx, my, 7, 0, 6.2832); c.lineWidth = 4; c.strokeStyle = "#000"; c.stroke(); c.lineWidth = 2; c.strokeStyle = "#fff"; c.stroke();
}
(function buildColorsUI() {
  const parts = $("colParts"), cv = $("wheel");
  for (const n of PART_ORDER) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.p = n;
    b.innerHTML = '<span class="chip"></span><span>' + PART_LABEL[n] + "</span>";
    b.addEventListener("click", () => { colPart = n; refreshColorsUI(); });
    parts.appendChild(b);
  }
  let drag = false;
  const pick = e => {
    const rc = cv.getBoundingClientRect(), N = cv.width, R = N / 2 - 3;
    const dx = (e.clientX - rc.left) * N / rc.width - N / 2, dy = (e.clientY - rc.top) * N / rc.height - N / 2;
    hsv = { h: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(dx, dy) / R), v: hsv.v };
    setPartColor(colPart, hsvToHex(hsv));
  };
  cv.addEventListener("pointerdown", e => { drag = true; cv.setPointerCapture(e.pointerId); pick(e); });
  cv.addEventListener("pointermove", e => { if (drag) pick(e); });
  cv.addEventListener("pointerup", () => { drag = false; });
  cv.addEventListener("pointercancel", () => { drag = false; });
  $("valSlider").addEventListener("input", e => { hsv = { h: hsv.h, s: hsv.s, v: e.target.value / 100 }; setPartColor(colPart, hsvToHex(hsv)); });
  $("hexIn").addEventListener("input", e => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) setPartColor(colPart, v[0] === "#" ? v : "#" + v); });
})();
function refreshColorsUI() {
  const cur = myColors[colPart];
  for (const b of $("colParts").children) {
    b.classList.toggle("on", b.dataset.p === colPart);
    b.firstChild.style.background = myColors[b.dataset.p];
  }
  if (hsvToHex(hsv) !== cur) hsv = hexToHsv(cur);                 // picked a different part / reset / loaded a save
  $("valSlider").value = Math.round(hsv.v * 100); $("hexChip").style.background = cur;
  if (document.activeElement !== $("hexIn")) $("hexIn").value = cur;
  drawWheel();
  refreshFacesUI();
  for (const b of document.querySelectorAll("#avBody button")) b.classList.toggle("on", b.dataset.body === myColors.body);
}
function colorsChanged() {
  setAvatarColors(localAvatar, myColors);
  refreshColorsUI();
  clearTimeout(netColT);
  netColT = setTimeout(() => netSend({ t: "colors", colors: myColors }), 200);
  queueSave();
}
function setPartColor(n, hex) { myColors[n] = hex.toLowerCase(); colorsChanged(); }
function setMyColors(c) { myColors = c; setAvatarColors(localAvatar, myColors); refreshColorsUI(); netSend({ t: "colors", colors: myColors }); }
$("colReset").addEventListener("click", () => { const f = myColors.face, b = myColors.body; myColors = sanitizeColors(null); myColors.face = f; myColors.body = b; colorsChanged(); });
function openColors() {
  refreshColorsUI();
  saveStatus(acct.user ? "Saves to your account" : "Saves on this device (log in to keep it on your account)");
}
