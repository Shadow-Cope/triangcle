"use strict";

/* =====================================================================
   AVATAR EDITOR (Roblox-style): tabs on top, a grid of what you own on the left, your player on the right.
   All / Body / Faces / Clothing / Accessories. Click a tile to wear it, click it again to take it off.
   ===================================================================== */
const AV = { tab: "all", rows: [], busy: false, tok: 0 };
const AV_TABS = ["all", "body", "faces", "clothing", "acc"];

(function buildAvatarEditor() {
  for (const b of document.querySelectorAll("#avTabs button")) b.addEventListener("click", () => avSetTab(b.dataset.av));
  for (const b of document.querySelectorAll("#avBody button")) b.addEventListener("click", () => { myColors.body = b.dataset.body === "female" ? "female" : "male"; colorsChanged(); });
  const pal = $("avPalette");                                       // quick colours for the part you picked
  pal.innerHTML = PALETTE.map(c => `<button type="button" class="sw" data-c="${c}" title="${c}" style="background:${c}"></button>`).join("");
  pal.addEventListener("click", e => { const b = e.target.closest(".sw"); if (b) setPartColor(colPart, b.dataset.c); });
  $("avGrid").addEventListener("click", onAvTile);
  $("avMore").addEventListener("click", () => { $("shType").value = AV.tab === "faces" ? "Face" : AV.tab === "clothing" ? "all" : AV.tab === "acc" ? "acc" : "all"; showTab("shop"); });
  $("avReset").addEventListener("click", () => { $("colReset").click(); });
})();

function avSetTab(t) {
  if (!AV_TABS.includes(t)) t = "all";
  AV.tab = t;
  for (const b of document.querySelectorAll("#avTabs button")) b.classList.toggle("on", b.dataset.av === t);
  $("avColors").hidden = t !== "body"; $("avItems").hidden = t === "body";
  if (t === "body") refreshColorsUI(); else paintAvGrid();
}

/* what the player owns, as rows: faces (incl. Classic and the face worn right now), clothes, accessories */
async function renderAvItems() {                                    // reload from the database, then paint
  if ($("tabAvatar").hidden) return;
  const sb = getSB(), tok = ++AV.tok;
  if (!sb || !acct.user) { AV.rows = []; $("avNote").textContent = "Log in to see your items."; paintAvGrid(); return; }
  if (!INV.loaded && INV.ok) { $("avNote").textContent = "Loading…"; return; }
  if (!INV.ok) { $("avNote").textContent = "Couldn't load your items. " + SQL_HINT; paintAvGrid(); return; }
  $("avNote").textContent = "";
  const ids = new Set(INV.owned);
  if (canUgc()) {                                                   // creators can also wear their own creations
    try { const r = await sb.from("ugc_items").select("id").eq("creator", acct.user.id); for (const x of (r.data || [])) ids.add(x.id); } catch (_) {}
  }
  await loadFaceMeta();
  const rows = await fetchItemRows(Array.from(ids));
  if (tok !== AV.tok) return;
  AV.rows = Array.from(ids).map(id => rows.get(id)).filter(Boolean);
  paintAvGrid();
}
function avFaceList() {
  const list = [{ no: 0, name: "Classic", src: FACE_SRC[0], id: null }], seen = new Set([0]);
  for (const it of AV.rows) if (isFace(it.attach)) { const no = faceNoOf(it); if (no && !seen.has(no)) { seen.add(no); list.push({ no, name: it.name, src: faceImgSrc(it.file_path), id: it.id }); } }
  const cur = myColors.face | 0;
  if (cur && !seen.has(cur)) list.push({ no: cur, name: FACE_NAMES[cur] || "Face " + cur, src: FACE_SRC[cur] || "", id: null });
  return list;
}
function paintAvGrid() {
  if (AV.tab === "body") return;
  const t = AV.tab, parts = [];
  const want = k => t === "all" || t === k;
  if (want("faces")) for (const f of avFaceList()) {
    const on = (myColors.face | 0) === f.no;
    parts.push(`<button type="button" class="avTile${on ? " on" : ""}" data-face="${f.no}" title="${esc(f.name)}"><img alt="" data-fsrc="${esc(f.src)}" src=""><span class="avCheck"></span><span class="avName">${esc(f.name)}</span></button>`);
  }
  const cl = AV.rows.filter(it => isCloth(it.attach)), ac = AV.rows.filter(it => !isCloth(it.attach) && !isFace(it.attach));
  const item = it => { const on = WEAR.mine.includes(it.id);
    return `<button type="button" class="avTile${on ? " on" : ""}" data-id="${esc(it.id)}" title="${esc(it.name)}"><img alt="" data-it="${esc(it.id)}" src=""><span class="avCheck"></span><span class="avName">${esc(it.name)}</span></button>`; };
  if (want("clothing")) parts.push(...cl.map(item));
  if (want("acc")) parts.push(...ac.map(item));
  const grid = $("avGrid"); grid.innerHTML = parts.join("");
  for (const im of grid.querySelectorAll("img[data-fsrc]")) faceThumb(im.dataset.fsrc, myColors.Head).then(u => { if (im.isConnected) im.src = u; });
  fillThumbs(grid);
  const empty = (t === "clothing" && !cl.length) ? "You don't own any clothing yet."
    : (t === "acc" && !ac.length) ? "You don't own any accessories yet."
    : (t === "all" && !parts.length) ? "Nothing here yet." : "";
  $("avEmpty").textContent = empty;
  $("avMore").hidden = !(t === "faces" || t === "clothing" || t === "acc" || t === "all");
  $("avMore").textContent = t === "faces" ? "Get more faces" : "Browse the Catalog";
  const n = WEAR.mine.length + ((myColors.face | 0) ? 1 : 0);
  $("avWearing").textContent = n ? "Wearing " + n + (n === 1 ? " item" : " items") : "Nothing extra on";
}
async function onAvTile(e) {
  const b = e.target.closest(".avTile"); if (!b || AV.busy) return;
  if (b.dataset.face !== undefined) {                               // faces: Classic is the "off" state
    const no = +b.dataset.face; myColors.face = (myColors.face | 0) === no ? 0 : no; colorsChanged(); paintAvGrid(); return;
  }
  AV.busy = true; b.classList.add("busy");
  const on = WEAR.mine.includes(b.dataset.id), err = await equipItem(b.dataset.id, !on);
  $("avNote").textContent = err; AV.busy = false; paintAvGrid();
}
/* called by the colour code whenever colours / face change */
function refreshFacesUI() {
  for (const b of document.querySelectorAll("#avBody button")) b.classList.toggle("on", b.dataset.body === myColors.body);
  for (const b of $("avPalette").children) b.classList.toggle("on", b.dataset.c === myColors[colPart]);
  if (AV.tab !== "body" && !$("tabAvatar").hidden) paintAvGrid();
}
