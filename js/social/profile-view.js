"use strict";

/* =====================================================================
   PROFILE PAGE extras: the 3D avatar view, the scrolling list of worn items
   (click one -> its Catalog page) and the friends row with a "more" tile.
   Called from renderProfile() in social.js.
   ===================================================================== */
const PV = { r: null, sc: null, cam: null, av: null, cv: null, fail: false, running: false, t: 0, yaw: 0, drag: null, locked: false, sw: 1, sig: "", colors: null, items: [], tok: 0 };
const PV_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';
const PV_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 10h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 9.6-2l-1.9.8A3 3 0 0 0 9 7v3z"/></svg>';

function pvInit() {                                                  // one renderer for the page, made on first use
  if (PV.r) return true;
  if (PV.fail) return false;
  try {
    PV.cv = document.createElement("canvas"); PV.cv.id = "pvCv";
    PV.r = new THREE.WebGLRenderer({ canvas: PV.cv, antialias: true, alpha: true });
  } catch (_) { PV.fail = true; PV.r = null; return false; }
  if (renderer.outputEncoding !== undefined) PV.r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) PV.r.outputColorSpace = renderer.outputColorSpace;
  PV.r.toneMapping = renderer.toneMapping; PV.r.toneMappingExposure = renderer.toneMappingExposure;
  PV.sc = new THREE.Scene(); PV.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100); PV.av = createAvatar();
  PV.sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); PV.sc.add(dl);
  PV.sc.add(PV.av.group); PV.cam.position.set(0, 2.85, 12); PV.cam.lookAt(0, 2.8, 0);
  return true;
}

function pvLoop(now) {
  if (!PV.r || $("tabProfile").hidden || inGame) { PV.running = false; return; }
  requestAnimationFrame(pvLoop);
  const dt = Math.min((now - PV.t) / 1000, 0.1); PV.t = now;
  const cv = PV.cv, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (!w || !h) return;
  if (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr)) { PV.r.setPixelRatio(pr); PV.r.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix(); }
  if (PV.colors) { const sig = colorSig(PV.colors); if (sig !== PV.sig) { PV.sig = sig; setAvatarColors(PV.av, sanitizeColors(PV.colors)); } }
  syncAvatarItems(PV.av, PV.items);
  PV.sw += ((PV.locked ? 0 : 1) - PV.sw) * Math.min(1, dt * 6);        // locked: stop swaying and face the front
  if (PV.locked && PV.drag === null) PV.yaw *= Math.exp(-dt * 7);
  const t = now / 1000, rg = PV.av.rig, s = Math.sin(t * 1.7);
  PV.av.group.rotation.y = -Math.PI / 2 + PV.yaw + Math.sin(t * 0.7) * 0.35 * PV.sw;
  PV.av.group.position.y = s * 0.02;
  rg.LeftArm.rotation.z = s * 0.05; rg.RightArm.rotation.z = -s * 0.05;
  PV.r.render(PV.sc, PV.cam);
}

async function profileStage(id, colors, wornP) {
  const tok = ++PV.tok, box = $("pvBox"), list = $("pItems");
  if (!box || !list) return;
  PV.items = []; PV.colors = sanitizeColors(colors); PV.yaw = 0; PV.locked = false; PV.sw = 1; PV.sig = "";
  if (pvInit()) {
    box.insertBefore(PV.cv, box.firstChild);
    box.addEventListener("pointerdown", e => { if (PV.locked || e.target.closest("button")) return; PV.drag = e.clientX; box.setPointerCapture(e.pointerId); });
    box.addEventListener("pointermove", e => { if (PV.drag !== null) { PV.yaw += (e.clientX - PV.drag) * 0.012; PV.drag = e.clientX; } });
    const end = () => { PV.drag = null; }; box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
    const lk = $("pvLock"), paintLock = () => { lk.classList.toggle("locked", PV.locked); lk.innerHTML = PV.locked ? PV_LOCK : PV_OPEN; };
    lk.addEventListener("click", () => { PV.locked = !PV.locked; paintLock(); }); paintLock();
    if (!PV.running) { PV.running = true; PV.t = performance.now(); requestAnimationFrame(pvLoop); }
  } else box.insertAdjacentHTML("beforeend", '<div class="note pvNo">3D view isn\'t available on this device.</div>');

  try { await wornP; } catch (_) {}
  try { await loadFaceMeta(); } catch (_) {}
  if (tok !== PV.tok) return;
  const ids = (wornOf(id) || []).slice(0, MAX_WORN), faceNo = sanitizeColors(colors).face | 0, faceId = faceNo ? faceItemFor(faceNo) : null;
  const rows = await fetchItemRows(faceId ? ids.concat([faceId]) : ids);
  if (tok !== PV.tok) return;
  PV.items = ids; PV.sig = "";                                       // sig reset: face pictures added by the Owner may have just registered
  const n = ids.length + (faceNo ? 1 : 0);
  $("pvWear").textContent = n ? "Wearing " + n + (n === 1 ? " item" : " items") : "Nothing extra on";
  const shown = ids.concat(faceId ? [faceId] : []).filter(x => rows.get(x));
  list.innerHTML = shown.length ? shown.map(x => { const it = rows.get(x);
    return `<button class="pItem" type="button" data-item="${esc(x)}" title="${esc(it.name)}"><img alt="" data-it="${esc(x)}" src=""><span>${esc(it.name)}</span></button>`; }).join("")
    : '<div class="note pItemsNone">No items worn.</div>';
  list.onclick = e => { const b = e.target.closest("[data-item]"); if (b) openItem(b.dataset.item); };
  fillThumbs(list);
}

const PF = { list: [] };
function profileFriends(list) {                                      // as many cards as fit the row; the last slot becomes "more" when some don't
  PF.list = list || PF.list;
  const row = $("pFrRow"); if (!row) return;
  if (!PF.list.length) { row.innerHTML = '<div class="note">No friends yet.</div>'; return; }
  const CARD = 120, GAP = 14, W = row.clientWidth || row.parentElement.clientWidth || 0;
  const slots = Math.max(1, Math.floor((W + GAP) / (CARD + GAP)));
  const all = PF.list.length <= slots, n = all ? PF.list.length : Math.max(0, slots - 1), rest = PF.list.length - n;
  row.innerHTML = PF.list.slice(0, n).map(f => pcard(f)).join("")
    + (all ? "" : `<button class="pMore" type="button" data-go="friends"><b>+${rest}</b><span>more</span></button>`);
}
let pfT = 0;
window.addEventListener("resize", () => { cancelAnimationFrame(pfT); pfT = requestAnimationFrame(() => { if ($("pFrRow") && !$("tabProfile").hidden) profileFriends(); }); });
