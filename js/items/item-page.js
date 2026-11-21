"use strict";

/* ---- item page: preview, Try On, and the place where you buy / wear ---- */
const IP = { id: null, tok: 0, lock: false, tryOn: false, yaw: 0.6, pitch: 0.12, drag: null, running: false, S: null, desc: "", created: "", sig: "" };
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
function ipGL() {
  if (IP.S) return IP.S;
  let r; try { r = new THREE.WebGLRenderer({ canvas: $("ipCv"), antialias: true, alpha: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar(), stage = new THREE.Group();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  av.group.visible = false; sc.add(av.group); sc.add(stage);
  return (IP.S = { r, sc, cam, av, stage });
}
function ipNote(t, bad) { const n = $("ipNote"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; }
function ipLockUI() { const b = $("ipLock"); b.innerHTML = IP.lock ? LOCK_SVG : UNLOCK_SVG; b.classList.toggle("locked", IP.lock); b.title = IP.lock ? "Rotation locked" : "Rotation unlocked"; }
function ipPaint() {
  const it = ITM.rows.get(IP.id); if (!it) return;
  const me = acct.user && acct.user.id, price = +it.price || 0, p = SOC.cache.get(it.creator);
  const has = !!me && (it.creator === me || INV.owned.has(it.id));
  $("ipName").textContent = it.name;
  $("ipBy").innerHTML = 'By <u data-pid="' + esc(it.creator) + '">' + esc(p ? p.username : "Someone") + "</u>";
  $("ipDesc").textContent = IP.desc || "No description yet.";
  $("ipPrice").innerHTML = price ? TRI_SVG + fmtT(price) : "FREE";
  $("ipType").textContent = it.attach === "Head" ? "Hat" : slotName(it.attach);
  const d = IP.created ? new Date(IP.created) : null;
  $("ipCreated").textContent = d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";
  $("ipSold").textContent = fmtT(it.sales || 0);
  const g = $("ipGet"); g.disabled = false; g.dataset.armed = ""; g.classList.remove("arm");
  if (has) { const on = WEAR.mine.includes(it.id); g.dataset.mode = "wear"; g.dataset.on = on ? 0 : 1; g.textContent = on ? "Take off" : "Wear"; g.className = on ? "btnG" : "btnP"; }
  else if (!me) { g.dataset.mode = "login"; g.textContent = "Log in to get"; g.className = "btnP"; }
  else { g.dataset.mode = "buy"; g.textContent = "Get"; g.className = "btnP"; }
}
async function ipLoadExtras(id, tok) {                              // description / created date, if this database has them
  const sb = getSB(); if (!sb) return;
  let row = null;
  try { const r = await sb.from("ugc_items").select("description, created_at").eq("id", id).maybeSingle(); if (!r.error) row = r.data; } catch (_) {}
  if (!row) { try { const r = await sb.from("ugc_items").select("created_at").eq("id", id).maybeSingle(); if (!r.error) row = r.data; } catch (_) {} }
  if (tok !== IP.tok) return;
  const it = ITM.rows.get(id);
  if (row) { IP.desc = String(row.description || "").slice(0, 600); IP.created = row.created_at || (it && it.published_at) || ""; }
  ipPaint();
}
async function ipBuildItem(tok) {                                   // the item on its own, centred, in the preview
  const S = ipGL(), it = ITM.rows.get(IP.id); if (!S || !it) return;
  while (S.stage.children.length) S.stage.remove(S.stage.children[0]);
  const m = await loadItemModel(it.file_path); if (!m || tok !== IP.tok) return;
  const inner = new THREE.Group(), k = m.k * (2.3 / 1.2);
  inner.add(m.scene.clone(true)); inner.scale.setScalar(k);
  inner.position.set(-m.c.x * k, -m.c.y * k, -m.c.z * k);
  const holder = new THREE.Group(); holder.add(inner); S.stage.add(holder);
}
async function ipTryOn(tok) {                                       // the item on your avatar (plus what you already wear)
  const S = ipGL(), it = ITM.rows.get(IP.id); if (!S || !it) return;
  setAvatarColors(S.av, myColors);
  const ids = WEAR.mine.includes(it.id) ? WEAR.mine.slice() : WEAR.mine.concat([it.id]).slice(-MAX_WORN);
  S.av.itemSig = ids.join(","); await applyItemsToAvatar(S.av, ids);
  if (tok !== IP.tok) return;
}
function ipMode() {
  const S = IP.S; if (!S) return;
  S.stage.visible = !IP.tryOn; S.av.group.visible = IP.tryOn;
  $("ipTry").classList.toggle("on", IP.tryOn); $("ipTry").textContent = IP.tryOn ? "Take Off" : "Try On";
}
function ipLoop(now) {
  if ($("pageItem").hidden || !IP.S || inGame) { IP.running = false; return; }
  requestAnimationFrame(ipLoop);
  const S = IP.S, cv = S.r.domElement, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (w && (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr))) { S.r.setPixelRatio(pr); S.r.setSize(w, h, false); S.cam.aspect = w / h; S.cam.updateProjectionMatrix(); }
  if (!IP.lock && !IP.drag) IP.yaw += 0.008;
  const it = ITM.rows.get(IP.id);
  if (IP.tryOn) {
    const v = (it && UG_VIEW[it.attach]) || [4.6, 8];
    S.av.group.rotation.y = -Math.PI / 2 + IP.yaw; S.av.group.position.y = 0;
    S.cam.position.set(0, v[0] + 0.5, v[1] + 1); S.cam.lookAt(0, v[0], 0);
  } else {
    S.stage.rotation.y = IP.yaw; S.stage.rotation.x = IP.pitch; S.stage.position.y = 0;
    S.cam.position.set(0, 0.2, 5.2); S.cam.lookAt(0, 0, 0);
  }
  S.r.render(S.sc, S.cam);
}
async function openItem(id) {
  const it = ITM.rows.get(id) || SHOP.rows.find(x => x.id === id); if (!it) return;
  ITM.rows.set(id, Object.assign({}, ITM.rows.get(id) || {}, it));
  IP.id = id; const tok = ++IP.tok;
  IP.desc = ""; IP.created = it.published_at || ""; IP.tryOn = false; IP.lock = false; IP.yaw = 0.6; IP.pitch = 0.12;
  prevOn = false;
  for (const x of document.querySelectorAll("#hTabs button")) x.classList.toggle("on", x.dataset.tab === "shop");
  for (const x of document.querySelectorAll(".tabsec")) x.hidden = true;
  $("pageGame").hidden = true; $("pageItem").hidden = false; playIn($("pageItem"));
  ipNote(""); ipLockUI(); ipPaint(); ipLoadExtras(id, tok);
  if (!ipGL()) { ipNote("3D preview isn't available on this device.", true); return; }
  ipMode();
  await ipBuildItem(tok);
  if (tok !== IP.tok) return;
  if (!IP.running) { IP.running = true; requestAnimationFrame(ipLoop); }
}
(function () {
  const v = $("ipView");
  const end = () => { IP.drag = null; };
  v.addEventListener("pointerdown", e => { if (e.target.closest("button") || IP.lock) return; IP.drag = { x: e.clientX, y: e.clientY }; v.setPointerCapture(e.pointerId); });
  v.addEventListener("pointermove", e => { if (!IP.drag) return; IP.yaw += (e.clientX - IP.drag.x) * 0.012; IP.pitch = Math.max(-0.6, Math.min(0.6, IP.pitch + (e.clientY - IP.drag.y) * 0.006)); IP.drag = { x: e.clientX, y: e.clientY }; });
  v.addEventListener("pointerup", end); v.addEventListener("pointercancel", end);
})();
$("ipLock").addEventListener("click", () => { IP.lock = !IP.lock; ipLockUI(); });
$("ipTry").addEventListener("click", async () => {
  IP.tryOn = !IP.tryOn; ipMode();
  if (IP.tryOn) await ipTryOn(IP.tok);
});
$("ipBack").addEventListener("click", () => showTab("shop"));
$("ipGet").addEventListener("click", async () => {
  const b = $("ipGet"), it = ITM.rows.get(IP.id), sb = getSB(); if (!it || !sb) return;
  const mode = b.dataset.mode;
  if (mode === "login") { openAuth("login"); return; }
  if (mode === "wear") {
    b.disabled = true; const err = await equipItem(it.id, b.dataset.on === "1"); ipNote(err, !!err); ipPaint();
    if (IP.tryOn) ipTryOn(IP.tok);
    return;
  }
  const price = +it.price || 0;
  if (price && b.dataset.armed !== "1") {                           // paid items: first tap arms the button, second tap buys
    b.dataset.armed = "1"; b.classList.add("arm"); b.textContent = "Tap again to buy for " + fmtT(price);
    setTimeout(() => { if (b.isConnected && b.dataset.armed === "1") ipPaint(); }, 3500);
    return;
  }
  b.disabled = true; b.textContent = "Getting…"; ipNote("");
  try {
    const r = await sb.rpc("buy_ugc_item", { p_item: it.id, p_expected_price: price });
    if (r.error) throw r.error;
    WAL.bal = Number(r.data); walletUI(); INV.owned.add(it.id);
    ipNote("It's yours! Press Wear to put it on.");
    loadInventory(); paintShop();
  } catch (err) {
    const m = String(err && err.message || "");
    ipNote(m.includes("insufficient_funds") ? "You don't have enough Triangcles for that."
      : m.includes("already_owned") ? "You already own that item."
      : m.includes("price_changed") ? "The price just changed. Look again and retry."
      : m.includes("not_for_sale") ? "That item isn't for sale anymore."
      : m.includes("own_item") ? "That's your own item."
      : m.includes("not_logged_in") ? "Log in to get things."
      : "Couldn't get that. " + SQL_HINT, true);
    if (m.includes("already_owned")) loadInventory();
    if (m.includes("price_changed") || m.includes("not_for_sale")) { await renderShop(); const nit = ITM.rows.get(it.id); if (!SHOP.rows.find(x => x.id === it.id)) { showTab("shop"); return; } }
  }
  ipPaint();
});
