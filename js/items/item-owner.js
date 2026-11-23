"use strict";

/* ---- Owner tools on an item page: rename, describe, set the price, put on / take off sale, delete.
   Works for ANY item in the Catalog. Needs the Owner badge (or a badge that allows "edit items") - and
   the server checks it too (owner_update_item / owner_delete_item in supabase_schema.sql). ---- */
const canEditItems = () => hasBadgePerm("can_edit_items");
const ioMsg = (t, bad) => { const n = $("ioMsg"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; };
$("ipOwner").addEventListener("keydown", e => e.stopPropagation());
function ioFill(id, tok) {                                         // called once the item's description has loaded
  const box = $("ipOwner"), it = ITM.rows.get(id);
  box.hidden = !(it && canEditItems());
  if (box.hidden || tok !== IP.tok) return;
  $("ioName").value = it.name || ""; $("ioDesc").value = IP.desc || "";
  $("ioPrice").value = Math.max(0, Math.floor(+it.price || 0)); $("ioSale").checked = it.published !== false;
  ioMsg("");
}
function ioErr(e) {
  const m = String(e && e.message || "");
  return m.includes("not_allowed") ? "Only the Owner can do that."
    : m.includes("bad_name") ? "Names are 1 to 40 characters."
    : m.includes("bad_price") ? "Price must be a whole number from 0 to 1,000,000."
    : m.includes("not_found") ? "That item doesn't exist anymore."
    : "Couldn't do that. Run supabase_schema.sql in Supabase once. (" + m.slice(0, 80) + ")";
}
$("ioSave").addEventListener("click", async () => {
  const sb = getSB(), it = ITM.rows.get(IP.id); if (!sb || !it || !canEditItems()) return;
  const name = $("ioName").value.trim(), desc = $("ioDesc").value.trim().slice(0, 600), price = Math.floor(+$("ioPrice").value);
  if (!name || name.length > 40) return ioMsg("Give it a name (up to 40 characters).", true);
  if (!(price >= 0 && price <= 1000000)) return ioMsg("Price must be a whole number from 0 to 1,000,000.", true);
  const on = $("ioSale").checked, b = $("ioSave"); b.disabled = true; ioMsg("Saving…");
  try {
    const r = await sb.rpc("owner_update_item", { p_item: it.id, p_name: name, p_desc: desc, p_price: price, p_published: on });
    if (r.error) throw r.error;
    const patch = { name, price, published: on };
    Object.assign(it, patch); ITM.rows.set(it.id, it);
    const row = SHOP.rows.find(x => x.id === it.id); if (row) Object.assign(row, patch);
    IP.desc = desc; ITM.thumbs.clear();
    ioMsg("Saved."); ipPaint(); paintShop();
  } catch (e) { ioMsg(ioErr(e), true); }
  b.disabled = false;
});
$("ioDel").addEventListener("click", async () => {
  const sb = getSB(), it = ITM.rows.get(IP.id); if (!sb || !it || !canEditItems()) return;
  if (!confirm("Delete “" + it.name + "” for good? Everyone who owns it loses it.")) return;
  const b = $("ioDel"); b.disabled = true; ioMsg("Deleting…");
  try {
    const r = await sb.rpc("owner_delete_item", { p_item: it.id });
    if (r.error) throw r.error;
    const path = String(r.data || "");
    if (path && !path.startsWith("assets/")) { try { await sb.storage.from("ugc").remove([path]); } catch (_) {} }
    ITM.rows.delete(it.id); INV.owned.delete(it.id); SHOP.rows = SHOP.rows.filter(x => x.id !== it.id);
    const m = FM.byItem.get(it.id); if (m) { FM.byItem.delete(it.id); FM.byNo.delete(m.face_no); }
    if (WEAR.mine.includes(it.id)) setMyItems(WEAR.mine.filter(x => x !== it.id));
    showTab("shop");
  } catch (e) { ioMsg(ioErr(e), true); }
  b.disabled = false;
});
