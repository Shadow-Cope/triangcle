"use strict";

/* =====================================================================
   Animation (R6-style walk / fall poses)
   ===================================================================== */
let facing = Math.PI / 2;          // model yaw (model forward is +X)
let walkPhase = 0;
const ang = { LeftArm: 0, RightArm: 0, LeftLeg: 0, RightLeg: 0 };

function wrapPi(a) { if (window.TriancleRust && window.TriancleRust.wrapAngle && Number.isFinite(a) && Math.abs(a) <= 100) return window.TriancleRust.wrapAngle(a); while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function animationBlend(dt, rate) { return window.TriancleRust && window.TriancleRust.animationBlend ? window.TriancleRust.animationBlend(dt, rate) : 1 - Math.exp(-dt * rate); }

let air = 0, maxFall = 0, landT = 0, landAmt = 0, climbPh = 0, tAnim = 0, bodyY = 0, lean = 0, roll = 0, animState = "Idle";
function animate(dt) {
  if (window.TriancleRust && window.TriancleRust.animate) {
    const c = player.climb, mode = !c ? 0 : c.mode === "ladder" ? 1 : c.mode === "hang" ? 2 : 3;
    const state = window.TriancleRust.animate([dt, facing, walkPhase, air, maxFall, landT, landAmt, tAnim, bodyY, lean, roll,
      ang.LeftArm, ang.RightArm, ang.LeftLeg, ang.RightLeg, player.alive ? 1 : 0, player.onGround ? 1 : 0, mode,
      c ? c.face : 0, c ? c.t : 0, c ? c.dur : 1, shiftLock || firstPerson ? 1 : 0, cam.yaw, player.moveX, player.moveZ,
      player.vel.x, player.vel.y, player.vel.z, CFG.WALK_SPEED, CFG.TURN_SMOOTH, CFG.SHIFTLOCK_TURN,
      keys.KeyW || keys.KeyS || keys.ArrowUp || keys.ArrowDown ? 1 : 0, 0]);
    if (state) {
      [facing, walkPhase, air, maxFall, landT, landAmt, tAnim, bodyY, lean, roll] = state.slice(1, 11);
      [ang.LeftArm, ang.RightArm, ang.LeftLeg, ang.RightLeg] = state.slice(11, 15);
      animState = ["Idle", "Running", "Jumping", "Freefall", "Climbing"][state[32]];
      for (const n in ang) if (rig[n]) rig[n].rotation.z = ang[n];
      return;
    }
  }
  tAnim += dt;
  if (player.alive) {                                                      // turn toward movement / camera / wall
    let target = null, k = CFG.TURN_SMOOTH;
    if (player.climb) { target = player.climb.face; k = 25; }
    else if (shiftLock || firstPerson) { target = Math.atan2(Math.cos(cam.yaw), -Math.sin(cam.yaw)); k = CFG.SHIFTLOCK_TURN; }
    else if (player.moveX !== 0 || player.moveZ !== 0) target = Math.atan2(-player.moveZ, player.moveX);
    if (target !== null) facing = wrapPi(facing + wrapPi(target - facing) * animationBlend(dt, k));
  }
  const c = player.climb, speed = Math.hypot(player.vel.x, player.vel.z), sr = Math.min(1.2, speed / CFG.WALK_SPEED), vy = player.vel.y;
  if (player.onGround || c) {
    if (air > 0.3 && !c && player.alive) { landT = 0.24; landAmt = Math.min(1, maxFall / 70); }   // only real drops squash on landing
    air = 0; maxFall = 0;
  } else { air += dt; maxFall = Math.max(maxFall, -vy); }
  if (landT > 0) landT -= dt;
  let aL = 0, aR = 0, lL = 0, lR = 0, tb = 0, tl = 0, tr = 0;
  if (c) {
    animState = "Climbing";
    const u = c.t / c.dur; walkPhase += dt * 16; const s = Math.sin(walkPhase);
    if (c.mode === "ladder") {
      const mv = (keys.KeyW || keys.KeyS || keys.ArrowUp || keys.ArrowDown) ? 1 : 0;
      aL = Math.PI * 0.85 + s * 0.3 * mv; aR = Math.PI * 0.85 - s * 0.3 * mv; lL = s * 0.6 * mv; lR = -s * 0.6 * mv;
    } else if (c.mode === "hang") { aL = aR = Math.PI * 0.95; lL = 0.2; lR = -0.2; }
    else if (u < 0.65) { aL = Math.PI * 0.85 + s * 0.3; aR = Math.PI * 0.85 - s * 0.3; lL = s * 0.7; lR = -s * 0.7; }
    else { aL = aR = Math.PI * 0.4; lL = 0.5; lR = -0.2; }
  } else if (air > 0.22 && vy < 0) {           // real fall only (a 1-stud step down never gets here)
    animState = "Freefall"; aL = aR = Math.PI * 0.82 + Math.sin(tAnim * 14) * 0.1; lL = 0.35; lR = -0.25; tl = -0.05;
  } else if (!player.onGround && vy > 1) {
    animState = "Jumping"; aL = aR = Math.PI * 0.72; lL = 0.45; lR = -0.2; tl = -0.04;
  } else if (speed > 0.5) {
    animState = "Running";
    walkPhase += dt * (2 * Math.PI / 0.7) * (speed / 14.5);
    const s = Math.sin(walkPhase), a = 0.35 + 0.7 * sr;
    aR = s * a; lL = s * a; aL = -s * a * 0.95; lR = -s * a;
    tb = (Math.abs(Math.cos(walkPhase)) - 0.5) * 0.14 * sr; tl = 0.1 * sr; tr = s * 0.035 * sr;
  } else {
    animState = "Idle";
    const s = Math.sin(tAnim * 1.7); aL = s * 0.045; aR = -Math.sin(tAnim * 1.7 + 0.6) * 0.045; tb = s * 0.02;
  }
  if (landT > 0 && !c) { const kk = Math.sin((1 - landT / 0.24) * Math.PI) * landAmt; tb -= 0.45 * kk; tl += 0.12 * kk; aL += 0.5 * kk; aR += 0.5 * kk; }
  const k = animationBlend(dt, 22);
  ang.LeftArm += (aL - ang.LeftArm) * k; ang.RightArm += (aR - ang.RightArm) * k;
  ang.LeftLeg += (lL - ang.LeftLeg) * k; ang.RightLeg += (lR - ang.RightLeg) * k;
  bodyY += (tb - bodyY) * animationBlend(dt, 16); lean += (tl - lean) * animationBlend(dt, 10); roll += (tr - roll) * animationBlend(dt, 10);
  for (const n in ang) if (rig[n]) rig[n].rotation.z = ang[n];
}
