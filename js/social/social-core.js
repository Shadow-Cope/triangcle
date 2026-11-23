"use strict";

/* =====================================================================
   SOCIAL: welcome page, friends, player profiles
   ===================================================================== */
const SOC = { friends: [], incoming: [], outgoing: [], ok: true, cache: new Map(), viewId: null, badges: new Map(), badgeOK: true };
const esc = s => { const text = String(s == null ? "" : s); if (window.TriancleRust && window.TriancleRust.escapeHtml) { const result = window.TriancleRust.escapeHtml(text); if (result !== null) return result; } return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); };
const FR_TABLE = "friendships";
const dn = p => (p && (p.display_name || p.username)) || "";                // the name people see: display name if they set one, else username

/* offscreen renderer that turns any set of body colours into a picture */
const thumbs = (function () {
  let r;
  try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  sc.add(av.group);
  return { r, sc, cam, av, cache: new Map() };
})();
const WORN = new Map();                                              // user id -> ids of the UGC items they wear
const thumbsX = { cache: new Map(), q: Promise.resolve() };
const UP = { ids: new Set(), timer: 0, shown: new Map(), fail: false };
function wornOf(uid) { return acct.user && uid === acct.user.id ? WEAR.mine : WORN.get(uid); }
const thumbKeyX = (colors, kind, ids) => kind + "|" + colorSig(sanitizeColors(colors)) + "|" + ids.join(",");
let _rigX = null;
function getRigX() {
  if (_rigX) return _rigX;
  let r; try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl); sc.add(av.group);
  return (_rigX = { r, sc, cam, av });
}
function outfitThumb(colors, kind, ids) {                                // picture of a player wearing their items (items load from the network, so this is async)
  const key = thumbKeyX(colors, kind, ids);
  if (thumbsX.cache.has(key)) return Promise.resolve(thumbsX.cache.get(key));
  thumbsX.q = thumbsX.q.then(async () => {
    const R = getRigX(); if (!R) return "";
    setAvatarColors(R.av, sanitizeColors(colors));
    R.av.itemSig = ids.join(","); await applyItemsToAvatar(R.av, ids);
    R.av.group.rotation.y = -Math.PI / 2 + 0.3; R.av.group.position.y = 0;
    R.r.setSize(200, 200, false); R.cam.aspect = 1; R.cam.updateProjectionMatrix();
    if (kind === "body") { R.cam.position.set(0, 2.7, 12.5); R.cam.lookAt(0, 2.6, 0); } else { R.cam.position.set(0, 4.55, 4.6); R.cam.lookAt(0, 4.45, 0); }
    R.r.render(R.sc, R.cam);
    let url = ""; try { url = R.r.domElement.toDataURL("image/png"); } catch (_) {}
    thumbsX.cache.set(key, url); return url;
  }).catch(() => "");
  return thumbsX.q;
}
async function fetchWorn(ids) {
  const sb = getSB(); if (!sb) return;
  const need = ids.filter(i => !WORN.has(i)); if (!need.length) return;
  let rows = null;
  try { const r = await sb.rpc("equipped_items_by_users", { p_users: need }); if (!r.error) rows = r.data || []; } catch (_) {}
  if (!rows) { try { const r = await sb.from("ugc_inventory").select("user_id, item_id").in("user_id", need).eq("equipped", true); if (!r.error) rows = r.data || []; } catch (_) {} }
  if (!rows) { UP.fail = true; return; }                               // this database does not let us see other players' items yet
  for (const id of need) WORN.set(id, []);
  for (const r of rows) { const a = WORN.get(r.user_id); if (a && validItemId(r.item_id) && a.length < MAX_WORN) a.push(r.item_id); }
}
function queueUpgrade(uid) {
  if (!uid || (UP.fail && !(acct.user && uid === acct.user.id))) return;
  UP.ids.add(uid); if (UP.timer) return;
  UP.timer = setTimeout(async () => { const ids = [...UP.ids]; UP.ids.clear(); UP.timer = 0; try { await runUpgrade(ids); } catch (_) {} }, 40);
}
async function runUpgrade(ids) {
  const me = acct.user && acct.user.id;
  await fetchWorn(ids.filter(i => i !== me));
  for (const uid of ids) {
    const items = wornOf(uid) || [], p = uid === me ? { body_colors: myColors } : SOC.cache.get(uid); if (!p) continue;
    const prevUrls = UP.shown.get(uid) || new Map();
    const plain = thumb(p.body_colors, "face");
    const target = items.length ? await outfitThumb(p.body_colors, "face", items) : plain;
    if (!target) continue;
    const known = new Map(prevUrls); known.set(plain, 1);
    for (const el of document.querySelectorAll('[data-pid="' + uid + '"],[data-tu="' + uid + '"]')) {
      const img = el.tagName === "IMG" ? el : el.querySelector("img.pface");
      if (img && known.has(img.getAttribute("src"))) img.src = target;
    }
    known.set(target, 1); UP.shown.set(uid, known);
  }
}
function thumb(colors, kind, uid) {
  if (!thumbs) return "";
  if (uid) { const it = wornOf(uid); if (it && it.length) { const hit = thumbsX.cache.get(thumbKeyX(colors, kind, it)); if (hit) return hit; queueUpgrade(uid); } else if (!it) queueUpgrade(uid); }
  const c = sanitizeColors(colors), key = kind + "|" + colorSig(c);
  if (thumbs.cache.has(key)) return thumbs.cache.get(key);
  const w = 200, hgt = 200;
  setAvatarColors(thumbs.av, c);
  thumbs.av.group.rotation.y = -Math.PI / 2 + 0.3; thumbs.av.group.position.y = 0;
  thumbs.r.setSize(w, hgt, false); thumbs.cam.aspect = w / hgt; thumbs.cam.updateProjectionMatrix();
  if (kind === "body") { thumbs.cam.position.set(0, 2.7, 12.5); thumbs.cam.lookAt(0, 2.6, 0); }
  else { thumbs.cam.position.set(0, 4.55, 4.6); thumbs.cam.lookAt(0, 4.45, 0); }
  thumbs.r.render(thumbs.sc, thumbs.cam);
  let url = ""; try { url = thumbs.r.domElement.toDataURL("image/png"); } catch (_) {}
  thumbs.cache.set(key, url); return url;
}

async function getProfiles(ids, force) {
  const sb = getSB(); if (!sb) return;
  const need = [...new Set(ids)].filter(i => force || !SOC.cache.has(i)); if (!need.length) return;
  try {
    let r = await sb.from(CFG.SAVE_TABLE).select("id, username, display_name, body_colors, about, created_at, player_number").in("id", need);
    if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors, about, created_at, player_number").in("id", need);
    if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors, about, created_at").in("id", need);
    if (r.error) r = await sb.from(CFG.SAVE_TABLE).select("id, username, body_colors").in("id", need);
    for (const p of (r.data || [])) SOC.cache.set(p.id, p);
  } catch (_) {}
  await getBadges(need);
}
async function loadSocial() {
  const sb = getSB(); if (!sb || !acct.user) return;
  const me = acct.user.id;
  try {
    const { data, error } = await sb.from(FR_TABLE).select("requester, addressee, status").or(`requester.eq.${me},addressee.eq.${me}`);
    if (error) throw error;
    SOC.ok = true; SOC.friends = []; SOC.incoming = []; SOC.outgoing = [];
    const social = window.TriancleRust && window.TriancleRust.socialLists ? window.TriancleRust.socialLists(me, data) : null;
    if (social) { SOC.friends = social.friends; SOC.incoming = social.incoming; SOC.outgoing = social.outgoing; }
    else {
    for (const f of data) {
      const other = f.requester === me ? f.addressee : f.requester;
      if (f.status === "accepted") SOC.friends.push(other);
      else if (f.addressee === me) SOC.incoming.push(other); else SOC.outgoing.push(other);
    }
    }
    await getProfiles([me, ...SOC.friends, ...SOC.incoming, ...SOC.outgoing], true);
  } catch (_) { SOC.ok = false; }
  const n = SOC.incoming.length; $("reqBadge").textContent = n ? "(" + n + ")" : ""; updateUgcBtn();
}
const relation = id => { if (window.TriancleRust && window.TriancleRust.socialRelation) { const result = window.TriancleRust.socialRelation(id,SOC.friends,SOC.incoming,SOC.outgoing); if (result !== null) return result; } return SOC.friends.includes(id) ? "friend" : SOC.incoming.includes(id) ? "incoming" : SOC.outgoing.includes(id) ? "outgoing" : "none"; };
async function friendAct(kind, id) {
  const sb = getSB(), me = acct.user.id; if (!sb) return;
  try {
    const rustAction = window.TriancleRust && window.TriancleRust.friendAction ? window.TriancleRust.friendAction(kind) : null;
    const action = rustAction === null ? (kind === "add" ? 1 : kind === "accept" ? 2 : 3) : rustAction;
    if (action === 1) await sb.from(FR_TABLE).insert({ requester: me, addressee: id, status: "pending" });
    else if (action === 2) await sb.from(FR_TABLE).update({ status: "accepted" }).eq("requester", id).eq("addressee", me);
    else await sb.from(FR_TABLE).delete().or(`and(requester.eq.${me},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${me})`);
  } catch (_) {}
  await loadSocial();
}
