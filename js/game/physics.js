"use strict";

/* =====================================================================
   Player physics (fixed 240 Hz step)
   ===================================================================== */
const player = {
  pos: new THREE.Vector3().copy(SPAWN),
  prev: new THREE.Vector3().copy(SPAWN),
  vel: new THREE.Vector3(),
  onGround: false,
  alive: true,
  respawnTimer: 0,
  moveX: 0, moveZ: 0,        // last input direction (world), unit or zero
  ff: CFG.FF_TIME,           // spawn forcefield seconds left
  climb: null, climbReq: null, topExit: null, // ledge-climb state
  stepOff: 0,                // visual-only vertical offset that smooths ledge step-ups
};

function readMoveInput() {
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const rgt = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx =  Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  let mx = fx * fwd + rx * rgt, mz = fz * fwd + rz * rgt;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  return [mx, mz];
}

function approach(v, tx, tz, maxDelta) {
  const dx = tx - v.x, dz = tz - v.z, l = Math.hypot(dx, dz);
  if (l <= maxDelta || l === 0) { v.x = tx; v.z = tz; }
  else { v.x += dx / l * maxDelta; v.z += dz / l * maxDelta; }
}

function overlaps(p, b) {
  const h = CFG.CHAR_HALF_XZ;
  return p.x + h > b.minX && p.x - h < b.maxX &&
         p.z + h > b.minZ && p.z - h < b.maxZ &&
         p.y + CFG.CHAR_HEIGHT > b.minY && p.y < b.maxY;
}

function resolveHorizontal(axis, delta) {
  const p = player.pos, h = CFG.CHAR_HALF_XZ;
  for (const b of solids) {
    if (!overlaps(p, b)) continue;
    const rise = b.maxY - p.y;
    if ((player.onGround || player.vel.y > -10) && rise > 0 && rise <= CFG.STEP_HEIGHT + 1e-4) {
      player.stepOff -= (b.maxY - p.y); // physics snaps up, visuals ease up
      p.y = b.maxY;                    // walk up the ledge
      continue;
    }
    if (!player.onGround && !player.climb && !(player.noGrab > 0) && rise >= 3 && rise <= CFG.AUTOJUMP_MAX && (b.maxY - b.minY) <= CFG.CLIMB_MAX_SIZE && (player.moveX || player.moveZ)) {
      const dir = delta > 0 ? 1 : -1, t = { x: p.x, y: b.maxY, z: p.z };
      if (axis === "x") t.x = dir > 0 ? b.minX + h + 0.2 : b.maxX - h - 0.2; else t.z = dir > 0 ? b.minZ + h + 0.2 : b.maxZ - h - 0.2;
      if (axis === "x" ? (t.z > b.minZ - h * 0.5 && t.z < b.maxZ + h * 0.5) : (t.x > b.minX - h * 0.5 && t.x < b.maxX + h * 0.5)) {
        if (!solids.some(o => overlaps(t, o))) player.climbReq = { t, b, ax: axis === "x" ? dir : 0, az: axis === "z" ? dir : 0 };
      }
    }
    if (axis === "x") {
      if (delta > 0) p.x = b.minX - h; else p.x = b.maxX + h;
      player.vel.x = 0;
    } else {
      if (delta > 0) p.z = b.minZ - h; else p.z = b.maxZ + h;
      player.vel.z = 0;
    }
  }
}

function exitClimb(c, ex, bk) {     // leave a climb at the top; if you then stop moving you get put back on it
  player.climb = null; player.pos.set(ex.x, ex.y, ex.z); player.prev.copy(player.pos);
  player.vel.set(0, 0, 0); player.onGround = true;
  player.topExit = { t: 1, climb: c, bk, x0: ex.x, z0: ex.z };
}

function physicsStep(dt) {
  if (debris.length) stepDebris(dt);
  if (userParts.length) stepUserParts(dt);
  if (!player.alive) {
    player.respawnTimer -= dt;
    if (player.respawnTimer <= 0) respawn();
    return;
  }
  const p = player.pos, v = player.vel;
  player.prev.copy(p);
  if (player.noGrab > 0) player.noGrab -= dt;
  if (player.topExit) {
    const te = player.topExit; te.t -= dt;
    const moving = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.ArrowUp || keys.ArrowDown;
    if (te.t <= 0 || Math.hypot(p.x - te.x0, p.z - te.z0) > 0.6) player.topExit = null;   // you walked off: let go of the climb
    else if (!moving) { te.climb.armed = false; player.climb = te.climb; p.set(te.bk.x, te.bk.y, te.bk.z); v.set(0, 0, 0); player.topExit = null; }
  }
  if (!player.climb && !(player.noGrab > 0) && (keys.KeyW || keys.ArrowUp)) {          // walk into a ladder holding W
    for (const L of LADDERS) if (p.x >= L.x0 && p.x <= L.x1 && p.z >= L.z0 && p.z <= L.z1 && p.y >= L.y0 - 0.5 && p.y <= L.y1 - 1) {
      player.climb = { mode: "ladder", L, t: 0, dur: 1, armed: false, face: Math.atan2(L.nz, -L.nx) }; p.z = L.snapZ; v.set(0, 0, 0); break;
    }
  }
  if (player.climb && player.climb.mode === "over") {   // smooth pull-over onto the top (no teleport)
    const c = player.climb; c.t += dt;
    const u = Math.min(1, c.t / c.dur), e = x => x * x * (3 - 2 * x);
    const yu = e(Math.min(1, u / 0.5)), xu = e(Math.max(0, (u - 0.35) / 0.65));
    p.y = c.from.y + (c.to.y - c.from.y) * yu;
    p.x = c.from.x + (c.to.x - c.from.x) * xu; p.z = c.from.z + (c.to.z - c.from.z) * xu;
    v.set(0, 0, 0);
    if (u >= 1) { p.set(c.to.x, c.to.y, c.to.z); player.climb = null; player.onGround = true; }
    return;
  }
  if (player.climb && player.climb.mode === "ladder") {   // truss-style ladder: W/S up/down, Space hops off backwards
    const c = player.climb, L = c.L, up = keys.KeyW || keys.ArrowUp, dn = keys.KeyS || keys.ArrowDown;
    v.set(0, 0, 0);
    if (!keys.Space) c.armed = true;
    if (c.armed && keys.Space) { player.climb = null; player.noGrab = 0.3; v.set(L.nx * 10, CFG.JUMP_POWER, L.nz * 10); return; }
    p.y += ((up ? 1 : 0) - (dn ? 1 : 0)) * 12 * dt;
    if (p.y <= L.y0) { p.y = L.y0; if (dn) { player.climb = null; player.noGrab = 0.3; player.onGround = true; return; } }
    if (p.y >= L.y1 - 0.5) { exitClimb(c, { x: p.x - L.nx, y: L.y1, z: p.z - L.nz }, { x: p.x, y: L.y1 - 1, z: p.z }); return; }   // top: step out, no shove forward
    return;
  }
  if (player.climb && player.climb.mode === "hang") {   // hanging off the ledge, Roblox-style
    const c = player.climb, fw = keys.KeyW || keys.ArrowUp, down = keys.KeyS || keys.ArrowDown;
    v.set(0, 0, 0);
    if (down) { player.climb = null; player.noGrab = 0.5; return; }                 // let go
    if (!keys.Space) c.armed = true;
    if (c.armed && keys.Space) {                                                    // Space = jump off, like off the floor
      player.climb = null; player.noGrab = 0.3; v.set(-c.ax * 10, CFG.JUMP_POWER, -c.az * 10); return;   // hops back off the wall a bit
    }
    if (fw) p.y += 12 * dt;                                                      // smooth climb
    const rgt = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);                          // A/D shimmy along the ledge
    const tx = c.az !== 0 ? 1 : 0, tz = c.ax !== 0 ? 1 : 0;
    const sh = rgt ? Math.cos(cam.yaw) * rgt * tx - Math.sin(cam.yaw) * rgt * tz : 0;
    if (Math.abs(sh) > 0.1) {
      const st = sh * 4 * dt;
      if (tx) { p.x = Math.max(c.b.minX, Math.min(c.b.maxX, p.x + st)); c.to.x = p.x; }
      else    { p.z = Math.max(c.b.minZ, Math.min(c.b.maxZ, p.z + st)); c.to.z = p.z; }
    }
    if (p.y >= c.b.maxY - 1.0) { exitClimb(c, { x: p.x + c.ax * 0.4, y: c.b.maxY, z: p.z + c.az * 0.4 }, { x: p.x, y: c.b.maxY - 1.2, z: p.z }); return; }   // top: just onto the edge
    return;
  }
  if (player.climb) {                               // mantling a ledge: haul up, then swing over
    const c = player.climb; c.t += dt;
    const u = Math.min(1, c.t / c.dur), K = 0.65, e = x => x * x * (3 - 2 * x);
    if (u < K) p.y = c.from.y + (c.to.y - c.from.y) * e(u / K);
    else { const w = e((u - K) / (1 - K)); p.y = c.to.y; p.x = c.from.x + (c.to.x - c.from.x) * w; p.z = c.from.z + (c.to.z - c.from.z) * w; }
    v.set(0, 0, 0);
    if (u >= 1) { p.set(c.to.x, c.to.y, c.to.z); player.climb = null; player.onGround = true; }
    return;
  }

  // --- horizontal control ---
  const [mx, mz] = readMoveInput();
  const hasInput = (mx !== 0 || mz !== 0);
  player.moveX = hasInput ? mx : 0;
  player.moveZ = hasInput ? mz : 0;
  const tx = mx * CFG.WALK_SPEED, tz = mz * CFG.WALK_SPEED;
  if (player.onGround) approach(v, tx, tz, CFG.GROUND_ACCEL * dt);
  else if (hasInput)   approach(v, tx, tz, CFG.AIR_ACCEL * dt);
  else                 approach(v, 0, 0, CFG.AIR_STOP * dt);   // no sliding in the air

  // --- jump (holding space keeps jumping on landing, like Roblox) ---
  if (player.onGround && keys.Space) {
    v.y = CFG.JUMP_POWER;
    player.onGround = false;
  }

  // --- gravity ---
  v.y -= CFG.GRAVITY * dt;

  // --- integrate + collide, axis by axis ---
  p.x += v.x * dt; resolveHorizontal("x", v.x);
  p.z += v.z * dt; resolveHorizontal("z", v.z);

  p.y += v.y * dt;
  let landed = false;
  for (const b of solids) {
    if (!overlaps(p, b)) continue;
    if (v.y <= 0) { p.y = b.maxY; landed = true; }
    else          { p.y = b.minY - CFG.CHAR_HEIGHT; }
    v.y = 0;
  }
  player.onGround = landed;
  if (player.climbReq) {
    const q = player.climbReq; player.climbReq = null;
    player.climb = { t: 0, dur: 0.6, from: p.clone(), to: new THREE.Vector3(q.t.x, q.t.y, q.t.z), face: Math.atan2(-q.az, q.ax), mode: "hang", armed: false, b: q.b, ax: q.ax, az: q.az };
    v.set(0, 0, 0);
  }

  // --- fell off the world ---
  if (p.y < CFG.FALL_DESTROY_Y) {
    player.alive = false;
    player.respawnTimer = CFG.RESPAWN_TIME;
    v.set(0, 0, 0);
  }
}

function respawn() {
  player.pos.copy(SPAWN);
  player.prev.copy(SPAWN);
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.climb = null; player.climbReq = null; player.topExit = null;
  player.alive = true;
  player.ff = CFG.FF_TIME;
  player.stepOff = 0;
  clearDebris("me");
  facing = Math.PI / 2;   // face -Z like Roblox spawns
}
