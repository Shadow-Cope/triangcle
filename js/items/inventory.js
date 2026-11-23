"use strict";

/* ---- inventory (what you own / wear) ---- */
async function loadInventory() {
  const sb = getSB(); if (!sb || !acct.user) return;
  try {
    const r = await sb.from("ugc_inventory").select("item_id, equipped, acquired_at").eq("user_id", acct.user.id).order("acquired_at", { ascending: true });
    if (r.error) throw r.error;
    const rows = r.data || [], normalized = window.TriancleRust && window.TriancleRust.inventoryRows ? window.TriancleRust.inventoryRows(rows) : null;
    INV.ok = true; INV.loaded = true; INV.owned = new Set(normalized ? normalized.owned : rows.map(x => x.item_id));
    setMyItems(normalized ? normalized.equipped : rows.filter(x => x.equipped).map(x => x.item_id));
  } catch (_) { INV.ok = false; }
  if (typeof renderAvItems === "function") renderAvItems();
}
async function equipItem(id, on) {
  const sb = getSB(); if (!sb || !acct.user) return "Log in first.";
  try {
    if (on) {                                                      // a new shirt replaces the shirt you have on (same for pants)
      const it = ITM.rows.get(id);
      if (it && isCloth(it.attach)) for (const o of WEAR.mine.slice()) {
        const x = ITM.rows.get(o);
        const plan = x && window.TriancleRust && window.TriancleRust.equipConflicts ? window.TriancleRust.equipConflicts(id,it.attach,[{id:o,attach:x.attach}]) : null;
        if (plan ? plan.length > 0 : o !== id && x && x.attach === it.attach) { const off = await sb.rpc("set_ugc_equipped", { p_item: o, p_on: false }); if (off.error) throw off.error; }
      }
    }
    const r = await sb.rpc("set_ugc_equipped", { p_item: id, p_on: on });
    if (r.error) throw r.error;
    INV.owned.add(id);
    setMyItems(Array.isArray(r.data) ? r.data : []);
    return "";
  } catch (e) {
    const m = String(e && e.message || "");
    return m.includes("too_many_equipped") ? "You can wear up to " + MAX_WORN + " items at once." : m.includes("not_owned") ? "You don't own that item." : "Couldn't do that. " + SQL_HINT;
  }
}
