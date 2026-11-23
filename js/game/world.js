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
/* ---- part shapes: 0 ball, 1 block, 2 cylinder, 3 wedge, 4 corner wedge ---- */
const SHAPE_NAMES = ["Ball", "Block", "Cylinder", "Wedge", "CornerWedge"];

/* material presets, the same list Triancle Studio offers */
const MAT_PRESETS = {
  Plastic:          { roughness: 0.62, metalness: 0 },
  "Smooth Plastic": { roughness: 0.32, metalness: 0 },
  Metal:            { roughness: 0.28, metalness: 0.88 },
  Neon:             { roughness: 0.40, metalness: 0, emissive: true },
  Glass:            { roughness: 0.08, metalness: 0, glass: true },
};

/* unit geometries for the shapes that are just scaled to the part size */
const SHAPE_GEO_CACHE = {};
function shapeGeometry(shape) {
  if (SHAPE_GEO_CACHE[shape]) return SHAPE_GEO_CACHE[shape];
  let g;
  if (shape === 0) g = new THREE.SphereGeometry(0.5, 20, 14);
  else if (shape === 2) { g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.rotateZ(Math.PI / 2); }
  else if (shape === 3 || shape === 4) {
    // wedge (3): tall vertical face at -Z, slopes down toward +Z
    // corner wedge (4): tall at the -X/-Z corner, slopes down toward +X and +Z
    const w = [
      // bottom
      -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,  0.5, -0.5, 0.5,  -0.5, -0.5, 0.5,
      // back (-Z)
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,  0.5, 0.5, -0.5,
      -0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  0.5, -0.5, -0.5,
      // left (-X)
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5,
      // right (+X)
      0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  0.5, -0.5, 0.5,
      // slope
      -0.5, 0.5, -0.5, -0.5, -0.5, 0.5,  0.5, -0.5, 0.5,
      -0.5, 0.5, -0.5,  0.5, -0.5, 0.5,  0.5, 0.5, -0.5,
    ];
    const c = [
      // bottom
      -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,  0.5, -0.5, 0.5,  -0.5, -0.5, 0.5,
      // back (-Z)
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,  0.5, -0.5, -0.5,
      // left (-X)
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5,
      // slope (two triangles across the corner)
      -0.5, 0.5, -0.5,  0.5, -0.5, 0.5,  0.5, -0.5, -0.5,
      -0.5, 0.5, -0.5, -0.5, -0.5, 0.5,  0.5, -0.5, 0.5,
    ];
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(shape === 4 ? c : w, 3));
    g.computeVertexNormals();
  } else {
    g = new THREE.BoxGeometry(1, 1, 1);
  }
  SHAPE_GEO_CACHE[shape] = g;
  return g;
}

/* Wedges collide as a staircase of columns that follows the slope, so ramps can be
   walked up. Only axis-aligned wedges get the sloped collider; a turned one falls
   back to a plain box (same as every other turned part). */
function addWedgeCollision(sx, sy, sz, x, y, z, R, corner) {
  const flat = Math.abs(R[1]) < 1e-3 && Math.abs(R[2]) < 1e-3 && Math.abs(R[3]) < 1e-3 &&
               Math.abs(R[5]) < 1e-3 && Math.abs(R[6]) < 1e-3 && Math.abs(R[7]) < 1e-3 &&
               Math.abs(R[0] - 1) < 1e-3 && Math.abs(R[4] - 1) < 1e-3 && Math.abs(R[8] - 1) < 1e-3;
  if (!flat) { addRotatedCollision(sx, sy, sz, x, y, z, R); return; }
  const minY = y - sy / 2, maxY = y + sy / 2, minZ = z - sz / 2, minX = x - sx / 2;
  const N = Math.max(4, Math.min(24, Math.round(sz)));
  const M = corner ? Math.max(4, Math.min(24, Math.round(sx))) : 1;
  for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
    const x0 = minX + sx * i / M, x1 = x0 + sx / M;
    const z0 = minZ + sz * j / N, z1 = z0 + sz / N;
    let t = ((z0 + z1) / 2 - minZ) / (sz || 1);                 // 0 at the tall -Z face, 1 at +Z
    if (corner) t = Math.max(t, ((x0 + x1) / 2 - minX) / (sx || 1));
    const top = maxY - sy * Math.min(1, Math.max(0, t));
    if (top - minY < 0.02) continue;
    solids.push({ minX: x0, maxX: x1, minY, maxY: top, minZ: z0, maxZ: z1 });
  }
}

/* one builder for every map: the Sharknado data, published Triancle Studio games and any .rbxl the owner uploads.
   row = [sizeX, sizeY, sizeZ, x, y, z, rotation(3x3 row-major), colour, transparency, canCollide, shape,
          material, texture, name, anchored]
   shape: 0 ball, 1 block, 2 cylinder, 3 wedge, 4 corner wedge
   material: Plastic / Smooth Plastic / Metal / Neon / Glass
   texture: Studs / Inlet / Smooth (blocks only) */
function buildMapWorld(map) {
  SPAWN.set(map.spawn[0], map.spawn[1], map.spawn[2]);
  let half = 0;                                                         // camera stays above the ground only where there is a big ground part
  for (const r of map.parts) if (r[1] <= 64 && Math.abs(r[4] + r[1] / 2) < 2) half = Math.max(half, Math.min(4096, Math.max(r[0], r[2]) / 2));
  BASEPLATE_HALF = half;
  const texC = new Map(), matC = new Map(), geoC = new Map();
  const presetOf = name => MAT_PRESETS[name] || MAT_PRESETS.Plastic;
  const opacityOf = (preset, tr) => Math.max(0.02, Math.min(1, (preset.glass ? 0.55 : 1) * (1 - (tr || 0))));
  const tex = (css, rx, rz, img) => {
    const k = css + "|" + rx.toFixed(2) + "|" + rz.toFixed(2) + "|" + (img === IMG_INLET ? "i" : "s");
    let t = texC.get(k); if (!t) { t = studTexture(css, [rx, rz], img); texC.set(k, t); }
    return t;
  };
  const mat = (hex, tr, name) => {
    const preset = presetOf(name), opacity = opacityOf(preset, tr);
    const key = "m|" + hex + "|" + name + "|" + opacity.toFixed(3);
    let m = matC.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: preset.roughness, metalness: preset.metalness, transparent: opacity < 1, opacity, depthWrite: opacity > 0.55 });
      if (preset.emissive) { m.emissive.setHex(hex); m.emissiveIntensity = 0.8; }
      matC.set(key, m);
    }
    return m;
  };
  const texMat = (css, tr, name, rx, rz, img) => {                       // studded face: material + stud/inlet texture
    const preset = presetOf(name), opacity = opacityOf(preset, tr);
    const key = "t|" + css + "|" + name + "|" + opacity.toFixed(3) + "|" + rx.toFixed(2) + "|" + rz.toFixed(2) + "|" + (img === IMG_INLET ? "i" : "s");
    let m = matC.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: tex(css, rx, rz, img), color: 0xffffff, roughness: preset.roughness, metalness: preset.metalness, transparent: opacity < 1, opacity, depthWrite: opacity > 0.55 });
      matC.set(key, m);
    }
    return m;
  };
  for (const row of map.parts) {
    const sx = +row[0] || 1, sy = +row[1] || 1, sz = +row[2] || 1;
    const x = +row[3] || 0, y = +row[4] || 0, z = +row[5] || 0;
    const R = Array.isArray(row[6]) && row[6].length === 9 ? row[6] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const hex = (row[7] | 0) & 0xffffff, tr = Math.max(0, Math.min(1, +row[8] || 0)), col = !(row[9] === 0 || row[9] === false);
    const shape = [0, 1, 2, 3, 4].includes(row[10]) ? row[10] : 1;
    const matName = typeof row[11] === "string" && MAT_PRESETS[row[11]] ? row[11] : "Plastic";
    const texMode = row[12] === "Smooth" || row[12] === "Inlet" ? row[12] : "Studs";
    const css = "#" + hex.toString(16).padStart(6, "0");
    const preset = presetOf(matName);
    let m;
    if (shape === 1) {
      const gk = "b" + sx + "|" + sy + "|" + sz;
      let g = geoC.get(gk); if (!g) { g = new THREE.BoxGeometry(sx, sy, sz); geoC.set(gk, g); }
      const side = mat(hex, tr, matName);
      if (texMode === "Smooth") m = new THREE.Mesh(g, side);
      else {
        const top = texMat(css, tr, matName, sx, sz, texMode === "Inlet" ? IMG_INLET : IMG_STUD);
        const bot = texMat(css, tr, matName, sx, sz, IMG_INLET);
        m = new THREE.Mesh(g, [side, side, top, bot, side, side]);
      }
    } else {
      const gk = "s" + shape;
      let g = geoC.get(gk); if (!g) { g = shapeGeometry(shape); geoC.set(gk, g); }
      m = new THREE.Mesh(g, mat(hex, tr, matName));
      m.scale.set(sx, sy, sz);
    }
    m.position.set(x, y, z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1));
    m.receiveShadow = true;
    m.castShadow = tr === 0 && !preset.glass;
    scene.add(m);
    if (!col) continue;
    if (shape === 0 && Math.min(sx, sy, sz) > Math.max(sx, sy, sz) * 0.95) {      // a round ball: exact sphere hitbox
      solids.push({ minX: x - sx / 2, maxX: x + sx / 2, minY: y - sy / 2, maxY: y + sy / 2, minZ: z - sz / 2, maxZ: z + sz / 2, ball: { cx: x, cy: y, cz: z, r: Math.min(sx, sy, sz) / 2 } });
    } else if (shape === 3 || shape === 4) addWedgeCollision(sx, sy, sz, x, y, z, R, shape === 4);
    else addRotatedCollision(sx, sy, sz, x, y, z, R);
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
