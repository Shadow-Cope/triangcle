"use strict";

/* =====================================================================
   Character visuals (from the FBX data)
   ===================================================================== */
const GEO_CACHE = {};
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
    }
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
    if (name === "Head") faceify(mesh.material);
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
