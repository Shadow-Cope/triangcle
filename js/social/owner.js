"use strict";

/* ---- owner page: give or remove badges (Supabase only allows the Owner to do this) ---- */
const OW = { q: "", t: 0 };
$("owSearch").addEventListener("keydown", e => e.stopPropagation());
$("owSearch").addEventListener("input", () => {
  clearTimeout(OW.t);
  OW.t = setTimeout(() => { OW.q = $("owSearch").value.trim().replace(/[^A-Za-z0-9_]/g, ""); renderOwner(); }, 250);
});
function ownerRow(id) {
  const p = SOC.cache.get(id); if (!p) return "";
  const has = badgeList(id);
  return `<div class="owRow box" data-owid="${esc(id)}"><img alt="" data-pid="${esc(id)}" src="${thumb(p.body_colors, "face", id)}"><b data-pid="${esc(id)}">${esc(p.username)}</b>
    <div class="owBtns">${BADGE_ORDER.map(k => `<button type="button" class="owB${has.includes(k) ? " on" : ""}" data-bk="${k}"><img alt="" src="${BADGE_IMG[k]}">${BADGES[k]}</button>`).join("")}<label>Amount <input data-wallet-amount type="number" min="1" max="1000000000" step="1" value="1" style="width:100px"></label><button class="btnG" data-wallet="add" type="button">Add Triangcles</button><button class="btnG" data-wallet="remove" type="button">Remove Triangcles</button></div></div>`;
}
async function renderOwner() {
  if (!isOwner()) return;
  const sb = getSB(), msg = $("owMsg"); if (!sb) return;
  msg.textContent = "Loading…";
  try {
    let ids = [];
    if (OW.q) {
      let r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors, player_number").ilike("username", OW.q + "%").limit(20);
      if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors").ilike("username", OW.q + "%").limit(20);
      if (r.error) throw r.error;
      for (const p of (r.data || [])) SOC.cache.set(p.id, Object.assign({}, SOC.cache.get(p.id) || {}, p));
      ids = (r.data || []).map(p => p.id);
    } else {
      const r = await sb.from("badges").select("user_id"); if (r.error) throw r.error;
      ids = [...new Set((r.data || []).map(b => b.user_id))];
      await getProfiles(ids, true);
    }
    await getBadges(ids);
    $("owList").innerHTML = ids.map(ownerRow).join("");
    msg.textContent = ids.length ? (OW.q ? "" : "Players who have badges right now:") : (OW.q ? "No players found." : "Nobody has a badge yet. Search for a player above.");
  } catch (_) { msg.textContent = "Couldn't load badges. Run supabase_badges.sql in Supabase once."; }
}
$("owList").addEventListener("click", async e => {
  const moneyBtn = e.target.closest("[data-wallet]");
  if (moneyBtn) {
    if (!isOwner()) return;
    const row = moneyBtn.closest("[data-owid]"), amount = Number(row.querySelector("[data-wallet-amount]").value);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) { $("owMsg").textContent = "Enter a whole amount from 1 to 1,000,000,000."; return; }
    moneyBtn.disabled = true;
    try {
      const result = await getSB().rpc("owner_adjust_wallet", { p_user: row.dataset.owid, p_delta: moneyBtn.dataset.wallet === "add" ? amount : -amount });
      if (result.error) throw result.error;
      $("owMsg").textContent = "Balance updated: " + Number(result.data).toLocaleString() + " Triangcles.";
      if (row.dataset.owid === acct.user.id) await loadWallet();
    } catch (err) { $("owMsg").textContent = /insufficient_funds/.test(err.message || "") ? "That player does not have enough Triangcles." : "Couldn't change the balance. Check the owner badge and run supabase_owner_wallet.sql."; }
    finally { moneyBtn.disabled = false; }
    return;
  }
  const btn = e.target.closest("[data-bk]"); if (!btn || !isOwner()) return;
  const row = btn.closest("[data-owid]"), uid = row.dataset.owid, k = btn.dataset.bk, sb = getSB();
  const has = (SOC.badges.get(uid) || []).includes(k);
  btn.disabled = true;
  try {
    const r = has ? await sb.from("badges").delete().eq("user_id", uid).eq("badge", k)
                  : await sb.from("badges").insert({ user_id: uid, badge: k, granted_by: acct.user.id });
    if (r.error) throw r.error;
    $("owMsg").textContent = "";
  } catch (_) { $("owMsg").textContent = "Couldn't change that badge. Make sure supabase_badges.sql has been run and you're signed in as Owen."; }
  await getBadges([uid]);
  row.outerHTML = ownerRow(uid);
});
updateOwnerBtn();
function updateOwnerBtn() { $("ownerTabBtn").hidden = !isOwner(); }
