"use strict";

/* =====================================================================
   Main loop
   ===================================================================== */
const hud = document.getElementById("hud");
const msg = document.getElementById("msg");
const FIXED = 1 / CFG.PHYSICS_HZ;
let last = performance.now(), acc = 0, hudTimer = 0, fps = 60;
const deadFocus = new THREE.Vector3(), tmp = new THREE.Vector3(), focus = new THREE.Vector3(), desired = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  if (!inGame) { last = now; return; }
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;

  // camera keys (arrow left/right rotate, I/O zoom)
  if (keys.ArrowLeft)  cam.yaw += CFG.CAM_ARROW_SPEED * dt;
  if (keys.ArrowRight) cam.yaw -= CFG.CAM_ARROW_SPEED * dt;
  if (keys.KeyI) cam.zoomTarget = Math.max(CFG.CAM_ZOOM_MIN, cam.zoomTarget - 12 * dt);
  if (keys.KeyO) cam.zoomTarget = Math.min(CFG.CAM_ZOOM_MAX, cam.zoomTarget + 12 * dt);

  acc += dt;
  while (acc >= FIXED) { physicsStep(FIXED); acc -= FIXED; }
  const alpha = acc / FIXED;

  animate(dt);

  // interpolated render position
  tmp.lerpVectors(player.prev, player.pos, alpha);
  player.stepOff *= Math.exp(-dt * CFG.STEP_SMOOTH);
  tmp.y += player.stepOff;
  charGroup.position.copy(tmp);
  charGroup.rotation.y = facing + CFG.MODEL_FRONT_OFFSET;
  charGroup.position.y += bodyY; charGroup.rotation.z = -lean; charGroup.rotation.x = roll;

  // camera
  cam.zoom += (cam.zoomTarget - cam.zoom) * (1 - Math.exp(-dt * 20));
  cam.shift += (((shiftLock && !firstPerson && player.alive) ? 1 : 0) - cam.shift) * (1 - Math.exp(-dt * 15));
  const shiftOff = CFG.SHIFTLOCK_OFFSET * cam.shift;
  if (player.alive) deadFocus.set(tmp.x, tmp.y + CFG.CAM_FOCUS_Y, tmp.z);
  else {                                        // dead: camera follows the loose head
    const hd = debris.find(d => d.owner === "me" && d.name === "Head");
    if (hd) deadFocus.copy(hd.g.position);
  }
  focus.set(deadFocus.x + Math.cos(cam.yaw) * shiftOff, deadFocus.y, deadFocus.z - Math.sin(cam.yaw) * shiftOff);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  desired.set(
    focus.x + cam.zoom * Math.sin(cam.yaw) * cp,
    focus.y + cam.zoom * sp,
    focus.z + cam.zoom * Math.cos(cam.yaw) * cp
  );
  // keep the camera above the baseplate (simple stand-in for Roblox's Popper)
  const MIN_Y = 0.25;
  if (desired.y < MIN_Y && focus.y > MIN_Y &&
      Math.abs(desired.x) < BASEPLATE_HALF && Math.abs(desired.z) < BASEPLATE_HALF) {
    const s = (focus.y - MIN_Y) / (focus.y - desired.y);
    desired.sub(focus).multiplyScalar(s).add(focus);
  }
  camera.position.copy(desired);
  camera.lookAt(focus);

  firstPerson = cam.zoom < 0.6;
  charGroup.visible = player.alive;
  rig.Head.visible = !firstPerson;               // first person: see your body, not the inside of your head
  crossEl.style.display = ((shiftLock || firstPerson) && player.alive && !uiOpen() && hasLock()) ? "block" : "none";
  canvas.style.cursor = (shiftLock && !uiOpen()) ? "none" : "";
  if (!wantLock() && !rmbDown && hasLock()) document.exitPointerLock();
  lockTry += dt; if (lockTry > 0.4) { lockTry = 0; ensureLock(); }
  if (player.ff > 0) player.ff -= dt;
  FF_MAT.opacity = 0.32 + 0.14 * Math.sin(now / 90);
  setFF(localAvatar, player.alive && player.ff > 0 && (player.ff > 0.6 || Math.floor(player.ff * 12) % 2 === 0));

  updateRemotes(dt);
  if (selPart) selBox.setFromObject(selPart.mesh);
  updateGizmo();
  camera.updateMatrixWorld();
  updateTags();

  NET.timer += dt;
  if (NET.timer >= NET.interval) {
    NET.timer = 0;
    const r2 = v => Math.round(v * 100) / 100;
    const msg = { t: "s", x: r2(charGroup.position.x), y: r2(charGroup.position.y - bodyY), z: r2(charGroup.position.z),
      f: r2(facing), a: [r2(ang.LeftArm), r2(ang.RightArm), r2(ang.LeftLeg), r2(ang.RightLeg)], al: player.alive ? 1 : 0, ff: player.ff > 0 ? 1 : 0, l: r2(lean), r: r2(roll), b: r2(bodyY) };
    const sig = JSON.stringify([msg.x, msg.y, msg.z, msg.f, msg.a, msg.al, msg.ff, msg.l, msg.r]);
    NET.idle += NET.interval;
    if (sig !== NET.lastSig || NET.idle >= 1) {      // idle players only send a 1 s heartbeat
      NET.lastSig = sig; NET.idle = 0;
      netSend(msg);
    }
  }

  updateHitboxes(); flushParts(dt);

  // sun + shadow follow the player
  sun.position.set(tmp.x + SUN_DIR.x * 80, tmp.y + SUN_DIR.y * 80, tmp.z + SUN_DIR.z * 80);
  sun.target.position.copy(tmp);
  sky.position.copy(camera.position);

  if (GFX[gfxLevel].bloom && ensureComposer()) composer.render(dt); else renderer.render(scene, camera);

  // HUD
  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    const sp2 = Math.hypot(player.vel.x, player.vel.z);
    hud.textContent = gmStatsEl.textContent =
      "state  " + (player.alive ? animState : "Dead") + "\n" +
      "speed  " + sp2.toFixed(2) + " studs/s   vy " + player.vel.y.toFixed(1) + "\n" +
      "pos    " + player.pos.x.toFixed(1) + ", " + player.pos.y.toFixed(1) + ", " + player.pos.z.toFixed(1) + "\n" +
      "fps    " + Math.round(fps) + "  (physics " + CFG.PHYSICS_HZ + " Hz)\n" +
      "net    " + NET.status + (NET.err ? " [" + NET.err + "]" : "") + "  (" + players.size + " player" + (players.size === 1 ? "" : "s") + ")";
    msg.style.display = "none";
  }
}
