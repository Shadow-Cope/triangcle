"use strict";

/* =====================================================================
   Renderer / scene
   ===================================================================== */
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.CAM_FOV, 1, 0.1, 3000);

let composer = null, cPR = 1, bloomPass = null, gfxLevel = 4;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(w * cPR, h * cPR);
}
window.addEventListener("resize", resize);
resize();

/* ---- lighting ---- */
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x77777f, 0.75));
const sun = new THREE.DirectionalLight(0xfff3dd, 0.7);
const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 160;
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

/* ---- graphics levels 1-5 ---- */
const GFX = {
  1: { res: 0,    pr: 0.6, range: 30, bloom: false },   // no shadows, low res
  2: { res: 512,  pr: 1,   range: 30, bloom: false },
  3: { res: 1024, pr: 1.5, range: 30, bloom: false },
  4: { res: 2048, pr: 2,   range: 40, bloom: false },
  5: { res: 4096, pr: 3,   range: 70, bloom: true },    // big sharp shadows + bloom
};
function ensureComposer() {
  if (composer) return composer;
  if (!THREE.EffectComposer || !THREE.UnrealBloomPass || !THREE.RenderPass) return null;
  const w = window.innerWidth, h = window.innerHeight, pr = renderer.getPixelRatio();
  let rt = null;
  try { rt = new THREE.WebGLMultisampleRenderTarget(w * pr, h * pr, { format: THREE.RGBAFormat }); } catch (_) {}
  composer = new THREE.EffectComposer(renderer, rt || undefined);
  cPR = rt ? 1 : pr;
  composer.addPass(new THREE.RenderPass(scene, camera));
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.8, 0.8);
  composer.addPass(bloomPass);
  composer.setSize(w * (rt ? pr : 1), h * (rt ? pr : 1));
  if (rt) cPR = pr;
  return composer;
}
function setGraphics(n) {
  gfxLevel = n; const g = GFX[n];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, g.pr));
  sun.castShadow = g.res > 0;
  if (g.res) {
    sun.shadow.mapSize.set(g.res, g.res);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.type = n === 2 ? THREE.BasicShadowMap : n === 3 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    sc.left = sc.bottom = -g.range; sc.right = sc.top = g.range; sc.far = 160 + g.range * 2;
    sc.updateProjectionMatrix();
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  }
  if (composer) { composer.dispose && composer.dispose(); composer = null; }
  resize();
  document.querySelectorAll("#gfx button").forEach(b => b.classList.toggle("on", +b.dataset.l === n));
  try { localStorage.setItem("gfxLevel", String(n)); } catch (_) {}
}
document.querySelectorAll("#gfx button").forEach(b => b.addEventListener("click", () => setGraphics(+b.dataset.l)));
let _gl = 4; try { _gl = +localStorage.getItem("gfxLevel") || 4; } catch (_) {}

/* ---- sky dome ---- */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: [
      "varying vec3 vDir; uniform vec3 sunDir;",
      "void main(){",
      "  vec3 d = normalize(vDir);",
      "  float h = max(d.y, 0.0);",
      "  vec3 hor = vec3(0.78, 0.88, 0.98);",
      "  vec3 zen = vec3(0.27, 0.50, 0.90);",
      "  vec3 c = mix(hor, zen, pow(h, 0.55));",
      "  float s = pow(max(dot(d, sunDir), 0.0), 700.0);",
      "  c += vec3(1.0, 0.95, 0.8) * s * 1.5;",
      "  gl_FragColor = vec4(c, 1.0);",
      "}"
    ].join("\n"),
  })
);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);
