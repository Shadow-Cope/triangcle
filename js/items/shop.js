"use strict";

/* ---- Shop ---- */
function shopNote(t, bad) { const n = $("shopNote"); n.textContent = t || ""; n.style.color = bad ? "#ff7a6b" : ""; }
async function renderShop() {
  const sb = getSB(); if (!sb) { shopNote("The Shop isn't available right now.", true); return; }
  shopNote("");
  if (acct.user) { loadWallet(); if (!INV.loaded) await loadInventory(); }
  try {
    const mod = hasBadgePerm("can_edit_items");                      // owners also see items that are off sale, so they can fix them
    let q = sb.from("ugc_items").select("id, name, attach, file_path, pos, rot, scale, price, sales, creator, published_at, published");
    if (!mod) q = q.eq("published", true);
    const r = await q.order("published_at", { ascending: false, nullsFirst: false }).limit(120);
    if (r.error) throw r.error;
    SHOP.rows = r.data || [];
    for (const it of SHOP.rows) ITM.rows.set(it.id, Object.assign({}, ITM.rows.get(it.id) || {}, it));
    await Promise.all([getProfiles(SHOP.rows.map(it => it.creator)), loadFaceMeta()]);
  } catch (_) { SHOP.rows = []; $("shopList").innerHTML = ""; $("shopBox").hidden = true; shopNote("Couldn't load the Shop. " + SQL_HINT, true); return; }
  paintShop();
}
function paintShop() {
  const q = $("shSearch").value.trim().toLowerCase(), sort = $("shSort").value, me = acct.user && acct.user.id;
  const ty = $("shType").value;
  const filtered = window.TriancleRust && window.TriancleRust.catalogFilter ? window.TriancleRust.catalogFilter(SHOP.rows,q,ty,"",null,null,false,false,SOC.cache,INV.owned) : null;
  let rows = filtered ? filtered.map(i => SHOP.rows[i]) : SHOP.rows.filter(it => (!q || String(it.name).toLowerCase().includes(q)) && (ty === "all" || (ty === "acc" ? !isCloth(it.attach) && !isFace(it.attach) : it.attach === ty)));
  rows.sort(sort === "low" ? (a, b) => a.price - b.price : sort === "high" ? (a, b) => b.price - a.price : sort === "top" ? (a, b) => b.sales - a.sales
    : (a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  $("shopBox").hidden = rows.length > 0;
  $("shopBox").lastChild.textContent = SHOP.rows.length ? "No items match that search." : "The Catalog is empty. Check back soon.";
  $("shopList").innerHTML = rows.map(it => {
    const p = SOC.cache.get(it.creator), by = p ? p.username : "Someone", price = +it.price || 0;
    const tag = it.published === false ? '<span class="itTag">Off sale</span>' : me && it.creator === me ? '<span class="itTag">Your item</span>' : me && INV.owned.has(it.id) ? '<span class="itTag">Owned</span>' : "";
    return `<div class="itCard box" data-id="${esc(it.id)}"><img class="itImg" alt="" data-it="${esc(it.id)}" src=""><b title="${esc(it.name)}">${esc(it.name)}</b>`
      + `<div class="itBy" data-pid="${esc(it.creator)}">by ${esc(by)}</div><div class="itMeta"><span class="pr">${price ? TRI_SVG + fmtT(price) : "Free"}</span><span>${esc(slotName(it.attach))}</span></div>${tag}</div>`;
  }).join("");
  fillThumbs($("shopList"));
}
$("shSearch").addEventListener("keydown", e => e.stopPropagation());
$("shSearch").addEventListener("input", paintShop);
$("shSort").addEventListener("change", paintShop);
$("shType").addEventListener("change", paintShop);
$("shopList").addEventListener("click", e => {
  if (e.target.closest("[data-pid]")) return;                      // creator name -> their profile
  const c = e.target.closest(".itCard"); if (c) openItem(c.dataset.id);
});
