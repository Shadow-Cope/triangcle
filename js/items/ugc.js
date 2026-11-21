"use strict";

/* =====================================================================
   UGC: upload a GLB, place it on the player template, save it as an item
   (Owner or Official UGC Creator badge)
   ===================================================================== */
var ugOn = false, ugRun = false;
const UGC_ROLES = ["ugc"];
const UG_SLOTS = [["Head", "Head (hat)"], ["Torso", "Torso"], ["LeftArm", "Left arm"], ["RightArm", "Right arm"], ["LeftLeg", "Left leg"], ["RightLeg", "Right leg"]];
const UG_ANCHOR = { Head: [0, 5.05, 0], Torso: [0, 3, 0], LeftArm: [0, 3, -1.5], RightArm: [0, 3, 1.5], LeftLeg: [0, 1, -0.5], RightLeg: [0, 1, 0.5] };
const UG_VIEW = { Head: [4.6, 8], Torso: [3, 12], LeftArm: [3, 12], RightArm: [3, 12], LeftLeg: [1.4, 12], RightLeg: [1.4, 12] };
const UG_DEFS = [["pos", 0, "Forward / back", -4, 4, 0.01], ["pos", 1, "Up / down", -4, 4, 0.01], ["pos", 2, "Left / right", -4, 4, 0.01],
  ["rot", 0, "Roll", -180, 180, 1], ["rot", 1, "Turn", -180, 180, 1], ["rot", 2, "Tilt", -180, 180, 1], ["scale", 0, "Size", 0.05, 5, 0.01]];
function canUgc() {
  try { if (!acct.user) return false; if (isOwner()) return true; return badgeList(acct.user.id).some(k => UGC_ROLES.includes(k)); } catch (_) { return false; }
}
function updateUgcBtn() { $("ugcTabBtn").hidden = !canUgc(); }

const UG = { name: "", attach: "Head", pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, file: null, path: null, editId: null, price: 0, published: false, holder: null, inner: null, k: 1, c: null, min: null, mode: "view" };
const ugv = (function () {
  let r;
  try { r = new THREE.WebGLRenderer({ canvas: $("ugCv"), antialias: true, alpha: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  av.group.rotation.y = -Math.PI / 2; sc.add(av.group);
  return { r, sc, cam, av, sig: "", yaw: 0, pitch: 0.12, dist: 8, ty: 4.6 };
})();
const ugMsg = (t, bad) => { $("ugMsg").textContent = t || ""; $("ugMsg").style.color = bad ? "#ff7a6b" : ""; };
const ugClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ugGet = d => d[0] === "scale" ? UG.scale : UG[d[0]][d[1]];
function ugSet(d, v) { v = ugClamp(+v || 0, d[3], d[4]); if (d[0] === "scale") UG.scale = v; else UG[d[0]][d[1]] = v; }

(function buildUgcUI() {
  const sel = $("ugAttach");
  for (const [k, l] of UG_SLOTS) { const o = document.createElement("option"); o.value = k; o.textContent = l; sel.appendChild(o); }
  const box = $("ugSliders");
  UG_DEFS.forEach((d, i) => {
    const row = document.createElement("div"); row.className = "ugS"; row.dataset.i = i;
    row.innerHTML = `<span>${d[2]}</span><input type="range" min="${d[3]}" max="${d[4]}" step="${d[5]}"><input type="number" min="${d[3]}" max="${d[4]}" step="${d[5]}">`;
    const rg = row.children[1], nm = row.children[2];
    rg.addEventListener("input", () => { ugSet(d, rg.value); ugSync(); ugApply(); });
    nm.addEventListener("input", () => { if (nm.value === "" || nm.value === "-") return; ugSet(d, nm.value); ugSync(nm); ugApply(); });
    box.appendChild(row);
  });
  $("ugPanel").addEventListener("keydown", e => e.stopPropagation());
  sel.addEventListener("change", () => { UG.attach = sel.value; UG.pos = [0, 0, 0]; ugView(); ugSync(); ugApply(); });
  $("ugName").addEventListener("input", () => { UG.name = $("ugName").value; });
  $("ugPick").addEventListener("click", () => $("ugFile").click());
  $("ugFile").addEventListener("change", async () => {
    const f = $("ugFile").files[0]; $("ugFile").value = ""; if (!f) return;
    if (!/\.glb$/i.test(f.name)) return ugMsg("That isn't a .glb file.", true);
    if (f.size > 10 * 1024 * 1024) return ugMsg("That file is over 10 MB.", true);
    ugMsg("Loading…");
    try {
      await ugLoad(await f.arrayBuffer(), f.name);
      UG.file = f;
      if (!UG.name.trim()) { UG.name = f.name.replace(/\.glb$/i, "").slice(0, 40); $("ugName").value = UG.name; }
      ugMsg("");
    } catch (e) { ugMsg("Couldn't read that GLB. Compressed (Draco/Meshopt) models aren't supported, so export without compression.", true); }
  });
  $("ugReset").addEventListener("click", () => { UG.pos = [0, 0, 0]; UG.rot = [0, 0, 0]; UG.scale = 1; ugSync(); ugApply(); });
  $("ugNew").addEventListener("click", () => ugClear());
  $("ugSave").addEventListener("click", ugSave);
  for (const b of document.querySelectorAll("#ugModes button")) b.addEventListener("click", () => {
    UG.mode = b.dataset.m;
    for (const x of document.querySelectorAll("#ugModes button")) x.classList.toggle("on", x === b);
    $("ugView").classList.toggle("move", UG.mode === "move");
    $("ugHint").textContent = UG.mode === "move" ? "drag to move the item · hold Shift to push it in or out" : "drag to look around · scroll to zoom";
  });
  const vw = $("ugView"); let drag = null;
  vw.addEventListener("pointerdown", e => { if (e.target.closest("#ugModes")) return; drag = { x: e.clientX, y: e.clientY }; vw.setPointerCapture(e.pointerId); });
  vw.addEventListener("pointermove", e => {
    if (!drag || !ugv) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
    if (UG.mode === "move" && UG.holder) ugMove(dx, dy, e.shiftKey);
    else { ugv.yaw -= dx * 0.01; ugv.pitch = ugClamp(ugv.pitch + dy * 0.006, -1.2, 1.2); }
  });
  const end = () => { drag = null; }; vw.addEventListener("pointerup", end); vw.addEventListener("pointercancel", end);
  vw.addEventListener("wheel", e => { e.preventDefault(); if (ugv) ugv.dist = ugClamp(ugv.dist * Math.exp(e.deltaY * 0.001), 2.5, 30); }, { passive: false });
  ugSync();
})();

function ugSync(skip) {
  for (const row of $("ugSliders").children) {
    const d = UG_DEFS[+row.dataset.i], v = ugGet(d);
    row.children[1].value = v;
    if (row.children[2] !== skip && document.activeElement !== row.children[2]) row.children[2].value = Math.round(v * 100) / 100;
  }
  $("ugAttach").value = UG.attach; if (document.activeElement !== $("ugName")) $("ugName").value = UG.name;
  if (document.activeElement !== $("ugPrice")) $("ugPrice").value = UG.price;
  $("ugPublish").textContent = UG.published ? "Update price" : "Publish to Shop";
  $("ugUnpublish").hidden = !UG.published;
  $("ugSaleNote").textContent = !UG.editId ? "Save the item first, then you can put it on sale."
    : UG.published ? "On sale for " + (UG.price ? UG.price.toLocaleString() + " Triangcles" : "free") + "." : "Not for sale yet.";
}
function ugView() { if (ugv) { const v = UG_VIEW[UG.attach]; ugv.ty = v[0]; ugv.dist = v[1]; } }
function ugApply() {
  if (!ugv || !UG.holder) return;
  const pv = ugv.av.rig[UG.attach], pp = MODEL_PARTS[UG.attach].pivot, an = UG_ANCHOR[UG.attach], h = UG.holder, rad = Math.PI / 180;
  if (h.parent !== pv) pv.add(h);
  h.position.set(an[0] - pp[0] + UG.pos[0], an[1] - pp[1] + UG.pos[1], an[2] - pp[2] + UG.pos[2]);
  h.rotation.set(UG.rot[0] * rad, UG.rot[1] * rad, UG.rot[2] * rad, "XYZ");
  h.scale.setScalar(UG.scale);
  UG.inner.position.set(-UG.c.x * UG.k, (UG.attach === "Head" ? -UG.min.y : -UG.c.y) * UG.k, -UG.c.z * UG.k);
}
function ugMove(dx, dy, depth) {
  const cam = ugv.cam, hpx = ugv.r.domElement.clientHeight || 400, k = 2 * ugv.dist * Math.tan(cam.fov * Math.PI / 360) / hpx;
  const r = new THREE.Vector3(), u = new THREE.Vector3(), f = new THREE.Vector3(); cam.matrixWorld.extractBasis(r, u, f);
  const d = depth ? f.multiplyScalar(dy * k) : r.multiplyScalar(dx * k).add(u.multiplyScalar(-dy * k));
  const pv = ugv.av.rig[UG.attach]; pv.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(pv.matrixWorld).invert(); inv.setPosition(0, 0, 0); d.applyMatrix4(inv);
  const dd = [d.x, d.y, d.z]; UG.pos = UG.pos.map((v, i) => ugClamp(v + dd[i], -4, 4));
  ugSync(); ugApply();
}
function ugLoad(buf, label) {
  const u8 = new Uint8Array(buf);
  if (!(u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46)) return Promise.reject(new Error("not a glb"));
  return new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, "", gltf => {
    try {
      if (UG.holder && UG.holder.parent) UG.holder.parent.remove(UG.holder);
      const model = gltf.scene, box = new THREE.Box3().setFromObject(model), size = new THREE.Vector3(), c = new THREE.Vector3();
      box.getSize(size); box.getCenter(c);
      const mx = Math.max(size.x, size.y, size.z) || 1;
      let tris = 0; model.traverse(o => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      UG.k = 1.2 / mx; UG.c = c; UG.min = box.min.clone();
      UG.inner = new THREE.Group(); UG.inner.scale.setScalar(UG.k); UG.inner.add(model);
      UG.holder = new THREE.Group(); UG.holder.add(UG.inner);
      $("ugInfo").textContent = (label || "model.glb") + " · " + Math.round(tris).toLocaleString() + " triangles";
      ugApply(); res();
    } catch (e) { rej(e); }
  }, rej));
}
function ugClear() {
  if (UG.holder && UG.holder.parent) UG.holder.parent.remove(UG.holder);
  Object.assign(UG, { name: "", attach: "Head", pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, file: null, path: null, editId: null, price: 0, published: false, holder: null, inner: null });
  $("ugInfo").textContent = "Pick a .glb file (up to 10 MB) to see it on the player.";
  ugView(); ugSync(); ugMsg("");
}
async function ugSave() {
  const sb = getSB(); if (!sb || !acct.user) return;
  if (!canUgc()) return ugMsg("Your account can't make UGC.", true);
  const name = UG.name.trim();
  if (!UG.holder) return ugMsg("Upload a GLB first.", true);
  if (!name) return ugMsg("Give the item a name.", true);
  $("ugSave").disabled = true; ugMsg("Saving…");
  try {
    const me = acct.user.id, id = UG.editId || (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2)));
    let path = UG.path, old = null;
    if (UG.file) {
      old = UG.path; path = me + "/" + id + "-" + Date.now() + ".glb";
      const up = await sb.storage.from("ugc").upload(path, UG.file, { contentType: "model/gltf-binary", upsert: false });
      if (up.error) throw up.error;
    }
    const row = { name, attach: UG.attach, file_path: path, pos: UG.pos, rot: UG.rot, scale: UG.scale };
    const r = UG.editId ? await sb.from("ugc_items").update(Object.assign(row, { updated_at: new Date().toISOString() })).eq("id", id)
                        : await sb.from("ugc_items").insert(Object.assign(row, { id, creator: me }));
    if (r.error) throw r.error;
    if (old && old !== path) { try { await sb.storage.from("ugc").remove([old]); } catch (_) {} }
    UG.editId = id; UG.path = path; UG.file = null;
    ugMsg("Saved “" + name + "”."); renderUgcList(); ugSync(); if (typeof refreshWorn === "function") refreshWorn(id);
  } catch (e) { ugMsg("Couldn't save. Run supabase_badges.sql once, and check your badge lets you make UGC.", true); }
  $("ugSave").disabled = false;
}
async function renderUgcList() {
  const sb = getSB(), box = $("ugList"); if (!sb || !acct.user) return;
  try {
    let r = await sb.from("ugc_items").select("id, name, attach, file_path, pos, rot, scale, published, price, sales").eq("creator", acct.user.id).order("created_at", { ascending: false });
    if (r.error) r = await sb.from("ugc_items").select("id, name, attach, file_path, pos, rot, scale").eq("creator", acct.user.id).order("created_at", { ascending: false });
    if (r.error) throw r.error;
    const rows = r.data || []; box._rows = rows;
    box.innerHTML = rows.length ? rows.map(it => `<div class="ugCard box" data-id="${esc(it.id)}"><b>${esc(it.name)}</b><div class="note">${esc((UG_SLOTS.find(x => x[0] === it.attach) || [0, it.attach])[1])}</div><div class="note ugSt">${esc(it.published ? (it.price ? Number(it.price).toLocaleString() + " Triangcles" : "Free") + " · " + (it.sales || 0) + " sold" : "Not for sale")}</div><div class="ugRow"><button class="btnG" data-ug="edit" type="button">Edit</button><button class="btnG" data-ug="del" type="button">Delete</button></div></div>`).join("")
      : '<div class="note">Nothing saved yet. Upload a GLB above to make your first item.</div>';
  } catch (_) { box.innerHTML = '<div class="note">Couldn\'t load your items. Run supabase_badges.sql in Supabase once.</div>'; }
}
$("ugList").addEventListener("click", async e => {
  const b = e.target.closest("[data-ug]"); if (!b) return;
  const id = b.closest("[data-id]").dataset.id, it = ($("ugList")._rows || []).find(x => x.id === id), sb = getSB(); if (!it || !sb) return;
  if (b.dataset.ug === "del") {
    if ((it.sales || 0) > 0) { ugMsg("People have bought that item, so it can't be deleted. Take it off sale instead.", true); return; }
    if (!confirm("Delete “" + it.name + "”?")) return;
    try {
      const d = await sb.from("ugc_items").delete().eq("id", id).select("id");
      if (d.error) throw d.error;
      if (d.data && d.data.length) await sb.storage.from("ugc").remove([it.file_path]);
    } catch (_) { ugMsg("Couldn't delete that item. Someone may own it.", true); return renderUgcList(); }
    if (UG.editId === id) ugClear();
    return renderUgcList();
  }
  ugMsg("Loading…");
  try {
    const url = sb.storage.from("ugc").getPublicUrl(it.file_path).data.publicUrl, resp = await fetch(url);
    if (!resp.ok) throw new Error("fetch");
    await ugLoad(await resp.arrayBuffer(), it.name + ".glb");
    Object.assign(UG, { name: it.name, attach: it.attach, pos: (it.pos || [0, 0, 0]).slice(), rot: (it.rot || [0, 0, 0]).slice(), scale: +it.scale || 1, file: null, path: it.file_path, editId: it.id, price: +it.price || 0, published: !!it.published });
    ugView(); ugSync(); ugApply(); ugMsg("Editing “" + it.name + "”.");
  } catch (_) { ugMsg("Couldn't load that item's file.", true); }
});
function ugStart() {
  renderUgcList(); ugView(); ugSync(); ugApply();
  if (ugv && !ugRun) { ugRun = true; requestAnimationFrame(ugLoop); }
}
function ugLoop() {
  if (!ugOn || !ugv || inGame) { ugRun = false; return; }
  requestAnimationFrame(ugLoop);
  const cv = ugv.r.domElement, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (w && (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr))) { ugv.r.setPixelRatio(pr); ugv.r.setSize(w, h, false); ugv.cam.aspect = w / h; ugv.cam.updateProjectionMatrix(); }
  const sig = colorSig(myColors); if (sig !== ugv.sig) { ugv.sig = sig; setAvatarColors(ugv.av, myColors); }
  const cp = Math.cos(ugv.pitch);
  ugv.cam.position.set(Math.sin(ugv.yaw) * cp * ugv.dist, ugv.ty + Math.sin(ugv.pitch) * ugv.dist, Math.cos(ugv.yaw) * cp * ugv.dist);
  ugv.cam.lookAt(0, ugv.ty, 0);
  ugv.r.render(ugv.sc, ugv.cam);
}
