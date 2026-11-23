"use strict";

/* ---- players page: browse everyone, or search by name ---- */
const PL = { q: "", sort: "new", filter: "all", from: 0, per: 36, busy: false, t: 0, tok: 0, noNum: false };
$("plSearch").addEventListener("keydown", e => e.stopPropagation());
$("plSearch").addEventListener("input", () => {
  clearTimeout(PL.t);
  PL.t = setTimeout(() => { PL.q = $("plSearch").value.trim().replace(/[^A-Za-z0-9_]/g, ""); renderPlayers(true); }, 250);
});
$("plMore").addEventListener("click", () => renderPlayers(false));
$("plSort").addEventListener("change", () => { PL.sort = $("plSort").value; renderPlayers(true); });
$("plFilter").addEventListener("change", () => { PL.filter = $("plFilter").value; renderPlayers(true); });
async function renderPlayers(reset) {
  const sb = getSB(); if (!sb || !acct.user || (PL.busy && !reset)) return;
  PL.busy = true; if (reset) PL.tok++;
  const tok = PL.tok, T = CFG.SAVE_TABLE;
  if (reset) { PL.from = 0; $("plList").innerHTML = ""; $("plNote").textContent = "Loading…"; $("plMore").hidden = true; }
  try {
    let ids = null;
    if (PL.filter === "friends") { await loadSocial(); ids = SOC.friends.slice(); }
    else if (PL.filter === "any" || BADGES[PL.filter]) {
      let bq = sb.from("badges").select("user_id"); if (BADGES[PL.filter]) bq = bq.eq("badge", PL.filter);
      const br = await bq; if (br.error) throw br.error;
      ids = [...new Set((br.data || []).map(b => b.user_id))];
    }
    if (tok !== PL.tok) { PL.busy = false; return; }
    let rows = [];
    if (!ids || ids.length) {
      const run = (cols, col, asc) => {
        let q = sb.from(T).select(cols);
        if (ids) q = q.in("id", ids);
        if (PL.q) q = q.ilike("username", "%" + PL.q + "%");
        return q.order(col, { ascending: asc, nullsFirst: false }).range(PL.from, PL.from + PL.per - 1);
      };
      const byNum = PL.sort === "new" || PL.sort === "old";
      let r = await run("id, username, body_colors, player_number", byNum ? "player_number" : "username", PL.sort === "old" || PL.sort === "az");
      PL.noNum = false;
      if (r.error) { PL.noNum = true; r = await run("id, username, body_colors", "username", PL.sort !== "za"); }
      if (r.error) throw r.error;
      rows = r.data || [];
    }
    for (const p of rows) SOC.cache.set(p.id, Object.assign({}, SOC.cache.get(p.id) || {}, p));
    await Promise.all([getBadges(rows.map(p => p.id)), loadSocial()]);
    if (tok !== PL.tok) { PL.busy = false; return; }
    $("plList").insertAdjacentHTML("beforeend", rows.map(p => pcard(p.id, p.id === acct.user.id ? "you" : "")).join(""));
    PL.from += rows.length;
    $("plMore").hidden = rows.length < PL.per;
    $("plNote").textContent = PL.from ? (PL.noNum ? "Player IDs and newest/oldest need supabase_schema.sql to be run once." : "") : (PL.q || PL.filter !== "all" ? "No players found." : "No players yet.");
  } catch (_) { $("plNote").textContent = "Couldn't load players right now."; }
  PL.busy = false;
}
