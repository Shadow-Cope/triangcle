"use strict";

/* owner page: edit games */
const OWG = {};                                                        // drafts while editing: { id: { name, by, thumb, icon } }
function owDraft(g) { return OWG[g.id] || (OWG[g.id] = { name: gv(g, "name"), by: gv(g, "by"), thumb: gv(g, "thumb"), icon: gv(g, "icon"), btools: g.btools || "all" }); }
function renderOwnerGames() {
  if (!isOwner()) return;
  $("owGames").innerHTML = GAMES.map(g => { const d = owDraft(g); return `<div class="owGame box" data-gid="${g.id}">
    <div class="owPrev"><img class="owThumb" alt="Thumbnail" src="${gesc(d.thumb)}"><img class="owIcon" alt="Icon" src="${gesc(d.icon)}"></div>
    <div class="owFields">
      <label>Game name<input type="text" data-f="name" maxlength="40" value="${gesc(d.name)}" autocomplete="off" spellcheck="false"></label>
      <label>Owner (made by)<input type="text" data-f="by" maxlength="20" value="${gesc(d.by)}" autocomplete="off" spellcheck="false"></label>
      <label>Building tools (BTools)<select data-f="btools" class="plSel"><option value="all"${d.btools === "all" ? " selected" : ""}>Everyone can use them</option><option value="staff"${d.btools === "staff" ? " selected" : ""}>Admins &amp; Owner only</option><option value="off"${d.btools === "off" ? " selected" : ""}>Off for everyone</option></select></label>
      <div class="owBtnRow"><button type="button" class="btnG" data-pick="thumb">Thumbnail…</button><button type="button" class="btnG" data-pick="icon">Icon…</button><button type="button" class="btnG" data-reset="1">Reset</button>${g.custom ? '<button type="button" class="btnG" data-del="1">Delete</button>' : ""}<button type="button" class="btnP" data-save="1">Save</button></div>
      <input type="file" accept="image/*" data-file="thumb" hidden><input type="file" accept="image/*" data-file="icon" hidden>
    </div></div>`; }).join("");
}
function fitImage(file, w, h, type) {                                  // center-crop to w x h and shrink so it stays small enough to save
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      const k = Math.max(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * k, dh = im.naturalHeight * k;
      g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh); URL.revokeObjectURL(url);
      res(c.toDataURL(type, 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    im.src = url;
  });
}
$("owGames").addEventListener("keydown", e => e.stopPropagation());
$("rbxName").addEventListener("keydown", e => e.stopPropagation()); $("rbxBy").addEventListener("keydown", e => e.stopPropagation());
$("rbxPick").addEventListener("click", () => { if (isOwner()) $("rbxFile").click(); });
$("rbxFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f || !isOwner()) return;
  const msg = $("owGMsg"); msg.textContent = "Reading " + f.name + "…";
  try {
    const map = await rbxToMap(await f.arrayBuffer());
    const g = addCustomGame($("rbxName").value || f.name.replace(/\.[^.]+$/, ""), $("rbxBy").value || acct.username, map);
    const localOK = saveCustomLocal(); renderGames(); renderOwnerGames(); $("rbxName").value = ""; $("rbxBy").value = "";
    msg.textContent = "Made \"" + gv(g, "name") + "\" from " + map.parts.length + " parts" + (map.cut ? " (" + map.cut + " extra parts left out)" : "") + ". Saving…";
    const sb = getSB();
    try {
      if (!sb) throw new Error("no supabase");
      const r = await sb.from(CUSTOM_TABLE).upsert({ id: g.id, name: gv(g, "name"), owner_name: gv(g, "by"), map: JSON.stringify(map), created_by: acct.user.id });
      if (r.error) throw r.error;
      msg.textContent = "Made \"" + gv(g, "name") + "\" from " + map.parts.length + " parts" + (map.cut ? " (" + map.cut + " extra parts left out)" : "") + ". It's on Home for everyone.";
    } catch (_) { msg.textContent = "Made \"" + gv(g, "name") + "\" from " + map.parts.length + " parts, but only " + (localOK ? "on this device" : "for this visit (too big to keep)") + ". Run supabase_custom_games.sql in Supabase so everyone can play it."; }
  } catch (err) {
    const m = err && err.message;
    msg.textContent = m === "xml" ? "That's a .rbxlx (XML) file. In Studio use File > Save to File and choose .rbxl." : m === "notrbx" ? "That doesn't look like a Roblox .rbxl file." : m === "zstd" ? "Couldn't load the decompressor. Check your internet and try again." : m === "noparts" ? "No parts were found in that file's Workspace." : "Couldn't read that file.";
  }
});
$("owGames").addEventListener("input", e => {
  const box = e.target.closest("[data-gid]"), f = e.target.dataset && e.target.dataset.f; if (!box || !f) return;
  OWG[box.dataset.gid][f] = e.target.value;
});
$("owGames").addEventListener("click", async e => {
  if (!isOwner()) return;
  const box = e.target.closest("[data-gid]"); if (!box) return;
  const g = GAMES.find(x => x.id === box.dataset.gid), d = owDraft(g), msg = $("owGMsg");
  const pick = e.target.closest("[data-pick]");
  if (pick) { box.querySelector(`[data-file="${pick.dataset.pick}"]`).click(); return; }
  if (e.target.closest("[data-del]")) {
    if (!g.custom || !confirm("Delete " + gv(g, "name") + " for everyone?")) return;
    GAMES.splice(GAMES.indexOf(g), 1); delete OWG[g.id]; saveCustomLocal(); renderGames(); renderOwnerGames();
    try { const all = JSON.parse(localStorage.getItem(GAME_LS) || "{}"); delete all[g.id]; localStorage.setItem(GAME_LS, JSON.stringify(all)); } catch (_) {}
    const sb = getSB(); if (sb) { try { await sb.from(CUSTOM_TABLE).delete().eq("id", g.id); await sb.from(GAME_TABLE).delete().eq("id", g.id); } catch (_) {} }
    msg.textContent = "Deleted."; return;
  }
  if (e.target.closest("[data-reset]")) {
    g.ovr = {}; delete OWG[g.id]; msg.textContent = "Reset to the original. Press Save on this game to keep it.";
    g.btools = "all"; OWG[g.id] = { name: g.def.name, by: g.def.by, thumb: g.def.thumb, icon: g.def.icon, btools: "all" }; renderOwnerGames(); return;
  }
  if (e.target.closest("[data-save]")) {
    const row = { name: okTxt(d.name, 40), by: okTxt(d.by, 20), thumb: d.thumb, icon: d.icon, btools: d.btools };
    if (!row.name || !row.by) { msg.textContent = "Give the game a name and an owner first."; return; }
    const o = {}; if (row.name !== g.def.name) o.name = row.name; if (row.by !== g.def.by) o.by = row.by;
    if (row.thumb !== g.def.thumb) o.thumb = row.thumb; if (row.icon !== g.def.icon) o.icon = row.icon; o.btools = row.btools;
    g.ovr = {}; applyGameRow(g.id, o);
    try { const all = JSON.parse(localStorage.getItem(GAME_LS) || "{}"); all[g.id] = { name: gv(g, "name"), by: gv(g, "by"), thumb: gv(g, "thumb"), icon: gv(g, "icon"), btools: g.btools || "all" }; localStorage.setItem(GAME_LS, JSON.stringify(all)); } catch (_) {}
    renderGames(); renderOwnerGames();
    const sb = getSB(); msg.textContent = "Saving…";
    try {
      if (!sb) throw new Error("no supabase");
      const base = { id: g.id, name: gv(g, "name"), owner_name: gv(g, "by"), thumb: gv(g, "thumb"), icon: gv(g, "icon"), updated_by: acct.user.id, updated_at: new Date().toISOString() };
      let r = await sb.from(GAME_TABLE).upsert(Object.assign({ btools: g.btools || "all" }, base)), noBT = false;
      if (r.error) { r = await sb.from(GAME_TABLE).upsert(base); noBT = true; }                  // btools column missing: save the rest
      if (r.error) throw r.error;
      msg.textContent = noBT ? "Saved, but the building-tools setting needs supabase_schema.sql run once in Supabase." : "Saved. Everyone will see the new " + gv(g, "name") + " details.";
    } catch (_) { msg.textContent = "Saved on this device only. Run supabase_game_settings.sql in Supabase once so everyone sees it."; }
  }
});
$("owGames").addEventListener("change", async e => {
  const inp = e.target.closest("[data-file]"); if (!inp || !inp.files[0] || !isOwner()) return;
  const box = inp.closest("[data-gid]"), g = GAMES.find(x => x.id === box.dataset.gid), d = owDraft(g), kind = inp.dataset.file, msg = $("owGMsg");
  try {
    d[kind] = kind === "thumb" ? await fitImage(inp.files[0], 640, 360, "image/jpeg") : await fitImage(inp.files[0], 192, 192, "image/png");
    msg.textContent = "Picture ready. Press Save to keep it.";
    renderOwnerGames();
  } catch (_) { msg.textContent = "Couldn't read that picture."; }
  inp.value = "";
});
$("gpPlay").addEventListener("click", startGame);
$("gpBack").addEventListener("click", () => showTab("home"));
for (const b of document.querySelectorAll("#gpTabs button")) b.addEventListener("click", () => {
  for (const x of document.querySelectorAll("#gpTabs button")) x.classList.toggle("on", x === b);
  const ab = b.dataset.gp === "about";
  $("gpAbout").hidden = !ab; $("gpControls").hidden = ab;
  playIn(ab ? $("gpAbout") : $("gpControls"));
});
(function () {                                                    // Favorite is remembered on this device; Share copies the page link
  const fav = $("gpFav"), keyOf = () => "triangle_fav_" + curGame.id;
  const paint = on => { fav.classList.toggle("on", on); fav.textContent = on ? "Favorited" : "Favorite"; };
  window.refreshFav = () => { try { paint(localStorage.getItem(keyOf()) === "1"); } catch (_) { paint(false); } };
  window.refreshFav();
  fav.addEventListener("click", () => { const on = !fav.classList.contains("on"); paint(on); try { localStorage.setItem(keyOf(), on ? "1" : "0"); } catch (_) {} });
  $("gpShare").addEventListener("click", async () => {
    const b = $("gpShare");
    try { await navigator.clipboard.writeText(location.href.split("#")[0]); b.textContent = "Link copied"; } catch (_) { b.textContent = "Couldn't copy"; }
    setTimeout(() => { b.textContent = "Share"; }, 1500);
  });
})();
$("homeBtn").addEventListener("click", () => { freeMouse(); flushSave().then(() => location.reload(), () => location.reload()); });
