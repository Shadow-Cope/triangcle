"use strict";

/* =====================================================================
   Character visuals (from the FBX data)
   ===================================================================== */
const GEO_CACHE = {};

/* ---- clothing (Shirt / Pants) ----
   Clothes are a PNG on a 640x512 template. Every body part (except the head) gets box-style UVs laid out as a
   "cross" (right | front | left | back, with top above and bottom below the front), and the part's own little canvas
   is built from the matching region of the template. The shader then lays that canvas over the body colour.
   Template regions:  Torso (0,0,384,256)   Right arm/leg (384,0,256,256)   Left arm/leg (384,256,256,256).
   "Right"/"Left" are the avatar's own sides. */
const CLOTH_W = 640, CLOTH_H = 512;
const CLOTH_REG = { T: [0, 0, 384, 256], R: [384, 0, 256, 256], L: [384, 256, 256, 256] };
const CLOTH_PARTS = { Torso: ["T", 512, 256], RightArm: ["R", 256, 256], LeftArm: ["L", 256, 256], RightLeg: ["R", 256, 256], LeftLeg: ["L", 256, 256] };
function clothUV(d, torso) {
  const P = d.pos, n = P.length / 3, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = P[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  const ext = [0, 1, 2].map(a => (mx[a] - mn[a]) || 1);
  const cs = torso ? [0, 1 / 6, 3 / 6, 4 / 6] : [0, 0.25, 0.5, 0.75], cw = torso ? [1 / 6, 2 / 6, 1 / 6, 2 / 6] : [0.25, 0.25, 0.25, 0.25];
  const rs = [0, 0.25, 0.75], rh = [0.25, 0.5, 0.25], cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {                                  // one face per triangle (picked from the triangle's own normal)
    const e1 = [0, 1, 2].map(a => P[(t + 1) * 3 + a] - P[t * 3 + a]), e2 = [0, 1, 2].map(a => P[(t + 2) * 3 + a] - P[t * 3 + a]);
    const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ax = Math.abs(nr[0]) >= Math.abs(nr[1]) && Math.abs(nr[0]) >= Math.abs(nr[2]) ? 0 : Math.abs(nr[1]) >= Math.abs(nr[2]) ? 1 : 2;
    const pos = nr[ax] >= 0;
    for (let k = 0; k < 3; k++) {
      const x = P[(t + k) * 3], y = P[(t + k) * 3 + 1], z = P[(t + k) * 3 + 2];
      const nx = (x - mn[0]) / ext[0], ny = (y - mn[1]) / ext[1], nz = (z - mn[2]) / ext[2];
      let col, row, u, v;
      if (ax === 0) { row = 1; v = 1 - ny; if (pos) { col = 1; u = 1 - nz; } else { col = 3; u = nz; } }   // +X front, -X back
      else if (ax === 2) { row = 1; v = 1 - ny; if (pos) { col = 0; u = nx; } else { col = 2; u = 1 - nx; } } // +Z right side, -Z left side
      else if (pos) { col = 1; row = 0; u = 1 - nz; v = nx; }                                                 // top
      else { col = 1; row = 2; u = 1 - nz; v = 1 - nx; }                                                      // bottom
      uv[(t + k) * 2] = cs[col] + cl(u) * cw[col];
      uv[(t + k) * 2 + 1] = 1 - (rs[row] + cl(v) * rh[row]);
    }
  }
  return uv;
}
const CLOTH_NONE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat); CLOTH_NONE.needsUpdate = true;
function clothify(mat) {
  mat.userData.clothU = { value: CLOTH_NONE };
  mat.onBeforeCompile = sh => {
    sh.uniforms.clothMap = mat.userData.clothU;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCU;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCU = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCU; uniform sampler2D clothMap;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n{ vec4 cc = texture2D(clothMap, vCU); diffuseColor.rgb = mix(diffuseColor.rgb, cc.rgb, cc.a); }");
  };
  mat.customProgramCacheKey = () => "clothpart";
}
/* shirt / pants are 640x512 canvases (or null). Shirt covers torso + arms; pants cover legs + the bottom of the torso; shirt sits on top. */
function setAvatarCloth(av, shirt, pants) {
  for (const name in CLOTH_PARTS) {
    const pv = av.rig[name]; if (!pv) continue;
    const mat = pv.children[0].material, u = mat.userData.clothU; if (!u) continue;
    const info = CLOTH_PARTS[name], reg = CLOTH_REG[info[0]], cw = info[1], ch = info[2], layers = [];
    if (pants && (name === "Torso" || name.endsWith("Leg"))) layers.push([pants, name === "Torso"]);
    if (shirt && (name === "Torso" || name.endsWith("Arm"))) layers.push([shirt, false]);
    if (!layers.length) { if (mat.userData.clothTex) { mat.userData.clothTex.dispose(); mat.userData.clothTex = null; } u.value = CLOTH_NONE; continue; }
    let tex = mat.userData.clothTex;
    if (!tex) { const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch; tex = mat.userData.clothTex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; }
    const g = tex.image.getContext("2d"); g.clearRect(0, 0, cw, ch);
    for (const L of layers) {
      g.save();
      if (L[1]) { g.beginPath(); g.rect(0, 160, cw, 32); g.clip(); }   // pants on the torso: just the lowest quarter of the sides
      g.drawImage(L[0], reg[0], reg[1], reg[2], reg[3], 0, 0, cw, ch);
      g.restore();
    }
    tex.needsUpdate = true; u.value = tex;
  }
}

function partGeometry(name) {
  if (!GEO_CACHE[name]) {
    const d = MODEL_PARTS[name];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(d.pos), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(d.nor), 3));
    if (name === "Head") {   // head is a rounded cylinder: project the face straight onto its front half; the rest samples plain yellow
      const P = d.pos, N = d.nor, uv = new Float32Array(P.length / 3 * 2);
      for (let k = 0; k < P.length / 3; k++) {
        if (P[k * 3] > 0) { uv[k * 2] = (0.55 - P[k * 3 + 2]) / 1.1; uv[k * 2 + 1] = (P[k * 3 + 1] - 3.95) / 1.1; }
        else { uv[k * 2] = -1; uv[k * 2 + 1] = -1; }
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    } else geo.setAttribute("uv", new THREE.BufferAttribute(clothUV(d, name === "Torso" || name === "FemaleTorso"), 2));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    GEO_CACHE[name] = geo;
  }
  return GEO_CACHE[name];
}

// One avatar = group + rig (name -> pivot group; rotate .rotation.z to swing, + = forward)
const FACE_NAMES = ["Classic", "Content", "Worried", "Happy", "Silly", "Angry", "Smirk"];
const FACE_SRC = [""].concat(["assets/faces/content.png", "assets/faces/worried.png", "assets/faces/happy.png", "assets/faces/silly.png", "assets/faces/angry.png", "assets/faces/smirk.png"]);
const FACE_IMGS = FACE_SRC.map((src, k) => { if (!k) return IMG_FACE; const im = new Image(); im.src = src; return im; });
FACE_SRC[0] = IMG_FACE.src;
const FACE_TEXS = FACE_IMGS.map((im, k) => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const paint = () => { const g = cv.getContext("2d"); g.clearRect(0, 0, 256, 256); g.drawImage(im, 0, 0, 256, 256); tex.needsUpdate = true;
    try { thumbs.cache.clear(); } catch (_) {} };
  if (im.complete && im.naturalWidth) paint(); else im.addEventListener("load", paint);
  return tex;
});
function setAvatarFace(av, k) {
  const h = av.rig.Head && av.rig.Head.children[0];
  if (h && h.material.userData.faceU) h.material.userData.faceU.value = FACE_TEXS[FACE_TEXS[k] ? k : 0];
}
function faceify(mat) {
  mat.userData.faceU = { value: FACE_TEXS[0] };
  mat.onBeforeCompile = sh => {
    sh.uniforms.faceMap = mat.userData.faceU;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOP; varying vec2 vFU;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOP = position; vFU = vec2((0.55 - position.z) / 1.1, (position.y - 3.95) / 1.1);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOP; varying vec2 vFU; uniform sampler2D faceMap;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n{ vec4 fc = texture2D(faceMap, vFU); float fm = step(0.0, vOP.x) * step(0.0, vFU.x) * step(vFU.x, 1.0) * step(0.0, vFU.y) * step(vFU.y, 1.0); diffuseColor.rgb = mix(diffuseColor.rgb, fc.rgb, fc.a * fm); }");
  };
  mat.customProgramCacheKey = () => "headface";
}
const FF_MAT = new THREE.MeshBasicMaterial({ color: 0x55bbff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
function setFF(av, on) { for (const m of av.ff) m.visible = on; }

function createAvatar() {
  const group = new THREE.Group(); group.rotation.order = "YXZ";
  const rig = {}, ff = [];
  let tMesh = null, tFF = null;
  for (const name of Object.keys(MODEL_PARTS)) {
    if (name === "FemaleTorso") continue;                    // alternate torso: swapped in by setAvatarBody()
    const d = MODEL_PARTS[name];
    const mesh = new THREE.Mesh(partGeometry(name), new THREE.MeshStandardMaterial({
      color: PART_STYLE[name] || 0xcccccc, roughness: 0.55, metalness: 0,
    }));
    mesh.castShadow = true;
    if (name === "Head") faceify(mesh.material); else clothify(mesh.material);
    const pivot = new THREE.Group();
    pivot.position.set(d.pivot[0], d.pivot[1], d.pivot[2]);
    pivot.add(mesh);
    const ffm = new THREE.Mesh(partGeometry(name), FF_MAT);
    ffm.visible = false; ffm.renderOrder = 2;
    pivot.add(ffm); ff.push(ffm);
    if (name === "Torso") { tMesh = mesh; tFF = ffm; }
    group.add(pivot);
    rig[name] = pivot;
  }
  return { group, rig, ff, tMesh, tFF, female: false, ln: 0, rl: 0, by: 0, facing: Math.PI / 2, ang: { LeftArm: 0, RightArm: 0, LeftLeg: 0, RightLeg: 0 } };
}
function setAvatarBody(av, female) {                           // male torso <-> female torso (same pivot, so items / animation are unaffected)
  female = !!female; if (!av.tMesh || av.female === female) return;
  av.female = female;
  const g = partGeometry(female ? "FemaleTorso" : "Torso");
  av.tMesh.geometry = g; av.tFF.geometry = g;
}

const localAvatar = createAvatar();
const charGroup = localAvatar.group;
const rig = localAvatar.rig;
scene.add(charGroup);
