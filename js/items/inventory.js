"use strict";

/* ---- inventory (what you own / wear) ---- */
async function loadInventory() {
  const sb = getSB(); if (!sb || !acct.user) return;
  try {
    const r = await sb.from("ugc_inventory").select("item_id, equipped, acquired_at").eq("user_id", acct.user.id).order("acquired_at", { ascending: true });
    if (r.error) throw r.error;
    INV.ok = true; INV.loaded = true; INV.owned = new Set((r.data || []).map(x => x.item_id));
    setMyItems((r.data || []).filter(x => x.equipped).map(x => x.item_id));
  } catch (_) { INV.ok = false; }
  renderAvItems();
}
async function equipItem(id, on) {
  const sb = getSB(); if (!sb || !acct.user) return "Log in first.";
  try {
    if (on) {                                                      // a new shirt replaces the shirt you have on (same for pants)
      const it = ITM.rows.get(id);
      if (it && isCloth(it.attach)) for (const o of WEAR.mine.slice()) {
        const x = ITM.rows.get(o);
        if (o !== id && x && x.attach === it.attach) { const off = await sb.rpc("set_ugc_equipped", { p_item: o, p_on: false }); if (off.error) throw off.error; }
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
async function renderAvItems() {
  const box = $("itList"); if ($("avItems").hidden) return;
  const sb = getSB(); if (!sb || !acct.user) { box.innerHTML = '<div class="note">Log in to see your items.</div>'; return; }
  if (!INV.loaded && INV.ok) { box.innerHTML = '<div class="muted">Loading…</div>'; return; }
  if (!INV.ok) { box.innerHTML = '<div class="note">Couldn\'t load your items. ' + SQL_HINT + "</div>"; return; }
  const ids = new Set(INV.owned);
  if (canUgc()) {                                                  // creators can also wear their own creations
    try { const r = await sb.from("ugc_items").select("id").eq("creator", acct.user.id); for (const x of (r.data || [])) ids.add(x.id); } catch (_) {}
  }
  const rows = await fetchItemRows(Array.from(ids));
  const list = Array.from(ids).map(id => rows.get(id)).filter(Boolean);
  box.innerHTML = list.length ? list.map(it => { const on = WEAR.mine.includes(it.id);
    return `<div class="itRow" data-id="${esc(it.id)}"><img alt="" data-it="${esc(it.id)}" src=""><div class="itT"><b>${esc(it.name)}</b><small>${esc(slotName(it.attach))}</small></div><button class="pbtn${on ? " on" : ""}" data-eq="${on ? 0 : 1}" type="button">${on ? "Take off" : "Wear"}</button></div>`; }).join("")
    : '<div class="note">You don\'t own any items yet. Check the Shop.</div>';
  fillThumbs(box);
}
$("itList").addEventListener("click", async e => {
  const b = e.target.closest("[data-eq]"); if (!b) return;
  const id = b.closest("[data-id]").dataset.id; b.disabled = true;
  const err = await equipItem(id, b.dataset.eq === "1");
  $("itNote").textContent = err; renderAvItems();
});
