"use strict";

/* =====================================================================
   World: static boxes (used for both rendering and collision)
   ===================================================================== */
const solids = [];   // {minX,minY,minZ,maxX,maxY,maxZ}

function addSolid(cx, cy, cz, sx, sy, sz) {
  solids.push({
    minX: cx - sx / 2, maxX: cx + sx / 2,
    minY: cy - sy / 2, maxY: cy + sy / 2,
    minZ: cz - sz / 2, maxZ: cz + sz / 2,
  });
}

const IMG_STUD = new Image(), IMG_INLET = new Image(), IMG_FACE = new Image();
IMG_STUD.src = "assets/textures/stud.png";
IMG_INLET.src = "assets/textures/inlet.png";
IMG_FACE.src = "assets/faces/classic.png";
function studTexture(base, repeat, img) {
  const S = 128, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const lit = "#" + [1, 3, 5].map(k => Math.min(255, Math.round(parseInt(base.substr(k, 2), 16) * 1.3 + 30)).toString(16).padStart(2, "0")).join("");
  const draw = () => {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    if (!img.naturalWidth) return;
    g.globalAlpha = 0.2; g.drawImage(img, 0, 0, S, S);            // faint shadow
    const c2 = document.createElement("canvas"); c2.width = c2.height = S;
    const h = c2.getContext("2d"); h.drawImage(img, 0, 0, S, S);
    h.globalCompositeOperation = "source-in"; h.fillStyle = lit; h.fillRect(0, 0, S, S);
    g.globalAlpha = 0.9; g.drawImage(c2, 0, 0); g.globalAlpha = 1;  // stud tinted a brighter shade of the part colour
  };
  draw();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0] || repeat, repeat[1] || repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (!img.naturalWidth) img.addEventListener("load", () => { draw(); t.needsUpdate = true; });
  return t;
}

function makePart(sx, sy, sz, cx, cy, cz, color, topTex, botTex) {
  const plain = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 });
  const top = topTex ? new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.6, metalness: 0 }) : plain;
  const bot = botTex ? new THREE.MeshStandardMaterial({ map: botTex, roughness: 0.6, metalness: 0 }) : plain;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), [plain, plain, top, bot, plain, plain]);
  m.position.set(cx, cy, cz);
  m.receiveShadow = true;
  m.castShadow = true;
  scene.add(m);
  addSolid(cx, cy, cz, sx, sy, sz);
  return m;
}

let BASEPLATE_HALF = 256;
const LADDERS = [];
const SPAWN = new THREE.Vector3(0, 3, 0);   // feet start a bit above the pad

/* ---- game 1: Baseplate (built when you press Play on it) ---- */
function buildBaseplateWorld() {
  // Roblox "Baseplate" template: 512 x 20 x 512, top surface at y = 0
    BASEPLATE_HALF = 256; SPAWN.set(0, 3, 0);
  makePart(512, 20, 512, 0, -10, 0, 0x636262,
    studTexture("#636262", 512, IMG_STUD), studTexture("#636262", 512, IMG_INLET));
  // Default SpawnLocation: 12 x 1 x 12 sitting on the baseplate
  makePart(12, 1, 12, 0, 0.5, 0, 0xa3a2a5,
    studTexture("#a3a2a5", 12, IMG_STUD), studTexture("#a3a2a5", 12, IMG_INLET));
  /* ---- test obby: [x, topY, z, sizeX, sizeZ, colour]; runs out along -Z then +X ---- */
  const OBBY = [
    [0,1,-14,6,6,0xd93b3b],[0,2,-19,4,4,0x2f6fe0],[5,3,-24,4,4,0x2ea84f],[10,4,-30,3,3,0xf0c020],
    [16,5,-30,3,3,0xf08a20],[22,6,-30,3,3,0x9b4fd0],[28,7,-30,3,3,0x20b2aa],[36,7,-30,10,1.5,0xd93b3b],
    [44,8,-30,3,3,0x2f6fe0],[44,9,-36,3,3,0x2ea84f],[44,10,-42,3,3,0xf0c020],[44,10,-52,10,10,0xffd700],
  ];
  for (const [x, ty, z, sx, sz, c] of OBBY) {
    const css = "#" + c.toString(16).padStart(6, "0");
    makePart(sx, 1, sz, x, ty - 0.5, z, c, studTexture(css, [sx, sz], IMG_STUD), studTexture(css, [sx, sz], IMG_INLET));
  }
  /* ---- test ladder: a 12-stud tower with a studded ladder on its front (+Z) face ---- */
  makePart(6, 12, 6, -14, 6, -4, 0x8a8a8a, studTexture("#8a8a8a", [6, 6], IMG_STUD), studTexture("#8a8a8a", [6, 6], IMG_INLET));
  (function () {
    const part = (sx, sy, sz, x, y, z) => {          // studded part, no collision (the ladder is climbed, not walked into)
      makePart(sx, sy, sz, x, y, z, 0xa0703c, studTexture("#a0703c", [sx, sz], IMG_STUD), studTexture("#a0703c", [sx, sz], IMG_INLET));
      solids.pop();
    };
    part(1, 12, 1, -15.5, 6, -0.5); part(1, 12, 1, -12.5, 6, -0.5);
    for (let k = 0; k < 6; k++) part(3, 0.5, 1, -14, 0.25 + k * 2, -0.5);
    LADDERS.push({ x0: -16.2, x1: -11.8, z0: -0.3, z1: 1.2, y0: 0, y1: 12, snapZ: 0.6, nx: 0, nz: 1, topZ: -2.2 });
  })();
  
}

/* ---- game 2: Sharknado (converted from mapgood.rbxl; every part has studs on its top AND bottom) ---- */
// row = [sizeX, sizeY, sizeZ, x, y, z, rotation(3x3 row-major), colour, transparency, canCollide]
function addRotatedCollision(sx, sy, sz, x, y, z, R) {
  const ex = Math.abs(R[0]) * sx + Math.abs(R[1]) * sy + Math.abs(R[2]) * sz;
  const ey = Math.abs(R[3]) * sx + Math.abs(R[4]) * sy + Math.abs(R[5]) * sz;
  const ez = Math.abs(R[6]) * sx + Math.abs(R[7]) * sy + Math.abs(R[8]) * sz;
  if (R.every(v => Math.abs(v) < 1e-3 || Math.abs(Math.abs(v) - 1) < 1e-3)) { addSolid(x, y, z, ex, ey, ez); return; }   // flat or turned in 90 degree steps
  if (window.TriancleRust && window.TriancleRust.tiltedColumns) { const columns = window.TriancleRust.tiltedColumns(sx, sy, sz, x, y, z, R); if (columns) { for (const column of columns) solids.push(column); return; } }
  // tilted part: collide with a field of small columns that follow its surface, so ramps can be walked up
  const cell = Math.max(0.6, Math.sqrt(ex * ez / 400)), h = [sx / 2, sy / 2, sz / 2];
  for (let cx = x - ex / 2 + cell / 2; cx < x + ex / 2; cx += cell) for (let cz = z - ez / 2 + cell / 2; cz < z + ez / 2; cz += cell) {
    let lo = -Infinity, hi = Infinity, ok = true;
    for (let i = 0; i < 3 && ok; i++) {
      const a0 = R[i] * (cx - x) - R[3 + i] * y + R[6 + i] * (cz - z), bb = R[3 + i];
      if (Math.abs(bb) < 1e-6) { if (Math.abs(a0) > h[i]) ok = false; continue; }
      let t0 = (-h[i] - a0) / bb, t1 = (h[i] - a0) / bb; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; }
      lo = Math.max(lo, t0); hi = Math.min(hi, t1);
    }
    if (ok && hi - lo > 0.02) solids.push({ minX: cx - cell / 2, maxX: cx + cell / 2, minY: lo, maxY: hi, minZ: cz - cell / 2, maxZ: cz + cell / 2 });
  }
}
/* one builder for every map: the Sharknado data and any .rbxl the owner uploads.
   row = [sizeX, sizeY, sizeZ, x, y, z, rotation(3x3 row-major), colour, transparency, canCollide, shape(0 ball, 1 block, 2 cylinder)] */
function buildMapWorld(map) {
  SPAWN.set(map.spawn[0], map.spawn[1], map.spawn[2]);
  let half = 0;                                                         // camera stays above the ground only where there is a big ground part
  for (const r of map.parts) if (r[1] <= 64 && Math.abs(r[4] + r[1] / 2) < 2) half = Math.max(half, Math.min(4096, Math.max(r[0], r[2]) / 2));
  BASEPLATE_HALF = half;
  const texC = new Map(), matC = new Map(), geoC = new Map();
  const tex = (css, rx, rz) => { const k = css + "|" + rx.toFixed(2) + "|" + rz.toFixed(2); let t = texC.get(k); if (!t) { t = studTexture(css, [rx, rz], IMG_STUD); texC.set(k, t); } return t; };
  const mat = (k, o, tr) => { const key = k + "|" + tr; let m = matC.get(key); if (!m) { m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.6, metalness: 0, transparent: tr > 0, opacity: 1 - tr }, o)); matC.set(key, m); } return m; };
  for (const row of map.parts) {
    const [sx, sy, sz, x, y, z, R, hex, tr, col, shape] = row;
    const css = "#" + hex.toString(16).padStart(6, "0");
    let m;
    if (shape === 0 || shape === 2) {
      const gk = "s" + shape; let g = geoC.get(gk);
      if (!g) { g = shape === 0 ? new THREE.SphereGeometry(0.5, 20, 14) : new THREE.CylinderGeometry(0.5, 0.5, 1, 24); if (shape === 2) g.rotateZ(Math.PI / 2); geoC.set(gk, g); }
      m = new THREE.Mesh(g, mat("c" + css, { color: hex }, tr)); m.scale.set(sx, sy, sz);
    } else {
      const gk = sx + "|" + sy + "|" + sz; let g = geoC.get(gk); if (!g) { g = new THREE.BoxGeometry(sx, sy, sz); geoC.set(gk, g); }
      const side = mat("s" + css, { color: hex }, tr), st = mat("t" + css + sx.toFixed(2) + sz.toFixed(2), { map: tex(css, sx, sz) }, tr);   // studs on top and bottom
      m = new THREE.Mesh(g, [side, side, st, st, side, side]);
    }
    m.position.set(x, y, z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1));
    m.receiveShadow = true; m.castShadow = tr === 0;
    scene.add(m);
    if (col) addRotatedCollision(sx, sy, sz, x, y, z, R);
  }
}
let worldBuilt = false;
function buildWorld(g) {
  if (worldBuilt) return; worldBuilt = true;
  if (g.id === "baseplate") buildBaseplateWorld();
  else if (g.id === "sharknado") buildMapWorld({ spawn: [0, 3, 0], parts: SHARK_MAP.parts.concat([SHARK_MAP.base]) });
  else buildMapWorld(g.map);
  player.pos.copy(SPAWN); player.prev.copy(SPAWN);
}
