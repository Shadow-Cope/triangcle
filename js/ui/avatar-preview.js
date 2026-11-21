"use strict";

const prev = (function () {                                       // live avatar preview (its own little renderer)
  let r;
  try { r = new THREE.WebGLRenderer({ canvas: $("prevCv"), antialias: true, alpha: true }); } catch (_) { return null; }
  if (renderer.outputEncoding !== undefined) r.outputEncoding = renderer.outputEncoding;
  if (renderer.outputColorSpace !== undefined) r.outputColorSpace = renderer.outputColorSpace;
  r.toneMapping = renderer.toneMapping; r.toneMappingExposure = renderer.toneMappingExposure;
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100), av = createAvatar();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(4, 8, 6); sc.add(dl);
  sc.add(av.group); cam.position.set(0, 3, 14); cam.lookAt(0, 2.5, 0);
  return { r, sc, cam, av, sig: "", yaw: 0 };
})();
let prevOn = false, prevRunning = false, prevT = 0, dragX = null;
(function () {
  const pb = $("prevBox"), end = () => { dragX = null; };
  pb.addEventListener("pointerdown", e => { dragX = e.clientX; pb.setPointerCapture(e.pointerId); });
  pb.addEventListener("pointermove", e => { if (dragX !== null && prev) { prev.yaw += (e.clientX - dragX) * 0.012; dragX = e.clientX; } });
  pb.addEventListener("pointerup", end); pb.addEventListener("pointercancel", end);
})();
function prevLoop(now) {
  if (!prevOn || !prev || inGame) { prevRunning = false; return; }
  requestAnimationFrame(prevLoop);
  const dt = Math.min((now - prevT) / 1000, 0.1); prevT = now;
  const cv = prev.r.domElement, w = cv.clientWidth, h = cv.clientHeight, pr = Math.min(window.devicePixelRatio || 1, 2);
  if (w && (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr))) { prev.r.setPixelRatio(pr); prev.r.setSize(w, h, false); prev.cam.aspect = w / h; prev.cam.updateProjectionMatrix(); }
  const sig = colorSig(myColors);
  if (sig !== prev.sig) { prev.sig = sig; setAvatarColors(prev.av, myColors); }
  syncAvatarItems(prev.av, WEAR.mine);
  if (dragX === null) prev.yaw *= Math.exp(-dt * 0.8);
  const t = now / 1000, rg = prev.av.rig, s = Math.sin(t * 1.7);
  prev.av.group.rotation.y = -Math.PI / 2 + prev.yaw + Math.sin(t * 0.7) * 0.35;
  prev.av.group.position.y = s * 0.02;
  rg.LeftArm.rotation.z = s * 0.05; rg.RightArm.rotation.z = -s * 0.05;
  prev.r.render(prev.sc, prev.cam);
}
