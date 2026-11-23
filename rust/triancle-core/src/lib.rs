//! Shared game calculations, ported from the existing JavaScript implementation.
//!
//! The browser bridge uses these calculations when explicitly enabled.

mod account;
mod avatar;
mod catalog;
mod debris;
mod game_settings;
mod rbxl_index;
mod rbxl_map;
mod social;
mod ugc;

/// Move a horizontal velocity toward a target by at most `max_delta`.
///
/// Mirrors `approach` in `js/game/physics.js`. The game passes a non-negative
/// acceleration multiplied by the fixed time step as `max_delta`.
pub fn approach(x: f64, z: f64, target_x: f64, target_z: f64, max_delta: f64) -> (f64, f64) {
    let dx = target_x - x;
    let dz = target_z - z;
    let length = dx.hypot(dz);
    if length <= max_delta || length == 0.0 {
        (target_x, target_z)
    } else {
        (x + dx / length * max_delta, z + dz / length * max_delta)
    }
}

// Scalar exports keep the browser bridge independent of a binding generator.
// Both components must be computed from the same original velocity.
#[no_mangle]
pub extern "C" fn triancle_approach_x(x: f64, z: f64, tx: f64, tz: f64, delta: f64) -> f64 {
    approach(x, z, tx, tz, delta).0
}

#[no_mangle]
pub extern "C" fn triancle_approach_z(x: f64, z: f64, tx: f64, tz: f64, delta: f64) -> f64 {
    approach(x, z, tx, tz, delta).1
}

/// Convert forward and right input into a normalized world-space direction.
/// Mirrors `readMoveInput` in the live game bundle.
pub fn move_direction(yaw: f64, forward: f64, right: f64) -> (f64, f64) {
    let mut x = -yaw.sin() * forward + yaw.cos() * right;
    let mut z = -yaw.cos() * forward - yaw.sin() * right;
    let length = x.hypot(z);
    if length > 1.0 {
        x /= length;
        z /= length;
    }
    (x, z)
}

#[no_mangle]
pub extern "C" fn triancle_move_x(yaw: f64, forward: f64, right: f64) -> f64 {
    move_direction(yaw, forward, right).0
}

#[no_mangle]
pub extern "C" fn triancle_move_z(yaw: f64, forward: f64, right: f64) -> f64 {
    move_direction(yaw, forward, right).1
}

/// Strict AABB intersection: merely touching a surface is not an overlap.
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn triancle_box_overlap(
    x: f64,
    y: f64,
    z: f64,
    half: f64,
    height: f64,
    min_x: f64,
    min_y: f64,
    min_z: f64,
    max_x: f64,
    max_y: f64,
    max_z: f64,
) -> i32 {
    (x + half > min_x
        && x - half < max_x
        && z + half > min_z
        && z - half < max_z
        && y + height > min_y
        && y < max_y) as i32
}

#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn triancle_sphere_overlap(
    x: f64,
    y: f64,
    z: f64,
    half: f64,
    height: f64,
    cx: f64,
    cy: f64,
    cz: f64,
    radius: f64,
) -> i32 {
    // JavaScript's `nearest` uses comparisons, including for unusual inputs.
    fn nearest(v: f64, lo: f64, hi: f64) -> f64 {
        if v < lo {
            lo
        } else if v > hi {
            hi
        } else {
            v
        }
    }
    let dx = nearest(cx, x - half, x + half) - cx;
    let dy = nearest(cy, y, y + height) - cy;
    let dz = nearest(cz, z - half, z + half) - cz;
    (dx * dx + dy * dy + dz * dz < radius * radius) as i32
}

/// Resolve a box collision along one horizontal axis, matching the live bundle.
#[no_mangle]
pub extern "C" fn triancle_box_side(cur: f64, delta: f64, min: f64, max: f64, half: f64) -> f64 {
    if delta > 0.0 {
        min - half
    } else if delta < 0.0 {
        max + half
    } else if cur - (min + max) / 2.0 < 0.0 {
        min - half
    } else {
        max + half
    }
}

/// Resolve one horizontal axis against a sphere using the closest point on the player box.
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn triancle_sphere_side(
    cur: f64,
    other: f64,
    y: f64,
    half: f64,
    height: f64,
    center: f64,
    other_center: f64,
    cy: f64,
    radius: f64,
    delta: f64,
) -> f64 {
    fn nearest(v: f64, lo: f64, hi: f64) -> f64 {
        if v < lo {
            lo
        } else if v > hi {
            hi
        } else {
            v
        }
    }
    let dy = nearest(cy, y, y + height) - cy;
    let other_offset = nearest(other_center, other - half, other + half) - other_center;
    let rr = (radius * radius - dy * dy - other_offset * other_offset)
        .max(0.0)
        .sqrt();
    if delta > 0.0 || (delta == 0.0 && cur < center) {
        center - rr - half
    } else {
        center + rr + half
    }
}

/// Resolve the feet position after a vertical collision with a sphere.
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn triancle_sphere_vertical(
    x: f64,
    z: f64,
    half: f64,
    height: f64,
    cx: f64,
    cy: f64,
    cz: f64,
    radius: f64,
    velocity_y: f64,
) -> f64 {
    fn nearest(v: f64, lo: f64, hi: f64) -> f64 {
        if v < lo {
            lo
        } else if v > hi {
            hi
        } else {
            v
        }
    }
    let dx = nearest(cx, x - half, x + half) - cx;
    let dz = nearest(cz, z - half, z + half) - cz;
    let ry = (radius * radius - dx * dx - dz * dz).max(0.0).sqrt();
    if velocity_y <= 0.0 {
        cy + ry
    } else {
        cy - ry - height
    }
}

#[no_mangle]
pub extern "C" fn triancle_box_vertical(
    min_y: f64,
    max_y: f64,
    height: f64,
    velocity_y: f64,
) -> f64 {
    if velocity_y <= 0.0 {
        max_y
    } else {
        min_y - height
    }
}

/// Validate the six ASCII digits of a player colour (without its leading '#').
#[no_mangle]
pub extern "C" fn triancle_valid_hex6(a: u32, b: u32, c: u32, d: u32, e: u32, f: u32) -> i32 {
    [a, b, c, d, e, f]
        .iter()
        .all(|ch| (48..=57).contains(ch) || (65..=70).contains(ch) || (97..=102).contains(ch))
        as i32
}

/// Smooth interpolation used by the climbing animations.
#[no_mangle]
pub extern "C" fn triancle_climb_ease(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

#[no_mangle]
pub extern "C" fn triancle_climb_delta(up: i32, down: i32, dt: f64) -> f64 {
    ((up != 0) as i32 - (down != 0) as i32) as f64 * 12.0 * dt
}

#[no_mangle]
pub extern "C" fn triancle_climb_shimmy(yaw: f64, right: f64, tx: f64, tz: f64) -> f64 {
    if right == 0.0 {
        0.0
    } else {
        yaw.cos() * right * tx - yaw.sin() * right * tz
    }
}

/// Pack the colour editor's HSV conversion as 0xRRGGBB.
/// Inputs are the editor's normal finite ranges: hue 0..=360, saturation and value 0..=1.
#[no_mangle]
pub extern "C" fn triancle_hsv_to_rgb(h: f64, s: f64, v: f64) -> u32 {
    fn channel(n: f64, h: f64, s: f64, v: f64) -> u32 {
        let k = (n + h / 60.0) % 6.0;
        let component = v - v * s * k.min(4.0 - k).min(1.0).max(0.0);
        (component * 255.0 + 0.5).floor() as u32
    }
    (channel(5.0, h, s, v) << 16) | (channel(3.0, h, s, v) << 8) | channel(1.0, h, s, v)
}

/// Convert an RGB colour to the avatar editor's HSV representation.
pub fn rgb_to_hsv(red: u32, green: u32, blue: u32) -> (f64, f64, f64) {
    let r = red as f64 / 255.0;
    let g = green as f64 / 255.0;
    let b = blue as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let mut h = 0.0;
    if d != 0.0 {
        h = if max == r {
            ((g - b) / d + 6.0) % 6.0
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
    }
    (h * 60.0, if max != 0.0 { d / max } else { 0.0 }, max)
}

#[no_mangle]
pub extern "C" fn triancle_rgb_h(r: u32, g: u32, b: u32) -> f64 {
    rgb_to_hsv(r, g, b).0
}
#[no_mangle]
pub extern "C" fn triancle_rgb_s(r: u32, g: u32, b: u32) -> f64 {
    rgb_to_hsv(r, g, b).1
}
#[no_mangle]
pub extern "C" fn triancle_rgb_v(r: u32, g: u32, b: u32) -> f64 {
    rgb_to_hsv(r, g, b).2
}

/// Generate the vertical collision columns for a tilted map part.
/// Each column is six little-endian f64 values: min/max X, Y and Z.
#[allow(clippy::too_many_arguments)]
pub fn tilted_columns(
    sizes: [f64; 3],
    pos: [f64; 3],
    rot: [f64; 9],
    output: &mut [u8],
) -> Option<usize> {
    let [sx, sy, sz] = sizes;
    let [x, y, z] = pos;
    let ex = rot[0].abs() * sx + rot[1].abs() * sy + rot[2].abs() * sz;
    let ez = rot[6].abs() * sx + rot[7].abs() * sy + rot[8].abs() * sz;
    let cell = (ex * ez / 400.0).sqrt().max(0.6);
    let h = [sx / 2.0, sy / 2.0, sz / 2.0];
    if !cell.is_finite() || cell <= 0.0 || !ex.is_finite() || !ez.is_finite() {
        return None;
    }
    let mut count = 0usize;
    let mut cx = x - ex / 2.0 + cell / 2.0;
    while cx < x + ex / 2.0 {
        let mut cz = z - ez / 2.0 + cell / 2.0;
        while cz < z + ez / 2.0 {
            let (mut lo, mut hi, mut ok) = (f64::NEG_INFINITY, f64::INFINITY, true);
            for i in 0..3 {
                if !ok {
                    break;
                }
                let a0 = rot[i] * (cx - x) - rot[3 + i] * y + rot[6 + i] * (cz - z);
                let bb = rot[3 + i];
                if bb.abs() < 1e-6 {
                    if a0.abs() > h[i] {
                        ok = false;
                    }
                    continue;
                }
                let mut t0 = (-h[i] - a0) / bb;
                let mut t1 = (h[i] - a0) / bb;
                if t0 > t1 {
                    std::mem::swap(&mut t0, &mut t1);
                }
                lo = lo.max(t0);
                hi = hi.min(t1);
            }
            if ok && hi - lo > 0.02 {
                let values = [
                    cx - cell / 2.0,
                    cx + cell / 2.0,
                    lo,
                    hi,
                    cz - cell / 2.0,
                    cz + cell / 2.0,
                ];
                let start = count.checked_mul(48)?;
                if start.checked_add(48)? > output.len() {
                    return None;
                }
                for (i, value) in values.iter().enumerate() {
                    output[start + i * 8..start + (i + 1) * 8]
                        .copy_from_slice(&value.to_le_bytes());
                }
                count += 1;
            }
            let next = cz + cell;
            if next <= cz {
                return None;
            }
            cz = next;
        }
        let next = cx + cell;
        if next <= cx {
            return None;
        }
        cx = next;
    }
    Some(count)
}

/// # Safety
/// `output` must reference a live allocation of `capacity * 48` bytes.
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub unsafe extern "C" fn triancle_tilted_columns(
    sx: f64,
    sy: f64,
    sz: f64,
    x: f64,
    y: f64,
    z: f64,
    r0: f64,
    r1: f64,
    r2: f64,
    r3: f64,
    r4: f64,
    r5: f64,
    r6: f64,
    r7: f64,
    r8: f64,
    output: *mut u8,
    capacity: usize,
) -> i32 {
    let Some(len) = capacity.checked_mul(48) else {
        return -1;
    };
    let dst = std::slice::from_raw_parts_mut(output, len);
    tilted_columns(
        [sx, sy, sz],
        [x, y, z],
        [r0, r1, r2, r3, r4, r5, r6, r7, r8],
        dst,
    )
    .and_then(|n| i32::try_from(n).ok())
    .unwrap_or(-1)
}

/// Select the fallback spawn position from imported map parts.
/// Each input row is 15 little-endian f64 values: size, position, then rotation.
pub fn default_spawn(input: &[u8]) -> Option<[f64; 3]> {
    if input.is_empty() || input.len() % 120 != 0 {
        return None;
    }
    let mut best: Option<f64> = None;
    let mut largest: Option<([f64; 15], f64)> = None;
    for chunk in input.chunks_exact(120) {
        let mut r = [0.0; 15];
        for (i, part) in chunk.chunks_exact(8).enumerate() {
            r[i] = f64::from_le_bytes(part.try_into().ok()?);
            if !r[i].is_finite() {
                return None;
            }
        }
        let ex = r[6].abs() * r[0] + r[7].abs() * r[1] + r[8].abs() * r[2];
        let ey = r[9].abs() * r[0] + r[10].abs() * r[1] + r[11].abs() * r[2];
        let ez = r[12].abs() * r[0] + r[13].abs() * r[1] + r[14].abs() * r[2];
        if r[3].abs() <= ex / 2.0 && r[5].abs() <= ez / 2.0 {
            let top = r[4] + ey / 2.0;
            if best.is_none() || best == Some(0.0) || top > best.unwrap() {
                best = Some(top);
            }
        }
        let area = r[0] * r[2];
        if largest
            .as_ref()
            .is_none_or(|(_, previous)| area > *previous)
        {
            largest = Some((r, area));
        }
    }
    if let Some(top) = best {
        Some([0.0, top + 3.0, 0.0])
    } else {
        let r = largest?.0;
        Some([r[3], r[4] + r[1] / 2.0 + 3.0, r[5]])
    }
}

/// # Safety
/// `input` must be `count * 120` bytes and `output` must be 24 bytes; buffers must not overlap.
#[no_mangle]
pub unsafe extern "C" fn triancle_default_spawn(
    input: *const u8,
    count: usize,
    output: *mut u8,
) -> i32 {
    let Some(len) = count.checked_mul(120) else {
        return 0;
    };
    let rows = std::slice::from_raw_parts(input, len);
    let Some(spawn) = default_spawn(rows) else {
        return 0;
    };
    let dst = std::slice::from_raw_parts_mut(output, 24);
    for (i, value) in spawn.iter().enumerate() {
        dst[i * 8..i * 8 + 8].copy_from_slice(&value.to_le_bytes());
    }
    1
}

/// Decode one raw LZ4 block, rejecting truncated input and invalid offsets.
pub fn decode_lz4(src: &[u8], dst: &mut [u8]) -> Result<(), ()> {
    let (mut s, mut d) = (0usize, 0usize);
    while s < src.len() && d < dst.len() {
        let token = src[s];
        s += 1;
        let mut literal = (token >> 4) as usize;
        if literal == 15 {
            loop {
                let b = *src.get(s).ok_or(())? as usize;
                s += 1;
                literal = literal.checked_add(b).ok_or(())?;
                if b != 255 {
                    break;
                }
            }
        }
        let end_s = s.checked_add(literal).ok_or(())?;
        let end_d = d.checked_add(literal).ok_or(())?;
        if end_s > src.len() || end_d > dst.len() {
            return Err(());
        }
        dst[d..end_d].copy_from_slice(&src[s..end_s]);
        s = end_s;
        d = end_d;
        if s >= src.len() {
            break;
        }
        let off = *src.get(s).ok_or(())? as usize | ((*src.get(s + 1).ok_or(())? as usize) << 8);
        s += 2;
        if off == 0 || off > d {
            return Err(());
        }
        let mut length = (token & 15) as usize;
        if length == 15 {
            loop {
                let b = *src.get(s).ok_or(())? as usize;
                s += 1;
                length = length.checked_add(b).ok_or(())?;
                if b != 255 {
                    break;
                }
            }
        }
        length = length.checked_add(4).ok_or(())?;
        if d.checked_add(length).ok_or(())? > dst.len() {
            return Err(());
        }
        for _ in 0..length {
            dst[d] = dst[d - off];
            d += 1;
        }
    }
    if d == dst.len() && s == src.len() {
        Ok(())
    } else {
        Err(())
    }
}

// The bridge owns these allocations and frees them in a finally block.
#[no_mangle]
pub extern "C" fn triancle_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// # Safety
/// `ptr` must be a live allocation returned by `triancle_alloc` with the same length.
#[no_mangle]
pub unsafe extern "C" fn triancle_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

/// # Safety
/// Both pointers must reference separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_lz4(
    src: *const u8,
    src_len: usize,
    dst: *mut u8,
    dst_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(src, src_len);
    let dst = std::slice::from_raw_parts_mut(dst, dst_len);
    if decode_lz4(src, dst).is_ok() {
        1
    } else {
        0
    }
}

/// Convert four interleaved byte planes into little-endian u32 values.
pub fn deinterleave(src: &[u8], dst: &mut [u8]) -> Result<(), ()> {
    if src.len() != dst.len() || src.len() % 4 != 0 {
        return Err(());
    }
    let n = src.len() / 4;
    for i in 0..n {
        let value = u32::from_be_bytes([src[i], src[n + i], src[2 * n + i], src[3 * n + i]]);
        dst[4 * i..4 * i + 4].copy_from_slice(&value.to_le_bytes());
    }
    Ok(())
}

/// # Safety
/// Pointers must reference separate live allocations of `len` bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_deinterleave(src: *const u8, dst: *mut u8, len: usize) -> i32 {
    let input = std::slice::from_raw_parts(src, len);
    let output = std::slice::from_raw_parts_mut(dst, len);
    if deinterleave(input, output).is_ok() {
        1
    } else {
        0
    }
}

/// Decode a Roblox zigzag signed integer.
#[no_mangle]
pub extern "C" fn triancle_zigzag(value: u32) -> i32 {
    ((value >> 1) as i32) ^ (-((value & 1) as i32))
}

/// Decode a Roblox rotated IEEE-754 binary32 value.
#[no_mangle]
pub extern "C" fn triancle_rbxl_float(value: u32) -> f64 {
    f32::from_bits(value.rotate_right(1)) as f64
}

/// Match the game's angle wrapping, retaining the original ±π boundary behavior.
#[no_mangle]
pub extern "C" fn triancle_wrap_angle(mut angle: f64) -> f64 {
    let pi = std::f64::consts::PI;
    while angle > pi {
        angle -= 2.0 * pi;
    }
    while angle < -pi {
        angle += 2.0 * pi;
    }
    angle
}

/// Frame-rate-independent blend factor used for avatar animation.
#[no_mangle]
pub extern "C" fn triancle_animation_blend(dt: f64, rate: f64) -> f64 {
    1.0 - (-dt * rate).exp()
}

/// Match JavaScript's Math.round(value * 100) / 100 for network snapshots.
#[no_mangle]
pub extern "C" fn triancle_network_round(value: f64) -> f64 {
    let scaled = value * 100.0;
    if !scaled.is_finite() || scaled.abs() >= 4_503_599_627_370_496.0 {
        return scaled / 100.0;
    }
    let lower = scaled.floor();
    let rounded = if scaled - lower < 0.5 {
        lower
    } else {
        lower + 1.0
    };
    if rounded == 0.0 && scaled.is_sign_negative() {
        -0.0
    } else {
        rounded / 100.0
    }
}

/// Orbit-camera calculations for finite mouse and wheel inputs.
#[no_mangle]
pub extern "C" fn triancle_camera_yaw(yaw: f64, dx: f64, sensitivity: f64) -> f64 {
    yaw - dx * sensitivity
}
#[no_mangle]
pub extern "C" fn triancle_camera_pitch(pitch: f64, dy: f64, sensitivity: f64, limit: f64) -> f64 {
    (pitch + dy * sensitivity).min(limit).max(-limit)
}
#[no_mangle]
pub extern "C" fn triancle_camera_zoom(zoom: f64, delta: f64, minimum: f64, maximum: f64) -> f64 {
    let factor = if delta > 0.0 { 1.14 } else { 1.0 / 1.14 };
    (zoom * factor).min(maximum).max(minimum)
}

/// # Safety
/// State is a writable buffer of 20 little-endian f64 values: zoom, target,
/// shift, desired shift, dt, yaw, pitch, focus(3), shift offset, baseplate
/// half-width, then eight output slots (zoom, shift, focus(3), position(3)).
#[no_mangle]
pub unsafe extern "C" fn triancle_camera_frame(state: *mut u8) -> i32 {
    let bytes = std::slice::from_raw_parts_mut(state, 160);
    let mut v = [0.0f64; 20];
    for (i, c) in bytes.chunks_exact(8).enumerate() {
        v[i] = f64::from_le_bytes(c.try_into().unwrap());
    }
    if !v[..12].iter().all(|x| x.is_finite()) {
        return 0;
    }
    let zoom = v[0] + (v[1] - v[0]) * triancle_animation_blend(v[4], 20.0);
    let shift = v[2] + (v[3] - v[2]) * triancle_animation_blend(v[4], 15.0);
    let off = v[10] * shift;
    let focus = [v[7] + v[5].cos() * off, v[8], v[9] - v[5].sin() * off];
    let cp = v[6].cos();
    let sp = v[6].sin();
    let mut pos = [
        focus[0] + zoom * v[5].sin() * cp,
        focus[1] + zoom * sp,
        focus[2] + zoom * v[5].cos() * cp,
    ];
    if pos[1] < 0.25 && focus[1] > 0.25 && pos[0].abs() < v[11] && pos[2].abs() < v[11] {
        let scale = (focus[1] - 0.25) / (focus[1] - pos[1]);
        for i in 0..3 {
            pos[i] -= focus[i];
            pos[i] *= scale;
            pos[i] += focus[i];
        }
    }
    let out = [
        zoom, shift, focus[0], focus[1], focus[2], pos[0], pos[1], pos[2],
    ];
    if !out.iter().all(|x| x.is_finite()) {
        return 0;
    }
    for (i, value) in out.iter().enumerate() {
        let at = (12 + i) * 8;
        bytes[at..at + 8].copy_from_slice(&value.to_le_bytes());
    }
    1
}

/// Advance the avatar animation state by one frame. Slots are documented in
/// the JavaScript bridge, which also retains the original implementation as a
/// fallback for unsupported values.
pub fn animation_step(s: &mut [f64; 33]) {
    let dt = s[0];
    let (mut facing, mut walk, mut air, mut max_fall, mut land_t, mut land_amt) =
        (s[1], s[2], s[3], s[4], s[5], s[6]);
    let (time, mut body, mut lean, mut roll) = (s[7] + dt, s[8], s[9], s[10]);
    let alive = s[15] != 0.0;
    let ground = s[16] != 0.0;
    let climb = s[17] as i32;
    if alive {
        let mut target: Option<f64> = None;
        let mut k = s[29];
        if climb != 0 {
            target = Some(s[18]);
            k = 25.0;
        } else if s[21] != 0.0 {
            target = Some(s[22].cos().atan2(-s[22].sin()));
            k = s[30];
        } else if s[23] != 0.0 || s[24] != 0.0 {
            target = Some((-s[24]).atan2(s[23]));
        }
        if let Some(t) = target {
            facing = triancle_wrap_angle(
                facing + triancle_wrap_angle(t - facing) * triancle_animation_blend(dt, k),
            );
        }
    }
    let speed = s[25].hypot(s[27]);
    let sr = (speed / s[28]).min(1.2);
    let vy = s[26];
    if ground || climb != 0 {
        if air > 0.3 && climb == 0 && alive {
            land_t = 0.24;
            land_amt = (max_fall / 70.0).min(1.0);
        }
        air = 0.0;
        max_fall = 0.0;
    } else {
        air += dt;
        max_fall = max_fall.max(-vy);
    }
    if land_t > 0.0 {
        land_t -= dt;
    }
    let (mut al, mut ar);
    let (mut ll, mut lr, mut tb, mut tl, mut tr) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let state: f64;
    let pi = std::f64::consts::PI;
    if climb != 0 {
        state = 4.0;
        let u = s[19] / s[20];
        walk += dt * 16.0;
        let wave = walk.sin();
        if climb == 1 {
            let mv = s[31];
            al = pi * 0.85 + wave * 0.3 * mv;
            ar = pi * 0.85 - wave * 0.3 * mv;
            ll = wave * 0.6 * mv;
            lr = -wave * 0.6 * mv;
        } else if climb == 2 {
            al = pi * 0.95;
            ar = al;
            ll = 0.2;
            lr = -0.2;
        } else if u < 0.65 {
            al = pi * 0.85 + wave * 0.3;
            ar = pi * 0.85 - wave * 0.3;
            ll = wave * 0.7;
            lr = -wave * 0.7;
        } else {
            al = pi * 0.4;
            ar = al;
            ll = 0.5;
            lr = -0.2;
        }
    } else if air > 0.22 && vy < 0.0 {
        state = 3.0;
        al = pi * 0.82 + (time * 14.0).sin() * 0.1;
        ar = al;
        ll = 0.35;
        lr = -0.25;
        tl = -0.05;
    } else if !ground && vy > 1.0 {
        state = 2.0;
        al = pi * 0.72;
        ar = al;
        ll = 0.45;
        lr = -0.2;
        tl = -0.04;
    } else if speed > 0.5 {
        state = 1.0;
        walk += dt * (2.0 * pi / 0.7) * (speed / 14.5);
        let wave = walk.sin();
        let amplitude = 0.35 + 0.7 * sr;
        ar = wave * amplitude;
        ll = wave * amplitude;
        al = -wave * amplitude * 0.95;
        lr = -wave * amplitude;
        tb = (walk.cos().abs() - 0.5) * 0.14 * sr;
        tl = 0.1 * sr;
        tr = wave * 0.035 * sr;
    } else {
        state = 0.0;
        let wave = (time * 1.7).sin();
        al = wave * 0.045;
        ar = -(time * 1.7 + 0.6).sin() * 0.045;
        tb = wave * 0.02;
    }
    if land_t > 0.0 && climb == 0 {
        let kk = ((1.0 - land_t / 0.24) * pi).sin() * land_amt;
        tb -= 0.45 * kk;
        tl += 0.12 * kk;
        al += 0.5 * kk;
        ar += 0.5 * kk;
    }
    let k = triancle_animation_blend(dt, 22.0);
    s[11] += (al - s[11]) * k;
    s[12] += (ar - s[12]) * k;
    s[13] += (ll - s[13]) * k;
    s[14] += (lr - s[14]) * k;
    body += (tb - body) * triancle_animation_blend(dt, 16.0);
    lean += (tl - lean) * triancle_animation_blend(dt, 10.0);
    roll += (tr - roll) * triancle_animation_blend(dt, 10.0);
    s[1] = facing;
    s[2] = walk;
    s[3] = air;
    s[4] = max_fall;
    s[5] = land_t;
    s[6] = land_amt;
    s[7] = time;
    s[8] = body;
    s[9] = lean;
    s[10] = roll;
    s[32] = state;
}

/// # Safety
/// `state` must point to a live writable 264-byte allocation in linear memory.
#[no_mangle]
pub unsafe extern "C" fn triancle_animation_step(state: *mut u8) {
    let bytes = std::slice::from_raw_parts_mut(state, 33 * 8);
    let mut values = [0.0; 33];
    for (i, chunk) in bytes.chunks_exact(8).enumerate() {
        values[i] = f64::from_le_bytes(chunk.try_into().unwrap());
    }
    animation_step(&mut values);
    for (i, value) in values.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&value.to_le_bytes());
    }
}

/// Interpolate the position, posture, orientation and limbs of a remote avatar.
pub fn remote_animation_step(s: &mut [f64; 23]) {
    let k = s[0];
    s[1] += (s[12] - s[1]) * k;
    s[2] += (s[13] - s[2]) * k;
    s[3] += (s[14] - s[3]) * k;
    s[4] += (s[15] - s[4]) * k;
    s[5] += (s[16] + s[3] - s[5]) * k;
    s[6] += (s[17] - s[6]) * k;
    s[7] = triancle_wrap_angle(s[7] + triancle_wrap_angle(s[18] - s[7]) * k);
    for i in 0..4 {
        s[8 + i] += (s[19 + i] - s[8 + i]) * k;
    }
}

/// # Safety
/// `state` must point to a live writable 184-byte allocation.
#[no_mangle]
pub unsafe extern "C" fn triancle_remote_animation_step(state: *mut u8) {
    let bytes = std::slice::from_raw_parts_mut(state, 23 * 8);
    let mut values = [0.0; 23];
    for (i, chunk) in bytes.chunks_exact(8).enumerate() {
        values[i] = f64::from_le_bytes(chunk.try_into().unwrap());
    }
    remote_animation_step(&mut values);
    for (i, value) in values.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&value.to_le_bytes());
    }
}

/// Validate a remote snapshot and normalize optional numeric fields.
/// Slots: x, y, z, facing, lean, roll, body offset, forcefield flag.
pub fn remote_snapshot(values: &mut [f64; 8]) -> bool {
    if !values[..3].iter().all(|v| v.is_finite()) {
        return false;
    }
    for value in &mut values[3..7] {
        if !value.is_finite() {
            *value = 0.0;
        }
    }
    true
}

/// # Safety
/// State must point to a live writable 64-byte allocation.
#[no_mangle]
pub unsafe extern "C" fn triancle_remote_snapshot(state: *mut u8) -> i32 {
    let bytes = std::slice::from_raw_parts_mut(state, 64);
    let mut values = [0.0; 8];
    for (i, chunk) in bytes.chunks_exact(8).enumerate() {
        values[i] = f64::from_le_bytes(chunk.try_into().unwrap());
    }
    if !remote_snapshot(&mut values) {
        return 0;
    }
    for (i, value) in values.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&value.to_le_bytes());
    }
    1
}

/// Display-only listing fee. Supabase remains the authority for charges.
#[no_mangle]
pub extern "C" fn triancle_listing_fee(price: f64, is_face: i32) -> f64 {
    if is_face != 0 {
        return 0.0;
    }
    let nonnegative = if price > 0.0 { price } else { 0.0 };
    (nonnegative * 0.15).ceil()
}

/// Display-only creator share for the listing preview.
#[no_mangle]
pub extern "C" fn triancle_creator_share(price: f64) -> f64 {
    (price * 0.8).floor()
}

/// Classify an item slot: 0 accessory, 1 clothing, 2 face.
/// # Safety
/// Input must be a live `count * 2`-byte buffer of little-endian UTF-16 units.
#[no_mangle]
pub unsafe extern "C" fn triancle_item_kind(input: *const u8, count: usize) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    fn equals(src: &[u8], expected: &[u8]) -> bool {
        src.len() == expected.len() * 2
            && src
                .chunks_exact(2)
                .zip(expected)
                .all(|(unit, byte)| unit[0] == *byte && unit[1] == 0)
    }
    if equals(src, b"Shirt") || equals(src, b"Pants") {
        1
    } else if equals(src, b"Face") {
        2
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn triancle_item_upload_fee(kind: i32) -> i32 {
    match kind {
        1 => 5,
        2 => 0,
        _ => 150,
    }
}

#[no_mangle]
pub extern "C" fn triancle_item_min_price(kind: i32) -> i32 {
    match kind {
        1 => 5,
        2 => 0,
        _ => 50,
    }
}

/// UGC preflight decisions; these mirror the UI only, not Supabase permissions.
#[no_mangle]
pub extern "C" fn triancle_ugc_basics(has_asset: i32, has_name: i32) -> i32 {
    if has_asset == 0 {
        1
    } else if has_name == 0 {
        2
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn triancle_ugc_price_invalid(price: f64, minimum: f64) -> i32 {
    (price < minimum) as i32
}

#[no_mangle]
pub extern "C" fn triancle_ugc_insufficient(total: f64, balance: f64, has_balance: i32) -> i32 {
    (total > 0.0 && has_balance != 0 && balance < total) as i32
}

#[no_mangle]
pub extern "C" fn triancle_ugc_sale_changed(
    sale: i32,
    published: i32,
    price: f64,
    live_price: f64,
) -> i32 {
    (if sale != 0 {
        published == 0 || price != live_price
    } else {
        published != 0
    }) as i32
}

/// Calculate one local-axis position of an item attached to an avatar.
#[no_mangle]
pub extern "C" fn triancle_item_position(anchor: f64, pivot: f64, offset: f64) -> f64 {
    anchor - pivot + offset
}

/// Center a model on its attachment, using its bottom edge for the head slot.
#[no_mangle]
pub extern "C" fn triancle_item_center(center: f64, minimum: f64, scale: f64, head_y: i32) -> f64 {
    if head_y != 0 {
        -minimum * scale
    } else {
        -center * scale
    }
}

/// Clean a player name as UTF-16 code units, matching JavaScript trim and slice.
pub fn clean_text(input: &[u8], output: &mut [u8], limit: usize) -> Option<usize> {
    if input.len() % 2 != 0 || output.len() < limit.checked_mul(2)? {
        return None;
    }
    let units: Vec<u16> = input
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .filter(|c| !(*c <= 0x1f || *c == 0x7f || *c == 0x3c || *c == 0x3e))
        .collect();
    fn whitespace(c: u16) -> bool {
        matches!(c, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
    }
    let start = units
        .iter()
        .position(|c| !whitespace(*c))
        .unwrap_or(units.len());
    let end = units
        .iter()
        .rposition(|c| !whitespace(*c))
        .map_or(start, |i| i + 1);
    let trimmed = &units[start..end];
    let len = trimmed.len().min(limit);
    for (i, unit) in trimmed[..len].iter().enumerate() {
        output[i * 2..i * 2 + 2].copy_from_slice(&unit.to_le_bytes());
    }
    Some(len)
}

/// # Safety
/// Input must be `count * 2` bytes and output must be 40 bytes; the allocations must not overlap.
#[no_mangle]
pub unsafe extern "C" fn triancle_clean_name(
    input: *const u8,
    count: usize,
    output: *mut u8,
) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    let dst = std::slice::from_raw_parts_mut(output, 40);
    clean_text(src, dst, 20)
        .and_then(|n| i32::try_from(n).ok())
        .unwrap_or(-1)
}

/// # Safety
/// Input must be `count * 2` bytes and output must be 240 bytes; buffers must not overlap.
#[no_mangle]
pub unsafe extern "C" fn triancle_clean_chat(
    input: *const u8,
    count: usize,
    output: *mut u8,
) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    let dst = std::slice::from_raw_parts_mut(output, 240);
    clean_text(src, dst, 120)
        .and_then(|n| i32::try_from(n).ok())
        .unwrap_or(-1)
}

/// # Safety
/// Input must be a live `count * 2`-byte buffer of little-endian UTF-16 units.
#[no_mangle]
pub unsafe extern "C" fn triancle_name_hue(input: *const u8, count: usize) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    let mut hash: u32 = 2166136261;
    for pair in src.chunks_exact(2) {
        hash ^= u16::from_le_bytes([pair[0], pair[1]]) as u32;
        hash = hash.wrapping_mul(16777619);
    }
    (hash % 360) as i32
}

/// # Safety
/// Input must be a live `count * 2`-byte buffer of little-endian UTF-16 units.
#[no_mangle]
pub unsafe extern "C" fn triancle_badge_hue(input: *const u8, count: usize) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    let unit = |i: usize| u16::from_le_bytes([src[i * 2], src[i * 2 + 1]]);
    let mut hue = 7u32;
    let mut i = 0;
    while i < count {
        let c = unit(i);
        hue = (hue * 31 + c as u32) % 360;
        if (0xd800..=0xdbff).contains(&c)
            && i + 1 < count
            && (0xdc00..=0xdfff).contains(&unit(i + 1))
        {
            i += 1;
        }
        i += 1;
    }
    hue as i32
}

/// # Safety
/// Input must be a live `count * 2`-byte buffer of little-endian UTF-16 units.
#[no_mangle]
pub unsafe extern "C" fn triancle_valid_username(input: *const u8, count: usize) -> i32 {
    if !(3..=20).contains(&count) {
        return 0;
    }
    let src = std::slice::from_raw_parts(input, count * 2);
    src.chunks_exact(2).all(|pair| {
        let c = u16::from_le_bytes([pair[0], pair[1]]);
        (0x30..=0x39).contains(&c)
            || (0x41..=0x5a).contains(&c)
            || (0x61..=0x7a).contains(&c)
            || c == 0x5f
    }) as i32
}

/// # Safety
/// Input must be a live `count * 2`-byte buffer of UTF-16 units. Returns -1
/// for non-ASCII so the browser's Unicode-aware regular expression is used.
#[no_mangle]
pub unsafe extern "C" fn triancle_valid_display_name(input: *const u8, count: usize) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    let units: Vec<u16> = src
        .chunks_exact(2)
        .map(|p| u16::from_le_bytes([p[0], p[1]]))
        .collect();
    if units.iter().any(|c| *c > 0x7f) {
        return -1;
    }
    if !(1..=20).contains(&count) {
        return 0;
    }
    units.iter().all(|c| {
        (0x30..=0x39).contains(c)
            || (0x41..=0x5a).contains(c)
            || (0x61..=0x7a).contains(c)
            || matches!(*c, 0x20 | 0x27 | 0x2d | 0x2e | 0x5f)
    }) as i32
}

/// # Safety
/// Input must be a live `count * 2`-byte buffer of UTF-16 units.
#[no_mangle]
pub unsafe extern "C" fn triancle_valid_item_id(input: *const u8, count: usize) -> i32 {
    if count != 36 {
        return 0;
    }
    let src = std::slice::from_raw_parts(input, count * 2);
    src.chunks_exact(2).enumerate().all(|(i, pair)| {
        let c = u16::from_le_bytes([pair[0], pair[1]]);
        if matches!(i, 8 | 13 | 18 | 23) {
            c == 0x2d
        } else {
            (0x30..=0x39).contains(&c) || (0x41..=0x46).contains(&c) || (0x61..=0x66).contains(&c)
        }
    }) as i32
}

/// # Safety
/// Input must be `count * 2` bytes and output must be `capacity * 2` bytes;
/// the live allocations must not overlap. Strings use little-endian UTF-16.
#[no_mangle]
pub unsafe extern "C" fn triancle_escape_html(
    input: *const u8,
    count: usize,
    output: *mut u8,
    capacity: usize,
) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let Some(out_size) = capacity.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    let dst = std::slice::from_raw_parts_mut(output, out_size);
    let mut pos = 0usize;
    for pair in src.chunks_exact(2) {
        let c = u16::from_le_bytes([pair[0], pair[1]]);
        let replacement: Option<&[u8]> = match c {
            0x26 => Some(b"&amp;"),
            0x3c => Some(b"&lt;"),
            0x3e => Some(b"&gt;"),
            0x22 => Some(b"&quot;"),
            0x27 => Some(b"&#39;"),
            _ => None,
        };
        let len = replacement.map_or(1, |s| s.len());
        let Some(end) = pos.checked_add(len) else {
            return -1;
        };
        if end > capacity {
            return -1;
        }
        if let Some(rep) = replacement {
            for (i, byte) in rep.iter().enumerate() {
                dst[(pos + i) * 2..(pos + i) * 2 + 2]
                    .copy_from_slice(&(*byte as u16).to_le_bytes());
            }
        } else {
            dst[pos * 2..pos * 2 + 2].copy_from_slice(&c.to_le_bytes());
        }
        pos = end;
    }
    i32::try_from(pos).unwrap_or(-1)
}

/// Advance one player-built part against the current list of solid boxes.
/// State: dt, gravity, x, y, z, vy, half-x, half-y, half-z, collision flag,
/// followed by six bounds per solid (min/max X, min/max Y, min/max Z).
pub fn step_built_part(values: &mut [f64], count: usize) -> Option<()> {
    if values.len() != 10usize.checked_add(count.checked_mul(6)?)? {
        return None;
    }
    let (dt, gravity, x, mut y, z, mut vy, hx, hy, hz) = (
        values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7],
        values[8],
    );
    vy -= gravity * dt;
    y += vy * dt;
    if values[9] != 0.0 {
        for s in values[10..].chunks_exact(6) {
            if vy > 0.0 {
                continue;
            }
            if x + hx > s[0]
                && x - hx < s[1]
                && z + hz > s[4]
                && z - hz < s[5]
                && y + hy > s[2]
                && y - hy < s[3]
            {
                y = s[3] + hy;
                vy = 0.0;
            }
        }
    }
    values[3] = y;
    values[5] = vy;
    Some(())
}

/// # Safety
/// `state` must point to `10 + count * 6` writable little-endian f64 values.
#[no_mangle]
pub unsafe extern "C" fn triancle_step_built_part(state: *mut u8, count: usize) -> i32 {
    let Some(n) = count.checked_mul(6).and_then(|v| v.checked_add(10)) else {
        return 0;
    };
    let Some(size) = n.checked_mul(8) else {
        return 0;
    };
    let bytes = std::slice::from_raw_parts_mut(state, size);
    let mut values: Vec<f64> = bytes
        .chunks_exact(8)
        .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
        .collect();
    if step_built_part(&mut values, count).is_none() {
        return 0;
    }
    for (i, v) in values.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&v.to_le_bytes());
    }
    1
}

/// # Safety
/// State must be a live writable buffer of 15 little-endian f64 values.
/// Input: position, size, is-ball; output slots 7..15: six bounds, round flag, radius.
#[no_mangle]
pub unsafe extern "C" fn triancle_built_solid(state: *mut u8) {
    let bytes = std::slice::from_raw_parts_mut(state, 15 * 8);
    let mut v = [0.0f64; 15];
    for (i, c) in bytes.chunks_exact(8).enumerate() {
        v[i] = f64::from_le_bytes(c.try_into().unwrap());
    }
    v[7] = v[0] - v[3] / 2.0;
    v[8] = v[0] + v[3] / 2.0;
    v[9] = v[1] - v[4] / 2.0;
    v[10] = v[1] + v[4] / 2.0;
    v[11] = v[2] - v[5] / 2.0;
    v[12] = v[2] + v[5] / 2.0;
    let min = v[3].min(v[4]).min(v[5]);
    let max = v[3].max(v[4]).max(v[5]);
    v[13] = if v[6] != 0.0 && min > max * 0.95 {
        1.0
    } else {
        0.0
    };
    v[14] = min / 2.0;
    for (i, x) in v.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&x.to_le_bytes());
    }
}

/// Find the closest point on a build-tool axis to the mouse ray.
/// NaN signals a nearly parallel ray, matching the JS null result.
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn triancle_axis_param(
    ox: f64,
    oy: f64,
    oz: f64,
    dx: f64,
    dy: f64,
    dz: f64,
    rx: f64,
    ry: f64,
    rz: f64,
    vx: f64,
    vy: f64,
    vz: f64,
) -> f64 {
    let b = dx * vx + dy * vy + dz * vz;
    let (wx, wy, wz) = (ox - rx, oy - ry, oz - rz);
    let den = 1.0 - b * b;
    if den.abs() < 1e-4 {
        return f64::NAN;
    }
    (b * (vx * wx + vy * wy + vz * wz) - (dx * wx + dy * wy + dz * wz)) / den
}

/// # Safety
/// State must be a live writable 176-byte buffer. Inputs are delta (3),
/// current position (3), and a column-major 4x4 matrix (16). Slots 3..6 receive
/// the updated clamped position. Non-finite results request JS fallback.
#[no_mangle]
pub unsafe extern "C" fn triancle_ugc_drag(state: *mut u8) -> i32 {
    let bytes = std::slice::from_raw_parts_mut(state, 22 * 8);
    let mut v = [0.0f64; 22];
    for (i, c) in bytes.chunks_exact(8).enumerate() {
        v[i] = f64::from_le_bytes(c.try_into().unwrap());
    }
    let (x, y, z) = (v[0], v[1], v[2]);
    let e = &v[6..22];
    let w = 1.0 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    let delta = [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w,
    ];
    for i in 0..3 {
        let result = v[3 + i] + delta[i];
        if !result.is_finite() {
            return 0;
        }
        v[3 + i] = result.max(-4.0).min(4.0);
    }
    for (i, value) in v.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&value.to_le_bytes());
    }
    1
}

/// # Safety
/// State is a live writable buffer of 10 little-endian f64 values: size (3),
/// position (3), color, transparency, anchored and collidable flags.
#[no_mangle]
pub unsafe extern "C" fn triancle_remote_part(state: *mut u8) -> i32 {
    let bytes = std::slice::from_raw_parts_mut(state, 80);
    let mut v = [0.0f64; 10];
    for (i, c) in bytes.chunks_exact(8).enumerate() {
        v[i] = f64::from_le_bytes(c.try_into().unwrap());
    }
    if !v[..6].iter().all(|x| x.is_finite()) {
        return 0;
    }
    for x in &mut v[..3] {
        *x = x.min(512.0).max(0.2);
    }
    let color = if v[6].is_finite() {
        let n = v[6].trunc() % 4_294_967_296.0;
        if n < 0.0 {
            n + 4_294_967_296.0
        } else {
            n
        }
    } else {
        0.0
    };
    v[6] = ((color as u32) & 0x00ff_ffff) as f64;
    v[7] = if v[7].is_nan() {
        0.0
    } else {
        v[7].min(1.0).max(0.0)
    };
    for (i, x) in v.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&x.to_le_bytes());
    }
    1
}

/// Convert zigzag-encoded reference deltas into the cumulative references used
/// by the map importer. f64 matches JavaScript number accumulation.
pub fn decode_references(input: &[u8], output: &mut [u8]) -> Result<(), ()> {
    if input.len() % 4 != 0 || output.len() / 2 != input.len() || output.len() % 8 != 0 {
        return Err(());
    }
    let mut current = 0.0f64;
    for (src, dst) in input.chunks_exact(4).zip(output.chunks_exact_mut(8)) {
        let encoded = u32::from_le_bytes([src[0], src[1], src[2], src[3]]);
        current += triancle_zigzag(encoded) as f64;
        dst.copy_from_slice(&current.to_le_bytes());
    }
    Ok(())
}

/// # Safety
/// Pointers must reference separate live allocations of `count * 4` and `count * 8` bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_references(
    input: *const u8,
    output: *mut u8,
    count: usize,
) -> i32 {
    let Some(input_len) = count.checked_mul(4) else {
        return 0;
    };
    let Some(output_len) = count.checked_mul(8) else {
        return 0;
    };
    let src = std::slice::from_raw_parts(input, input_len);
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    if decode_references(src, dst).is_ok() {
        1
    } else {
        0
    }
}

/// # Safety
/// `state` points to ten writable little-endian f64 values. The first six are
/// price, item kind (0 accessory, 1 clothing, 2 face), live price, published,
/// sale and edit flags; the last four receive upload, listing, total and share.
#[no_mangle]
pub unsafe extern "C" fn triancle_ugc_fee_plan(state: *mut u8) -> i32 {
    let bytes = std::slice::from_raw_parts_mut(state, 80);
    let mut v = [0.0f64; 10];
    for (i, part) in bytes.chunks_exact(8).enumerate() {
        v[i] = f64::from_le_bytes(part.try_into().unwrap());
    }
    if !v[..6].iter().all(|n| n.is_finite())
        || v[0] < 0.0
        || !matches!(v[1] as i32, 0..=2)
        || v[1] != v[1].trunc()
    {
        return 0;
    }
    let upload = if v[5] != 0.0 {
        0.0
    } else {
        match v[1] as i32 {
            1 => 5.0,
            2 => 0.0,
            _ => 150.0,
        }
    };
    let pending = if (v[3] != 0.0 && v[0] == v[2]) || v[1] == 2.0 {
        0.0
    } else {
        (v[0] * 0.15).ceil()
    };
    let listing = if v[4] != 0.0 { pending } else { 0.0 };
    v[6] = upload;
    v[7] = listing;
    v[8] = upload + listing;
    v[9] = (v[0] * 0.8).floor();
    for (i, value) in v.iter().enumerate() {
        bytes[i * 8..i * 8 + 8].copy_from_slice(&value.to_le_bytes());
    }
    1
}

/// Match the upload loader's four-byte GLB and PNG signature checks.
/// # Safety
/// Input must reference at least four bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_asset_signature(input: *const u8, kind: i32) -> i32 {
    let bytes = std::slice::from_raw_parts(input, 4);
    let signature: &[u8; 4] = if kind == 1 {
        b"glTF"
    } else {
        &[0x89, b'P', b'N', b'G']
    };
    (bytes == signature) as i32
}

/// Game setting 0 permits everyone, 1 permits owner or admin, 2 disables building.
#[no_mangle]
pub extern "C" fn triancle_can_build(mode: i32, signed_in: i32, owner: i32, admin: i32) -> i32 {
    match mode {
        2 => 0,
        1 => (signed_in != 0 && (owner != 0 || admin != 0)) as i32,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::{approach, decode_lz4, deinterleave, move_direction};

    fn close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-12, "{actual} != {expected}");
    }

    #[test]
    fn accelerates_toward_target_without_exceeding_delta() {
        let (x, z) = approach(0.0, 0.0, 3.0, 4.0, 2.0);
        close(x, 1.2);
        close(z, 1.6);
    }

    #[test]
    fn reaches_target_without_overshooting() {
        assert_eq!(approach(1.0, 2.0, 4.0, 6.0, 5.0), (4.0, 6.0));
        assert_eq!(approach(1.0, 2.0, 4.0, 6.0, 10.0), (4.0, 6.0));
    }

    #[test]
    fn handles_stationary_and_reverse_movement() {
        assert_eq!(approach(1.0, -2.0, 1.0, -2.0, 0.0), (1.0, -2.0));
        assert_eq!(approach(2.0, 0.0, -2.0, 0.0, 1.0), (1.0, 0.0));
        assert_eq!(approach(2.0, 0.0, -2.0, 0.0, 0.0), (2.0, 0.0));
    }

    #[test]
    fn input_follows_camera_and_normalizes_diagonals() {
        let (x, z) = move_direction(0.0, 1.0, 0.0);
        close(x, 0.0);
        close(z, -1.0);
        let (x, z) = move_direction(std::f64::consts::FRAC_PI_2, 1.0, 0.0);
        close(x, -1.0);
        close(z, 0.0);
        let (x, z) = move_direction(0.0, 1.0, 1.0);
        close(x.hypot(z), 1.0);
        assert_eq!(move_direction(2.0, 0.0, 0.0), (0.0, 0.0));
    }

    #[test]
    fn lz4_handles_literals_overlapping_matches_and_bad_offsets() {
        let mut dst = [0; 9];
        assert_eq!(
            decode_lz4(&[0x50, b'h', b'e', b'l', b'l', b'o', 5, 0], &mut dst),
            Ok(())
        );
        assert_eq!(&dst, b"hellohell");
        assert!(decode_lz4(&[0x00, 0, 0], &mut [0; 4]).is_err());
        assert!(decode_lz4(&[0x50, b'h'], &mut [0; 5]).is_err());
    }

    #[test]
    fn deinterleaves_unsigned_values_including_high_bits() {
        let src = [0x12, 0xff, 0x34, 0xee, 0x56, 0xdd, 0x78, 0xcc];
        let mut dst = [0; 8];
        assert_eq!(deinterleave(&src, &mut dst), Ok(()));
        assert_eq!(dst, [0x78, 0x56, 0x34, 0x12, 0xcc, 0xdd, 0xee, 0xff]);
        assert!(deinterleave(&[1, 2, 3], &mut [0; 3]).is_err());
    }
}
