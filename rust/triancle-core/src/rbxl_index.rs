//! Decode instance and parent indexes from already-decompressed RBXL chunks.
//! Invalid or oversized data is rejected so the bridge can use its JS fallback.
use serde_json::{json, Value};

pub(crate) fn u32_le(data: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        data.get(offset..offset.checked_add(4)?)?.try_into().ok()?,
    ))
}

pub(crate) fn refs(data: &[u8], offset: usize, n: usize) -> Option<Vec<f64>> {
    let size = n.checked_mul(4)?;
    let bytes = data.get(offset..offset.checked_add(size)?)?;
    let mut acc: f64 = 0.0;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let v = u32::from_be_bytes([bytes[i], bytes[n + i], bytes[2 * n + i], bytes[3 * n + i]]);
        acc += (((v >> 1) as i32) ^ -((v & 1) as i32)) as f64;
        if !acc.is_finite() {
            return None;
        }
        out.push(acc);
    }
    Some(out)
}

pub(crate) fn text(data: &[u8], offset: usize) -> Option<(String, usize)> {
    let len = u32_le(data, offset)? as usize;
    let start = offset.checked_add(4)?;
    let end = start.checked_add(len)?;
    let mut value = String::from_utf8_lossy(data.get(start..end)?).into_owned();
    // TextDecoder removes one leading UTF-8 BOM by default.
    if value.starts_with('\u{feff}') {
        value.remove(0);
    }
    Some((value, end))
}

fn deint(data: &[u8], offset: usize, n: usize) -> Option<Vec<u32>> {
    let end = offset.checked_add(n.checked_mul(4)?)?;
    let bytes = data.get(offset..end)?;
    Some(
        (0..n)
            .map(|i| {
                u32::from_be_bytes([bytes[i], bytes[n + i], bytes[2 * n + i], bytes[3 * n + i]])
            })
            .collect(),
    )
}

fn floats(data: &[u8], offset: usize, n: usize) -> Option<Vec<f64>> {
    deint(data, offset, n)?
        .into_iter()
        .map(|v| {
            let f = f32::from_bits(v.rotate_right(1)) as f64;
            if f.is_finite() {
                Some(f)
            } else {
                None
            }
        })
        .collect()
}

fn rotation(id: u8) -> Option<[f64; 9]> {
    Some(match id {
        2 => [1., 0., 0., 0., 1., 0., 0., 0., 1.],
        3 => [1., 0., 0., 0., 0., -1., 0., 1., 0.],
        5 => [1., 0., 0., 0., -1., 0., 0., 0., -1.],
        6 => [1., 0., 0., 0., 0., 1., 0., -1., 0.],
        7 => [0., 1., 0., 1., 0., 0., 0., 0., -1.],
        9 => [0., 0., 1., 1., 0., 0., 0., 1., 0.],
        10 => [0., -1., 0., 1., 0., 0., 0., 0., 1.],
        12 => [0., 0., -1., 1., 0., 0., 0., -1., 0.],
        13 => [0., 1., 0., 0., 0., 1., 1., 0., 0.],
        14 => [0., 0., -1., 0., 1., 0., 1., 0., 0.],
        16 => [0., -1., 0., 0., 0., -1., 1., 0., 0.],
        17 => [0., 0., 1., 0., -1., 0., 1., 0., 0.],
        20 => [-1., 0., 0., 0., 1., 0., 0., 0., -1.],
        21 => [-1., 0., 0., 0., 0., 1., 0., 1., 0.],
        23 => [-1., 0., 0., 0., -1., 0., 0., 0., 1.],
        24 => [-1., 0., 0., 0., 0., -1., 0., -1., 0.],
        25 => [0., 1., 0., -1., 0., 0., 0., 0., 1.],
        27 => [0., 0., -1., -1., 0., 0., 0., 1., 0.],
        28 => [0., -1., 0., -1., 0., 0., 0., 0., -1.],
        30 => [0., 0., 1., -1., 0., 0., 0., -1., 0.],
        31 => [0., 1., 0., 0., 0., -1., -1., 0., 0.],
        32 => [0., 0., 1., 0., 1., 0., -1., 0., 0.],
        34 => [0., -1., 0., 0., 0., 1., -1., 0., 0.],
        35 => [0., 0., -1., 0., -1., 0., -1., 0., 0.],
        _ => return None,
    })
}

/// Decode a supported PROP payload into the same array shape used by the JS importer.
pub fn property(data: &[u8], mut offset: usize, n: usize, kind: u8) -> Option<Vec<u8>> {
    if n > 1_000_000 {
        return None;
    }
    let mut vals: Vec<Value> = Vec::with_capacity(n);
    match kind {
        1 => {
            for _ in 0..n {
                let (value, next) = text(data, offset)?;
                offset = next;
                vals.push(json!(value));
            }
        }
        2 => {
            for &b in data.get(offset..offset.checked_add(n)?)? {
                vals.push(json!(b != 0));
            }
        }
        4 => {
            for v in floats(data, offset, n)? {
                vals.push(json!(v));
            }
        }
        18 => {
            for v in deint(data, offset, n)? {
                vals.push(json!(v));
            }
        }
        14 => {
            let width = n.checked_mul(4)?;
            let x = floats(data, offset, n)?;
            let y = floats(data, offset.checked_add(width)?, n)?;
            let z = floats(data, offset.checked_add(width.checked_mul(2)?)?, n)?;
            for i in 0..n {
                vals.push(json!([x[i], y[i], z[i]]));
            }
        }
        26 => {
            let end = offset.checked_add(n.checked_mul(3)?)?;
            let bytes = data.get(offset..end)?;
            for i in 0..n {
                vals.push(json!([bytes[i], bytes[n + i], bytes[2 * n + i]]));
            }
        }
        16 => {
            let mut rotations = Vec::with_capacity(n);
            for _ in 0..n {
                let id = *data.get(offset)?;
                offset += 1;
                if id == 0 {
                    let mut matrix = [0.0; 9];
                    for entry in &mut matrix {
                        let b = data.get(offset..offset.checked_add(4)?)?;
                        *entry = f32::from_le_bytes(b.try_into().ok()?) as f64;
                        if !entry.is_finite() {
                            return None;
                        }
                        offset += 4;
                    }
                    rotations.push(matrix);
                } else {
                    rotations.push(rotation(id).unwrap_or(rotation(2)?));
                }
            }
            let width = n.checked_mul(4)?;
            let x = floats(data, offset, n)?;
            let y = floats(data, offset.checked_add(width)?, n)?;
            let z = floats(data, offset.checked_add(width.checked_mul(2)?)?, n)?;
            for i in 0..n {
                vals.push(json!({"pos":[x[i],y[i],z[i]],"rot":rotations[i]}));
            }
        }
        _ => return None,
    }
    serde_json::to_vec(&vals).ok()
}

/// # Safety
/// Input/output must be separate live allocations of their supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_rbxl_property(
    input: *const u8,
    input_len: usize,
    offset: usize,
    count: usize,
    kind: u32,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let bytes = std::slice::from_raw_parts(input, input_len);
    let Ok(kind) = u8::try_from(kind) else {
        return -1;
    };
    let Some(result) = property(bytes, offset, count, kind) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

pub fn decode(data: &[u8]) -> Option<Vec<u8>> {
    let mut cursor = 0usize;
    let mut classes: Vec<Value> = Vec::new();
    let mut parents: Vec<Value> = Vec::new();
    while cursor < data.len() {
        let tag = data.get(cursor..cursor.checked_add(4)?)?;
        let size = u32_le(data, cursor.checked_add(4)?)? as usize;
        let begin = cursor.checked_add(8)?;
        let end = begin.checked_add(size)?;
        let chunk = data.get(begin..end)?;
        cursor = end;
        if tag == b"INST" {
            let id = u32_le(chunk, 0)?;
            let name_len = u32_le(chunk, 4)? as usize;
            let name_end = 8usize.checked_add(name_len)?;
            let (name, _) = text(chunk, 4)?;
            let count_at = name_end.checked_add(1)?;
            let n = u32_le(chunk, count_at)? as usize;
            if n > 1_000_000 {
                return None;
            }
            let ids = refs(chunk, count_at.checked_add(4)?, n)?;
            classes.push(json!([id, name, ids]));
        } else if tag == b"PRNT" {
            let n = u32_le(chunk, 1)? as usize;
            if n > 1_000_000 {
                return None;
            }
            let children = refs(chunk, 5, n)?;
            let parent_offset = 5usize.checked_add(n.checked_mul(4)?)?;
            let parent_refs = refs(chunk, parent_offset, n)?;
            for (child, parent) in children.into_iter().zip(parent_refs) {
                parents.push(json!([child, parent]));
            }
        } else {
            return None;
        }
    }
    serde_json::to_vec(&json!({"classes":classes,"parents":parents})).ok()
}

/// # Safety
/// The input and output buffers must be live, separate allocations of the
/// supplied lengths. A negative result requests the JavaScript fallback.
#[no_mangle]
pub unsafe extern "C" fn triancle_rbxl_index(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let bytes = std::slice::from_raw_parts(input, input_len);
    let Some(result) = decode(bytes) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let target = std::slice::from_raw_parts_mut(output, output_len);
    target[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

#[cfg(test)]
mod tests {
    use super::decode;
    #[test]
    fn rejects_truncated_chunks() {
        assert!(decode(b"INST\x10\0\0\0bad").is_none());
    }
}
