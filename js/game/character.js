"use strict";

/* =====================================================================
   Character visuals (from the FBX data)
   ===================================================================== */
const GEO_CACHE = {};

/* ---- clothing (Shirt / Pants) ----
   Clothes are a 512x512 PNG made on the Triancle templates (assets/templates). Each body part (except the head) gets
   UVs that point straight at its own cells of that template, and the shader lays the shirt / pants over the body colour.
   Cells are [x, y, w, h] in template pixels; F front (+X), B back (-X), R avatar's right side (+Z), L left side (-Z), U top, D bottom.
   Torso: T.  Right arm / right leg: A.  Left arm / left leg: C. */
const CLOTH_W = 512, CLOTH_H = 512;
const CLOTH_CELLS = {
  T: { U: [167, 79, 86, 54], R: [102, 135, 54, 106], F: [158, 135, 104, 106], L: [264, 135, 54, 106], B: [320, 135, 104, 106], D: [158, 243, 104, 54] },
  A: { U: [66, 261, 54, 54], R: [10, 317, 54, 106], F: [66, 317, 54, 106], L: [122, 317, 54, 106], B: [178, 317, 54, 106], D: [66, 425, 54, 54] },
  C: { U: [390, 261, 54, 54], B: [278, 317, 54, 106], R: [334, 317, 54, 106], F: [390, 317, 54, 106], L: [446, 317, 54, 106], D: [390, 425, 54, 54] },
};
const CLOTH_SET = { Torso: "T", FemaleTorso: "T", RightArm: "A", RightLeg: "A", LeftArm: "C", LeftLeg: "C" };
function clothUV(d, set) {
  const cells = CLOTH_CELLS[set], P = d.pos, n = P.length / 3, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = P[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  const ext = [0, 1, 2].map(a => (mx[a] - mn[a]) || 1), cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {                                  // one face per triangle (picked from the triangle's own normal)
    const e1 = [0, 1, 2].map(a => P[(t + 1) * 3 + a] - P[t * 3 + a]), e2 = [0, 1, 2].map(a => P[(t + 2) * 3 + a] - P[t * 3 + a]);
    const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ax = Math.abs(nr[0]) >= Math.abs(nr[1]) && Math.abs(nr[0]) >= Math.abs(nr[2]) ? 0 : Math.abs(nr[1]) >= Math.abs(nr[2]) ? 1 : 2;
    const pos = nr[ax] >= 0, face = ax === 0 ? (pos ? "F" : "B") : ax === 2 ? (pos ? "R" : "L") : (pos ? "U" : "D"), c = cells[face];
    for (let k = 0; k < 3; k++) {
      const x = P[(t + k) * 3], y = P[(t + k) * 3 + 1], z = P[(t + k) * 3 + 2];
      const nx = (x - mn[0]) / ext[0], ny = (y - mn[1]) / ext[1], nz = (z - mn[2]) / ext[2];
      let u, v;
      if (face === "F") { u = 1 - nz; v = 1 - ny; } else if (face === "B") { u = nz; v = 1 - ny; }
      else if (face === "R") { u = nx; v = 1 - ny; } else if (face === "L") { u = 1 - nx; v = 1 - ny; }
      else if (face === "U") { u = 1 - nz; v = nx; } else { u = 1 - nz; v = 1 - nx; }
      uv[(t + k) * 2] = (c[0] + 0.5 + cl(u) * (c[2] - 1)) / CLOTH_W;                // half a pixel in from the cell edge
      uv[(t + k) * 2 + 1] = 1 - (c[1] + 0.5 + cl(v) * (c[3] - 1)) / CLOTH_H;
    }
  }
  return uv;
}
const CLOTH_NONE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat); CLOTH_NONE.needsUpdate = true;
function clothify(mat, name) {
  mat.userData.clothU = { shirt: { value: CLOTH_NONE }, pants: { value: CLOTH_NONE }, band: { value: name === "Torso" ? 2.5 : 1000 } };  // pants only reach the bottom of the torso
  mat.onBeforeCompile = sh => {
    const U = mat.userData.clothU; sh.uniforms.shirtMap = U.shirt; sh.uniforms.pantsMap = U.pants; sh.uniforms.pantsBand = U.band;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCU; varying float vCY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCU = uv; vCY = position.y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCU; varying float vCY; uniform sampler2D shirtMap; uniform sampler2D pantsMap; uniform float pantsBand;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n{ vec4 pc = texture2D(pantsMap, vCU); diffuseColor.rgb = mix(diffuseColor.rgb, pc.rgb, pc.a * step(vCY, pantsBand));\n  vec4 sc = texture2D(shirtMap, vCU); diffuseColor.rgb = mix(diffuseColor.rgb, sc.rgb, sc.a); }");
  };
  mat.customProgramCacheKey = () => "clothpart";
}
function clothTex(cv) {                                             // one texture per loaded clothing image, shared by every avatar wearing it
  if (!cv) return CLOTH_NONE;
  if (!cv._tex) { cv._tex = new THREE.CanvasTexture(cv); cv._tex.anisotropy = 4; }
  return cv._tex;
}
/* shirt / pants are 512x512 canvases (or null). Shirt covers torso + arms, pants cover legs + the bottom of the torso; shirt sits on top. */
function setAvatarCloth(av, shirt, pants) {
  const st = clothTex(shirt), pt = clothTex(pants);
  for (const name in CLOTH_SET) {
    const pv = av.rig[name]; if (!pv) continue;
    const U = pv.children[0].material.userData.clothU; if (!U) continue;
    U.shirt.value = (name === "Torso" || name.endsWith("Arm")) ? st : CLOTH_NONE;
    U.pants.value = (name === "Torso" || name.endsWith("Leg")) ? pt : CLOTH_NONE;
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
    } else geo.setAttribute("uv", new THREE.BufferAttribute(clothUV(d, CLOTH_SET[name]), 2));
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
    if (name === "Head") faceify(mesh.material); else clothify(mesh.material, name);
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
