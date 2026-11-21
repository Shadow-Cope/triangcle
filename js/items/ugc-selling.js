"use strict";

/* ---- selling from the UGC tab ---- */
$("ugPrice").addEventListener("input", () => { UG.price = ugClamp(Math.floor(+$("ugPrice").value || 0), 0, 1000000); });
$("ugPublish").addEventListener("click", () => ugSetSale(true));
$("ugUnpublish").addEventListener("click", () => ugSetSale(false));
async function ugSetSale(on) {
  const sb = getSB(); if (!sb || !acct.user) return;
  if (!canUgc()) return ugMsg("Your account can't make UGC.", true);
  if (!UG.editId) return ugMsg("Save the item first.", true);
  if (UG.file) return ugMsg("Press Save item first, so your new file is uploaded.", true);
  const price = ugClamp(Math.floor(+$("ugPrice").value || 0), 0, 1000000);
  const patch = on ? Object.assign({ published: true, price }, UG.published ? {} : { published_at: new Date().toISOString() }) : { published: false };
  $("ugPublish").disabled = $("ugUnpublish").disabled = true;
  try {
    const r = await sb.from("ugc_items").update(patch).eq("id", UG.editId).select("id");
    if (r.error) throw r.error;
    if (!r.data || !r.data.length) throw new Error("not yours");
    UG.published = on; if (on) UG.price = price;
    ugMsg(on ? "“" + UG.name + "” is on sale in the Shop." : "“" + UG.name + "” is off sale. People who already bought it keep it.");
    renderUgcList();
  } catch (_) { ugMsg("Couldn't change the listing. " + SQL_HINT, true); }
  $("ugPublish").disabled = $("ugUnpublish").disabled = false;
  ugSync();
}

/* after a creator re-saves an item, drop the cached copy so the worn version updates */
function refreshWorn(id) {
  ITM.rows.delete(id); ITM.thumbs.clear();
  for (const [path, p] of Array.from(ITM.models)) ITM.models.delete(path);
  const h = localAvatar.itemHolders && localAvatar.itemHolders.get(id);
  if (h) { if (h.parent) h.parent.remove(h); localAvatar.itemHolders.delete(id); }
  localAvatar.itemSig = null; syncAvatarItems(localAvatar, WEAR.mine);
}
