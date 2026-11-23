"use strict";

/* ---- Owner page: make new badges (picture + name + what it allows) and put the built-in faces in the Catalog ---- */
const BD = { file: null, prevUrl: "" };
const bdMsg = (t, bad) => { const n = $("bdMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
$("owBadges").addEventListener("keydown", e => e.stopPropagation());

$("bdFile").addEventListener("change", () => {
  const f = $("bdFile").files && $("bdFile").files[0]; $("bdFile").value = "";
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return bdMsg("Pick a PNG, JPG or WebP picture.", true);
  if (f.size > 4 * 1024 * 1024) return bdMsg("That picture is too big (4 MB max).", true);
  BD.file = f; bdMsg("");
  if (BD.prevUrl) URL.revokeObjectURL(BD.prevUrl);
  BD.prevUrl = URL.createObjectURL(f); $("bdPrev").src = BD.prevUrl; $("bdPick").classList.add("has");
});
function badgePng(file) {                                           // any picture -> a clean 128x128 PNG (cropped square)
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const cv = document.createElement("canvas"); cv.width = cv.height = 128;
      const g = cv.getContext("2d"), s = Math.min(im.naturalWidth, im.naturalHeight);
      g.imageSmoothingQuality = "high";
      g.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
      cv.toBlob(b => b ? res(b) : rej(new Error("png")), "image/png");
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
    im.src = url;
  });
}
const badgeKey = name => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "badge";
  return slug + "-" + Math.random().toString(36).slice(2, 6);
};
$("bdCreate").addEventListener("click", async () => {
  const sb = getSB(); if (!sb || !isOwner()) return;
  const name = $("bdName").value.trim();
  if (!name || name.length > 30) return bdMsg("Give the badge a name (up to 30 characters).", true);
  if (!BD.file) return bdMsg("Choose a picture for the badge.", true);
  const b = $("bdCreate"); b.disabled = true; bdMsg("Making the badge…");
  let path = "";
  try {
    const key = badgeKey(name), blob = await badgePng(BD.file);
    path = key + ".png";
    const up = await sb.storage.from("badges").upload(path, blob, { contentType: "image/png", upsert: false });
    if (up.error) throw up.error;
    const image = sb.storage.from("badges").getPublicUrl(path).data.publicUrl;
    const r = await sb.from("badge_defs").insert({ key, name, image, can_ugc: $("bdUgc").checked, can_edit_items: $("bdEdit").checked });
    if (r.error) throw r.error;
    BD.file = null; $("bdName").value = ""; $("bdUgc").checked = $("bdEdit").checked = false; $("bdPick").classList.remove("has"); $("bdPrev").removeAttribute("src");
    bdMsg("Made “" + name + "”. Give it to players from the list above.");
    await loadBadgeDefs(); renderBadgeAdmin(); renderOwner();
  } catch (e) {
    if (path) { try { await sb.storage.from("badges").remove([path]); } catch (_) {} }
    bdMsg("Couldn't make the badge. Run supabase_schema.sql in Supabase once. (" + String(e && e.message || "").slice(0, 80) + ")", true);
  }
  b.disabled = false;
});

function renderBadgeAdmin() {
  const box = $("bdList"), custom = BADGE_ORDER.filter(k => !BADGE_BUILTIN.includes(k));
  box.innerHTML = custom.length ? custom.map(k => `<div class="bdItem box" data-bk="${esc(k)}"><img alt="" src="${esc(BADGE_IMG[k])}"><b>${esc(BADGES[k])}</b>
    <label class="chk"><input type="checkbox" data-perm="can_ugc"${BADGE_PERMS[k] && BADGE_PERMS[k].can_ugc ? " checked" : ""}> UGC</label>
    <label class="chk"><input type="checkbox" data-perm="can_edit_items"${BADGE_PERMS[k] && BADGE_PERMS[k].can_edit_items ? " checked" : ""}> Edit items</label>
    <button type="button" class="btnG" data-bdel="1">Delete</button></div>`).join("")
    : '<div class="note">No custom badges yet. Make one above.</div>';
}
$("bdList").addEventListener("change", async e => {
  const cb = e.target.closest("[data-perm]"); if (!cb || !isOwner()) return;
  const k = cb.closest("[data-bk]").dataset.bk, sb = getSB(); cb.disabled = true;
  try {
    const r = await sb.from("badge_defs").update({ [cb.dataset.perm]: cb.checked }).eq("key", k);
    if (r.error) throw r.error;
    bdMsg("Saved.");
  } catch (_) { cb.checked = !cb.checked; bdMsg("Couldn't change that. Run supabase_schema.sql in Supabase once.", true); }
  cb.disabled = false; await loadBadgeDefs(); updateUgcBtn();
});
$("bdList").addEventListener("click", async e => {
  const del = e.target.closest("[data-bdel]"); if (!del || !isOwner()) return;
  const k = del.closest("[data-bk]").dataset.bk, sb = getSB();
  if (!confirm("Delete the “" + (BADGES[k] || k) + "” badge? Everyone who has it loses it.")) return;
  del.disabled = true;
  try {
    const a = await sb.from("badges").delete().eq("badge", k); if (a.error) throw a.error;
    const r = await sb.from("badge_defs").delete().eq("key", k); if (r.error) throw r.error;
    const m = String(BADGE_IMG[k] || "").split("/badges/")[1];
    if (m) { try { await sb.storage.from("badges").remove([m.split("?")[0]]); } catch (_) {} }
    bdMsg("Deleted.");
  } catch (_) { bdMsg("Couldn't delete that badge.", true); }
  await loadBadgeDefs(); renderBadgeAdmin(); renderOwner();
});

/* ---- Catalog: add the built-in faces (the old ones + the new ones) as Catalog items ---- */
const fcMsg = (t, bad) => { const n = $("fcMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
$("fcImport").addEventListener("click", async () => {
  const sb = getSB(); if (!sb || !isOwner() || !acct.user) return;
  const b = $("fcImport"); b.disabled = true; fcMsg("Adding faces…");
  try {
    const meta = await sb.from("face_meta").select("face_no"); if (meta.error) throw meta.error;
    const have = new Set((meta.data || []).map(x => x.face_no)); let added = 0;
    for (const f of FACE_BUILTIN) {
      if (have.has(f.no)) continue;
      const id = crypto.randomUUID(), image = "assets/faces/" + f.file;
      const a = await sb.from("ugc_items").insert({ id, name: f.name, attach: "Face", file_path: image, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1,
        creator: acct.user.id, price: f.price, published: true, published_at: new Date().toISOString(), description: f.desc });
      if (a.error) throw a.error;
      const m = await sb.from("face_meta").insert({ item_id: id, face_no: f.no, image });
      if (m.error) { await sb.from("ugc_items").delete().eq("id", id); throw m.error; }
      added++;
    }
    const g = await sb.rpc("owner_grandfather_faces");
    await loadFaceMeta(true);
    fcMsg(added ? "Added " + added + " face" + (added === 1 ? "" : "s") + " to the Catalog." + (g.error ? "" : " " + (g.data || 0) + " players kept the face they already had.")
                 : "All the built-in faces are already in the Catalog." + (g.error ? "" : " (" + (g.data || 0) + " players re-checked.)"));
  } catch (e) { fcMsg("Couldn't add them. Run supabase_schema.sql in Supabase once. (" + String(e && e.message || "").slice(0, 100) + ")", true); }
  b.disabled = false;
});
