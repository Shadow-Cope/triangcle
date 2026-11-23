"use strict";

/* =====================================================================
   BTools: spawn / select / edit parts (local only)
   ===================================================================== */
const userParts = [];
let selPart = null, btOn = false, partId = 0, placing = false, gizmoMode = "move", drag = null;
const $ = id => document.getElementById(id);
const BT_GEO = { Block: new THREE.BoxGeometry(1, 1, 1), Ball: new THREE.SphereGeometry(0.5, 24, 16), Cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 24) };
const selBox = new THREE.BoxHelper(new THREE.Mesh(BT_GEO.Block), 0x33aaff);
selBox.visible = false; scene.add(selBox);

function syncSolid(pt) {
  const h = pt.size.map(v => v / 2), s = pt.solid, p = pt.pos;
  const calculated = window.TriancleRust && window.TriancleRust.builtSolid ? window.TriancleRust.builtSolid(pt) : null;
  if (calculated) [s.minX,s.maxX,s.minY,s.maxY,s.minZ,s.maxZ] = calculated.slice(0,6);
  else { s.minX = p.x - h[0]; s.maxX = p.x + h[0]; s.minY = p.y - h[1]; s.maxY = p.y + h[1]; s.minZ = p.z - h[2]; s.maxZ = p.z + h[2]; }
  const i = solids.indexOf(s);
  if (pt.collide && i < 0) solids.push(s); else if (!pt.collide && i >= 0) solids.splice(i, 1);
}
function rebuildPart(pt) {
  const m = pt.mesh, css = "#" + pt.color.toString(16).padStart(6, "0");
  const mk = map => new THREE.MeshStandardMaterial({ color: map ? 0xffffff : pt.color, map: map || null, roughness: 0.6, metalness: 0,
    transparent: pt.transp > 0, opacity: 1 - pt.transp, depthWrite: pt.transp < 0.5 });
  m.geometry = BT_GEO[pt.shape];
  if (pt.shape === "Block") {
    const plain = mk(null), r = [pt.size[0], pt.size[2]];
    m.material = [plain, plain, mk(studTexture(css, r, IMG_STUD)), mk(studTexture(css, r, IMG_INLET)), plain, plain];
  } else m.material = mk(null);
  m.scale.set(pt.size[0], pt.size[1], pt.size[2]);
  m.position.copy(pt.pos);
  m.castShadow = m.receiveShadow = true;
  syncSolid(pt);
}
function syncPanel() {
  $("btProps").style.display = selPart ? "block" : "none";
  updateHint();
  if (!selPart) return;
  const pt = selPart;
  $("btShape").value = pt.shape;
  ["sx", "sy", "sz"].forEach((id, i) => { $(id).value = pt.size[i]; });
  $("px").value = +pt.pos.x.toFixed(2); $("py").value = +pt.pos.y.toFixed(2); $("pz").value = +pt.pos.z.toFixed(2);
  $("btT").value = pt.transp; $("btC").value = "#" + pt.color.toString(16).padStart(6, "0");
  $("btA").checked = pt.anchored; $("btK").checked = pt.collide;
}
function selectPart(pt) {
  selPart = pt; selBox.visible = !!pt;
  if (pt) { pt.mesh.updateMatrixWorld(true); selBox.setFromObject(pt.mesh); }
  syncPanel();
}
function updateHint() {
  const h = $("btHint");
  if (placing) { h.style.display = "block"; h.textContent = "Click in the world to place the part"; }
  else if (!selPart) { h.style.display = "block"; h.textContent = "Click a part to select it"; }
  else h.style.display = "none";
}
function spawnPart(at) {
  const dx = Math.cos(facing), dz = -Math.sin(facing);
  const pt = { id: ++partId, gid: NET.id + ":" + partId, owner: NET.id, mesh: new THREE.Mesh(), shape: "Block", size: [4, 1, 2], color: 0xa3a2a5, transp: 0, anchored: true, collide: true, vy: 0, solid: {},
    pos: at ? at.clone() : new THREE.Vector3(player.pos.x + dx * 7, player.pos.y + 3, player.pos.z + dz * 7) };
  scene.add(pt.mesh); userParts.push(pt); rebuildPart(pt); selectPart(pt); markPart(pt);
}
function removePart(pt, silent) {
  if (!silent && pt.owner === NET.id) netSend({ t: "partdel", g: pt.gid });
  scene.remove(pt.mesh); const i = solids.indexOf(pt.solid); if (i >= 0) solids.splice(i, 1);
  userParts.splice(userParts.indexOf(pt), 1);
  if (selPart === pt) selectPart(null);
}
function applyPanel(e) {
  const pt = selPart; if (!pt) return;
  const n = id => parseFloat($(id).value);
  pt.shape = $("btShape").value;
  pt.size = ["sx", "sy", "sz"].map(id => Math.max(0.2, n(id) || 1));
  if (["px", "py", "pz"].includes(e.target.id)) pt.pos.set(n("px") || 0, n("py") || 0, n("pz") || 0);
  pt.transp = n("btT") || 0; pt.color = parseInt($("btC").value.slice(1), 16) || 0;
  pt.anchored = $("btA").checked; pt.collide = $("btK").checked; if (pt.anchored) pt.vy = 0;
  rebuildPart(pt); selBox.setFromObject(pt.mesh); markPart(pt);
  if (e.target.type !== "number") e.target.blur();
}
/* who may use BTools in this game: the game's setting is "all" (default), "staff" (Owner + Admin badge) or "off" */
const btMode = () => (curGame && curGame.btools) || "all";
function canBuild() {
  const m = btMode();
  const allowed = window.TriancleRust && window.TriancleRust.canBuild ? window.TriancleRust.canBuild(m,!!acct.user,isOwner(),!!(acct.user && badgeList(acct.user.id).includes("admin"))) : null;
  if (allowed !== null) return allowed;
  if (m === "off") return false;
  if (m === "staff") return !!acct.user && (isOwner() || badgeList(acct.user.id).includes("admin"));
  return true;
}
function applyBuildAccess() { const ok = canBuild(); $("slotBT").style.display = ok ? "" : "none"; if (!ok && btOn) toggleBT(); }
function toggleBT() {
  if (!btOn && !canBuild()) return;
  btOn = !btOn; $("bt").style.display = btOn ? "block" : "none"; $("slotBT").classList.toggle("on", btOn);
  if (!btOn) { selectPart(null); placing = false; drag = null; canvas.style.cursor = ""; }
}
function stepUserParts(dt) {
  for (let i = userParts.length - 1; i >= 0; i--) {
    const pt = userParts[i]; if (pt.anchored) continue;
    const stepped = window.TriancleRust && window.TriancleRust.stepBuiltPart ? window.TriancleRust.stepBuiltPart(pt, dt, CFG.GRAVITY, solids) : null;
    if (stepped) { pt.pos.y = stepped[0]; pt.vy = stepped[1]; } else {
    pt.vy -= CFG.GRAVITY * dt; pt.pos.y += pt.vy * dt;
    const hx = pt.size[0] / 2, hy = pt.size[1] / 2, hz = pt.size[2] / 2, p = pt.pos;
    if (pt.collide) for (const s of solids) {
      if (s === pt.solid || pt.vy > 0) continue;
      if (p.x + hx > s.minX && p.x - hx < s.maxX && p.z + hz > s.minZ && p.z - hz < s.maxZ && p.y + hy > s.minY && p.y - hy < s.maxY) { p.y = s.maxY + hy; pt.vy = 0; }
    }
    }
    const p = pt.pos;
    if (p.y < CFG.FALL_DESTROY_Y) { removePart(pt); continue; }
    if (pt.vy !== 0) pt.mv = true; else if (pt.mv) { pt.mv = false; markPart(pt); }   // settled: tell everyone where it landed
    pt.mesh.position.copy(p); syncSolid(pt);
  }
}
const partDirty = new Set(); let partTimer = 0;
function markPart(pt) { if (pt.owner === NET.id) partDirty.add(pt); }
function sendAllMyParts() { for (const pt of userParts) markPart(pt); }
function flushParts(dt) {
  partTimer += dt; if (partTimer < 0.12 || !partDirty.size) return; partTimer = 0;
  const arr = [...partDirty].filter(pt => userParts.includes(pt)).map(pt => ({ g: pt.gid, sh: pt.shape, sz: pt.size, c: pt.color, t: pt.transp, an: pt.anchored ? 1 : 0, co: pt.collide ? 1 : 0, p: [pt.pos.x, pt.pos.y, pt.pos.z] }));
  partDirty.clear();
  for (let i = 0; i < arr.length; i += 20) netSend({ t: "parts", list: arr.slice(i, i + 20) });
}
function applyRemotePart(d, owner) {
  const num = v => typeof v === "number" && isFinite(v);
  if (!d || typeof d.g !== "string" || !Array.isArray(d.sz) || d.sz.length !== 3 || !Array.isArray(d.p) || d.p.length !== 3 || !d.sz.every(num) || !d.p.every(num)) return;
  let pt = userParts.find(q => q.gid === d.g);
  if (pt && pt.owner !== owner) return;                       // nobody can overwrite someone else's part
  if (!pt) { pt = { id: ++partId, gid: d.g, owner, mesh: new THREE.Mesh(), vy: 0, solid: {}, pos: new THREE.Vector3() }; scene.add(pt.mesh); userParts.push(pt); }
  pt.shape = BT_GEO[d.sh] ? d.sh : "Block";
  const normalized = window.TriancleRust && window.TriancleRust.remotePart ? window.TriancleRust.remotePart(d) : null;
  if (normalized) { pt.size = normalized.slice(0,3); pt.color = normalized[6]; pt.transp = normalized[7]; pt.anchored = !!normalized[8]; pt.collide = !!normalized[9]; pt.vy = 0; pt.pos.set(normalized[3],normalized[4],normalized[5]); }
  else { pt.size = d.sz.map(v => Math.max(0.2, Math.min(512, v))); pt.color = (d.c | 0) & 0xffffff; pt.transp = Math.max(0, Math.min(1, +d.t || 0)); pt.anchored = !!d.an; pt.collide = !!d.co; pt.vy = 0; pt.pos.set(d.p[0], d.p[1], d.p[2]); }
  rebuildPart(pt);
}
function onPartMsg(m) {
  if (btMode() === "off") return;                                   // building is switched off in this game: ignore anyone else's parts
  if (!m || !m.id || m.id === NET.id) return;
  const id = String(m.id);
  if (m.t === "parts" && Array.isArray(m.list)) { for (const d of m.list.slice(0, 40)) applyRemotePart(d, id); }
  else if (m.t === "partdel") { const pt = userParts.find(q => q.gid === m.g && q.owner === id); if (pt) removePart(pt, true); }
  else if (m.t === "partreq") sendAllMyParts();
}
/* ---- hitboxes (` key): every collidable part, ladders, and player boxes ---- */
let hitOn = false;
const hitGroup = new THREE.Group(); hitGroup.visible = false; scene.add(hitGroup);
const HB_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), hbPool = [];
function updateHitboxes() {
  hitGroup.visible = hitOn; if (!hitOn) return;
  let n = 0;
  const put = (cx, cy, cz, sx, sy, sz, col, depth) => {
    let l = hbPool[n]; if (!l) { l = new THREE.LineSegments(HB_GEO, new THREE.LineBasicMaterial()); l.renderOrder = 5; hitGroup.add(l); hbPool[n] = l; }
    l.visible = true; l.material.color.setHex(col); l.material.depthTest = depth; l.position.set(cx, cy, cz); l.scale.set(sx, sy, sz); n++;
  };
  for (const b of solids) { const sx = b.maxX - b.minX; if (sx < 100) put((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2, sx, b.maxY - b.minY, b.maxZ - b.minZ, 0x3cff7a, true); }
  for (const L of LADDERS) put((L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2, (L.z0 + L.z1) / 2, L.x1 - L.x0, L.y1 - L.y0, L.z1 - L.z0, 0xffd83c, true);
  for (const pl of players.values()) { const g = pl.avatar.group; if (g.visible) put(g.position.x, g.position.y + CFG.CHAR_HEIGHT / 2, g.position.z, CFG.CHAR_HALF_XZ * 2, CFG.CHAR_HEIGHT, CFG.CHAR_HALF_XZ * 2, pl.local ? 0xff4040 : 0xff9a3c, false); }
  for (let i = n; i < hbPool.length; i++) hbPool[i].visible = false;
}
$("btSpawn").addEventListener("click", () => { placing = !placing; canvas.style.cursor = placing ? "crosshair" : ""; updateHint(); });
$("btDel").addEventListener("click", () => { if (selPart) removePart(selPart); });
$("slotBT").addEventListener("click", toggleBT);
["btShape", "sx", "sy", "sz", "px", "py", "pz", "btT", "btC", "btA", "btK"].forEach(id => $(id).addEventListener("input", applyPanel));
/* ---- 3D handles: arrows to move, boxes to resize (1-stud snapping) ---- */
const GCOL = [0xff4444, 0x44dd44, 0x4488ff], AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const gizmo = new THREE.Group(); gizmo.visible = false; scene.add(gizmo);
const gHandles = [];
for (let a = 0; a < 3; a++) for (const sg of [1, -1]) for (const kind of ["move", "size"]) {
  const geo = kind === "move" ? new THREE.ConeGeometry(0.45, 1.3, 14) : new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: GCOL[a], depthTest: false, transparent: true, opacity: 0.95 }));
  m.renderOrder = 999; m.userData = { a, sg, kind };
  if (kind === "move") m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), AX[a].clone().multiplyScalar(sg));
  gizmo.add(m); gHandles.push(m);
}
function updateGizmo() {
  if (!selPart || !btOn) { gizmo.visible = false; return; }
  gizmo.visible = true;
  const pt = selPart, k = Math.max(0.35, camera.position.distanceTo(pt.pos) * 0.05);
  for (const m of gHandles) {
    const { a, sg, kind } = m.userData; m.visible = kind === gizmoMode;
    m.position.copy(pt.pos).addScaledVector(AX[a], sg * (pt.size[a] / 2 + (kind === "move" ? 1.2 : 0.7) * k));
    m.scale.setScalar(k);
  }
}
function setMode(md) { gizmoMode = md; $("btMove").style.opacity = md === "move" ? 1 : 0.55; $("btSize").style.opacity = md === "size" ? 1 : 0.55; }
$("btMove").addEventListener("click", () => setMode("move")); $("btSize").addEventListener("click", () => setMode("size")); setMode("move");
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function aimRay(e) { _ndc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); _ray.setFromCamera(_ndc, camera); }
function axisParam(origin, dir) {   // where along the axis line the mouse ray passes closest
  if (window.TriancleRust && window.TriancleRust.axisParam) { const result = window.TriancleRust.axisParam(origin,dir,_ray.ray); if (result) return result.value; }
  const r = _ray.ray, b = dir.dot(r.direction), w0 = origin.clone().sub(r.origin);
  const den = 1 - b * b; if (Math.abs(den) < 1e-4) return null;
  return (b * r.direction.dot(w0) - dir.dot(w0)) / den;
}
canvas.addEventListener("mousedown", e => {
  if (!btOn || e.button !== 0 || document.pointerLockElement) return;
  aimRay(e);
  if (placing) {                                   // place the new part where you clicked
    const hit = _ray.intersectObjects(scene.children.filter(o => o.isMesh && o.receiveShadow), false)[0];
    if (hit) {
      const n = hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0), sz = [4, 1, 2];
      const off = Math.abs(n.x) * sz[0] / 2 + Math.abs(n.y) * sz[1] / 2 + Math.abs(n.z) * sz[2] / 2;
      const at = hit.point.clone().addScaledVector(n, off); at.x = Math.round(at.x); at.z = Math.round(at.z);
      spawnPart(at); placing = false; canvas.style.cursor = ""; updateHint();
    }
    return;
  }
  if (selPart) {
    gizmo.updateMatrixWorld(true);
    const h = _ray.intersectObjects(gHandles.filter(m => m.visible), false)[0];
    if (h) {
      const { a, sg, kind } = h.object.userData, s0 = axisParam(selPart.pos, AX[a]);
      if (s0 !== null) { drag = { a, sg, kind, s0, pos: selPart.pos.clone(), size: selPart.size.slice(), last: null }; selPart.vy = 0; }
      return;
    }
  }
  const hit = _ray.intersectObjects(userParts.filter(p => p.owner === NET.id).map(p => p.mesh))[0];   // you can only edit your own parts
  selectPart(hit ? userParts.find(p => p.mesh === hit.object) : null);
});
window.addEventListener("mousemove", e => {
  if (!drag || !selPart) return;
  aimRay(e);
  const s = axisParam(drag.pos, AX[drag.a]); if (s === null) return;
  const d = s - drag.s0, pt = selPart, a = drag.a;
  if (drag.kind === "move") {
    const q = Math.round(d); if (q === drag.last) return; drag.last = q;
    pt.pos.copy(drag.pos).addScaledVector(AX[a], q); pt.mesh.position.copy(pt.pos); syncSolid(pt);
  } else {
    const ns = Math.max(1, Math.round(drag.size[a] + drag.sg * d)); if (ns === drag.last) return; drag.last = ns;
    pt.size = drag.size.slice(); pt.size[a] = ns;
    pt.pos.copy(drag.pos).addScaledVector(AX[a], drag.sg * (ns - drag.size[a]) / 2); rebuildPart(pt);
  }
  markPart(pt); syncPanel();
});
window.addEventListener("mouseup", () => { drag = null; });
