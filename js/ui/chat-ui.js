"use strict";

/* =====================================================================
   Chat window, block, report, friend buttons on players
   ===================================================================== */
function setChat(on) {
  document.body.classList.toggle("chatopen", on);
  if (on) { chatLog.scrollTop = chatLog.scrollHeight; $("tbChat").classList.remove("dot"); } else chatInput.blur();
}
function toggleChat() {
  const on = !document.body.classList.contains("chatopen");
  setChat(on); if (on) chatInput.focus();
}

const BLOCK_KEY = "tri_blocked";
let blocked = new Set();
try { blocked = new Set(JSON.parse(localStorage.getItem(BLOCK_KEY) || "[]")); } catch (_) {}
function isBlocked(name) { return !!name && blocked.has(String(name).toLowerCase()); }
function toggleBlock(name) {
  const k = String(name).toLowerCase();
  if (blocked.has(k)) blocked.delete(k); else blocked.add(k);
  try { localStorage.setItem(BLOCK_KEY, JSON.stringify([...blocked])); } catch (_) {}
}

const uidCache = new Map();
async function uidFor(name) {
  if (uidCache.has(name)) return uidCache.get(name);
  const sb = getSB(); if (!sb) return null;
  try {
    const r = await sb.from(CFG.SAVE_TABLE).select("id").eq("username", name).maybeSingle();
    const id = r.data && r.data.id || null;
    if (id) uidCache.set(name, id); return id;
  } catch (_) { return null; }
}

/* ---- report ---- */
let rptName = "";
function openReport(name) {
  rptName = name; $("rptT").textContent = "Report " + name; $("rptText").value = ""; $("rptMsg").textContent = ""; $("rptSend").disabled = false;
  $("rpt").classList.add("open");
}
function closeReport() { $("rpt").classList.remove("open"); }
$("rptCancel").addEventListener("click", closeReport);
$("rpt").addEventListener("mousedown", e => { if (e.target === $("rpt")) closeReport(); });
$("rptText").addEventListener("keydown", e => e.stopPropagation());
$("rptSend").addEventListener("click", async () => {
  const sb = getSB(); if (!sb || !acct.user) { $("rptMsg").textContent = "Log in to send a report."; return; }
  $("rptSend").disabled = true; $("rptMsg").textContent = "Sending…";
  const id = await uidFor(rptName);
  let err = null;
  try {
    const r = await sb.from("reports").insert({ reporter: acct.user.id, reported_name: rptName, reported_id: id, reason: $("rptReason").value, details: $("rptText").value.trim().slice(0, 300) });
    err = r.error;
  } catch (e) { err = e; }
  if (err) { $("rptMsg").textContent = "Couldn't send. Run supabase_schema.sql first."; $("rptSend").disabled = false; }
  else { $("rptMsg").textContent = "Report sent. Thanks!"; setTimeout(closeReport, 1100); }
});

/* ---- block / report buttons on a profile page ---- */
function addSafetyBtns(p) {
  const box = $("pActs"); if (!box) return;
  const bb = document.createElement("button"); bb.type = "button"; bb.className = "btnG";
  const paint = () => { bb.textContent = isBlocked(p.username) ? "Unblock" : "Block"; };
  paint(); bb.addEventListener("click", () => { toggleBlock(p.username); paint(); });
  const rb = document.createElement("button"); rb.type = "button"; rb.className = "btnG"; rb.textContent = "Report";
  rb.addEventListener("click", () => openReport(p.username));
  box.appendChild(bb); box.appendChild(rb);
}

/* ---- menu player list: icon, add friend, report, block ---- */
let pSig = "";
function renderMenuPlayers(force) {
  const list = [...players.values()];
  const sig = list.map(pl => pl.name + (isBlocked(pl.name) ? "!" : "") + (pl.local ? "*" : "") + (pl.colorSig || "")).join("|") + "#" + SOC.friends.join() + SOC.outgoing.join() + SOC.incoming.join();
  if (!force && sig === pSig) return;
  pSig = sig;
  const box = $("gmPlayers"); box.textContent = "";
  for (const pl of list) {
    const row = document.createElement("div"); row.className = "pr" + (pl.local ? " me" : "");
    const img = document.createElement("img"); img.alt = ""; img.src = thumb(pl.local ? myColors : pl.colors, "face");
    const nm = document.createElement("b"); nm.textContent = pl.name;
    if (pl.local) { const s = document.createElement("small"); s.textContent = "you"; nm.appendChild(s); }
    row.appendChild(img); row.appendChild(nm);
    if (!pl.local) {
      const acts = document.createElement("div"); acts.className = "pacts";
      const fb = document.createElement("button"); fb.type = "button"; fb.className = "pbtn"; fb.textContent = "Add friend"; fb.disabled = true;
      const rb = document.createElement("button"); rb.type = "button"; rb.className = "pbtn"; rb.textContent = "Report";
      const bb = document.createElement("button"); bb.type = "button"; bb.className = "pbtn" + (isBlocked(pl.name) ? " on" : ""); bb.textContent = isBlocked(pl.name) ? "Unblock" : "Block";
      rb.addEventListener("click", () => openReport(pl.name));
      bb.addEventListener("click", () => { toggleBlock(pl.name); renderMenuPlayers(true); });
      acts.appendChild(fb); acts.appendChild(rb); acts.appendChild(bb); row.appendChild(acts);
      uidFor(pl.name).then(id => {
        if (!id) { fb.remove(); return; }
        const rel = relation(id);
        fb.textContent = rel === "friend" ? "Friends" : rel === "outgoing" ? "Request sent" : rel === "incoming" ? "Accept" : "Add friend";
        fb.classList.toggle("on", rel === "friend");
        fb.disabled = rel === "friend" || rel === "outgoing";
        fb.onclick = async () => { fb.disabled = true; await friendAct(rel === "incoming" ? "accept" : "add", id); renderMenuPlayers(true); };
      });
    }
    box.appendChild(row);
  }
}
