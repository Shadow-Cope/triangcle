"use strict";

/* =====================================================================
   TRIANGCLES: wallet, Shop, buying, and wearing UGC items
   Everything that moves money runs in Supabase (see supabase_triangcles.sql):
   get_wallet(), buy_ugc_item(), set_ugc_equipped(), ugc_items_by_ids().
   ===================================================================== */
const TRI_SVG = '<svg class="tcI" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1z"/></svg>';
const fmtT = n => Number(n || 0).toLocaleString();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WORN = 6;
const SQL_HINT = "Run supabase_triangcles.sql in Supabase once.";
const ITM = { models: new Map(), thumbs: new Map(), rows: new Map(), q: Promise.resolve() };
const WAL = { bal: null };
const INV = { owned: new Set(), ok: true, loaded: false };
const SHOP = { rows: [], busy: false };
const slotName = k => (UG_SLOTS.concat(CLOTH_SLOTS).find(x => x[0] === k) || [0, k])[1];
const arr3 = a => (Array.isArray(a) && a.length === 3) ? a.map(x => +x || 0) : [0, 0, 0];

/* ---- wallet ---- */
function walletUI() {
  const on = WAL.bal != null && !!acct.user;
  $("hBal").hidden = !on; $("shBalBox").hidden = !on;
  if (on) { $("hBalN").textContent = fmtT(WAL.bal); $("shBalN").textContent = fmtT(WAL.bal); }
}
async function loadWallet() {
  const sb = getSB(); if (!sb || !acct.user) return;
  try { const r = await sb.rpc("get_wallet"); if (r.error) throw r.error; WAL.bal = Number(r.data); } catch (_) { WAL.bal = null; }
  walletUI();
}
