"use strict";

/* =====================================================================
   Names, name tags and the player list (Tab)
   ===================================================================== */
const tagsEl = document.getElementById("tags");
const boardEl = document.getElementById("board");
const rowsEl = document.getElementById("rows");
const countEl = document.getElementById("pcount");
const nameInput = document.getElementById("nameInput");
const players = new Map();      // id -> { id, name, avatar, tag, local, target, alive }

function cleanName(s) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 20);
}
let myName = "";
try { myName = cleanName(localStorage.getItem("playerName")); } catch (_) {}
if (!myName) myName = "Player" + Math.floor(1000 + Math.random() * 9000);
nameInput.value = myName;

function addPlayer(id, name, local) {
  const avatar = local ? localAvatar : createAvatar();
  if (!local) { avatar.group.visible = false; scene.add(avatar.group); }
  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = name;
  tagsEl.appendChild(tag);
  const pl = { id, name, avatar, tag, local, target: null, alive: true };
  players.set(id, pl);
  renderBoard();
  return pl;
}
function removePlayer(id) {
  const pl = players.get(id);
  if (!pl || pl.local) return;
  pl.tag.remove(); if (pl.bubble) pl.bubble.remove();
  for (const pt of userParts.slice()) if (pt.owner === id) removePart(pt, true);
  scene.remove(pl.avatar.group);
  clearDebris(id);
  players.delete(id);
  renderBoard();
}
function renderBoard() {
  rowsEl.textContent = "";
  for (const pl of players.values()) {
    const row = document.createElement("div");
    row.className = "row" + (pl.local ? " me" : "");
    row.textContent = pl.name;
    rowsEl.appendChild(row);
  }
  countEl.textContent = String(players.size);
}
const me = addPlayer("me", myName, true);

function applyMyName() {
  const n = cleanName(nameInput.value) || myName;
  myName = n; nameInput.value = n;
  me.name = n; me.tag.textContent = n;
  try { localStorage.setItem("playerName", n); } catch (_) {}
  renderBoard();
  netSend({ t: "name", name: n });
}
let inGame = false, netStarted = false;
function isTyping() {
  const a = document.activeElement;
  return !inGame || !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}
nameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { applyMyName(); nameInput.blur(); }
  else if (e.key === "Escape") { nameInput.value = myName; nameInput.blur(); }
  e.stopPropagation();
});
nameInput.addEventListener("focus", () => { for (const k in keys) keys[k] = false; });
document.getElementById("nameBtn").addEventListener("click", () => { applyMyName(); nameInput.blur(); });

const _tp = new THREE.Vector3();
function updateTags() {
  const w = window.innerWidth, h = window.innerHeight, now = performance.now();
  const tanH = Math.tan(CFG.CAM_FOV * Math.PI / 360);
  for (const pl of players.values()) {
    const g = pl.avatar.group;
    let show = g.visible, sc = 1, px = 0, py = 0;
    if (show) {
      _tp.set(g.position.x, g.position.y + 5.9, g.position.z);
      const dist = _tp.distanceTo(camera.position);
      _tp.project(camera);
      show = _tp.z < 1 && dist <= CFG.NAME_DISTANCE;
      if (show) {
        px = Math.round((_tp.x * 0.5 + 0.5) * w); py = Math.round((-_tp.y * 0.5 + 0.5) * h);
        sc = CFG.TAG_WORLD_H * (h / 2) / (Math.max(dist, 0.1) * tanH) / 20;   // world-space size: shrinks/grows with distance like a part
        pl.tag.style.left = px + "px"; pl.tag.style.top = py + "px";
        pl.tag.style.transform = "scale(" + sc.toFixed(3) + ")";
      }
    }
    pl.tag.style.display = (show && !pl.local && !isBlocked(pl.name)) ? "block" : "none";   // your own name tag stays hidden
    if (pl.bubble) {
      const on = show && now < pl.bubbleEnd;
      pl.bubble.style.display = on ? "block" : "none";
      if (on) pl.bubble.style.transform = "translate(" + px + "px," + (py - (pl.local ? 8 : 28) * sc) + "px) translate(-50%,-100%) scale(" + sc.toFixed(3) + ")";
    }
  }
}

/* ---- in-game chat: Enter to type, bubbles over heads, log bottom-left ---- */
const chatLog = document.getElementById("chatlog"), chatInput = document.getElementById("chatInput");
let lastChat = 0;
function cleanChat(s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 120); }
function addChatLine(name, text) {
  const d = document.createElement("div"); d.className = "line";
  const b = document.createElement("b"); b.textContent = name + ":"; d.appendChild(b); d.appendChild(document.createTextNode(text));
  chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight;
  if (!document.body.classList.contains("chatopen")) $("tbChat").classList.add("dot");
  while (chatLog.children.length > 80) chatLog.removeChild(chatLog.firstChild);
  setTimeout(() => d.classList.add("old"), 12000);
}
function showBubble(pl, text) {
  if (!pl.local && isBlocked(pl.name)) return;
  if (!pl.bubble) { pl.bubble = document.createElement("div"); pl.bubble.className = "bubble"; tagsEl.appendChild(pl.bubble); }
  pl.bubble.textContent = text;
  pl.bubbleEnd = performance.now() + Math.min(10000, 4000 + text.length * 70);
}
function sendChat(raw) {
  const text = cleanChat(raw), now = performance.now();
  if (!text || now - lastChat < 600) return;
  lastChat = now;
  addChatLine(myName, text); showBubble(me, text); netSend({ t: "chat", text });
}
function onChat(m) {
  if (!m || !m.id || m.id === NET.id) return;
  const pl = players.get(String(m.id)), text = cleanChat(m.text);
  if (!pl || pl.local || !text || performance.now() - (pl.lastChat || 0) < 300) return;
  pl.lastChat = performance.now();
  if (isBlocked(pl.name)) return;
  addChatLine(pl.name, text); showBubble(pl, text);
}
function openChat() { setChat(true); chatInput.focus(); }
chatInput.addEventListener("focus", () => { for (const k in keys) keys[k] = false; chatLog.classList.add("active"); });
chatInput.addEventListener("blur", () => chatLog.classList.remove("active"));
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { sendChat(chatInput.value); chatInput.value = ""; chatInput.blur(); }
  else if (e.key === "Escape") { chatInput.value = ""; chatInput.blur(); }
  e.stopPropagation();
});
