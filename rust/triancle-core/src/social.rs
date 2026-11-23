//! Social data transformations; browser adapters perform the Supabase calls.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Group recognized badges by user, retaining input order and duplicates.
pub fn group_badges(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let users = root.get("users")?.as_array()?;
    let rows = root.get("rows")?.as_array()?;
    if users.len() > 100_000 || rows.len() > 100_000 {
        return None;
    }
    let mut groups: Vec<Vec<&str>> = vec![Vec::new(); users.len()];
    let positions: HashMap<&str, usize> = users
        .iter()
        .enumerate()
        .map(|(i, v)| Some((v.as_str()?, i)))
        .collect::<Option<_>>()?;
    let valid: HashSet<&str> = root
        .get("valid")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    for row in rows {
        let user = row.get("user_id")?.as_str()?;
        let badge = row.get("badge")?.as_str()?;
        if valid.contains(badge) {
            if let Some(index) = positions.get(user) {
                groups[*index].push(badge);
            }
        }
    }
    serde_json::to_vec(&groups).ok()
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_group_badges(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let Some(result) = group_badges(std::slice::from_raw_parts(input, input_len)) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    std::slice::from_raw_parts_mut(output, output_len)[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

pub fn lists(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let me = root.get("me")?.as_str()?;
    let rows = root.get("rows")?.as_array()?;
    if rows.len() > 100_000 {
        return None;
    }
    let (mut friends, mut incoming, mut outgoing) = (Vec::new(), Vec::new(), Vec::new());
    for row in rows {
        let requester = row.get("requester")?.as_str()?;
        let addressee = row.get("addressee")?.as_str()?;
        let status = row.get("status")?.as_str()?;
        let other = if requester == me {
            addressee
        } else {
            requester
        };
        if status == "accepted" {
            friends.push(other);
        } else if addressee == me {
            incoming.push(other);
        } else {
            outgoing.push(other);
        }
    }
    serde_json::to_vec(&json!({"friends":friends,"incoming":incoming,"outgoing":outgoing})).ok()
}

pub fn relation(bytes: &[u8]) -> Option<i32> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let id = root.get("id")?.as_str()?;
    for (name, code) in [("friends", 1), ("incoming", 2), ("outgoing", 3)] {
        let entries = root.get(name)?.as_array()?;
        for entry in entries {
            if entry.as_str()? == id {
                return Some(code);
            }
        }
    }
    Some(0)
}

/// # Safety
/// Input must be a live `count * 2`-byte allocation of UTF-16 code units.
/// Returns 1 for add, 2 for accept, and 3 for the existing remove path.
#[no_mangle]
pub unsafe extern "C" fn triancle_friend_action(input: *const u8, count: usize) -> i32 {
    let Some(size) = count.checked_mul(2) else {
        return -1;
    };
    let src = std::slice::from_raw_parts(input, size);
    let eq = |s: &[u8]| {
        src.len() == s.len() * 2
            && src
                .chunks_exact(2)
                .zip(s)
                .all(|(p, c)| p[0] == *c && p[1] == 0)
    };
    if eq(b"add") {
        1
    } else if eq(b"accept") {
        2
    } else {
        3
    }
}

pub fn ordered_badges(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let mut badges: Vec<&str> = root
        .get("badges")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    let order: Vec<&str> = root
        .get("order")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    if badges.len() > 5000 || order.len() > 5000 {
        return None;
    }
    badges.sort_by_key(|badge| {
        order
            .iter()
            .position(|v| v == badge)
            .map(|i| i as i64)
            .unwrap_or(-1)
    });
    serde_json::to_vec(&badges).ok()
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_ordered_badges(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    let Some(result) = ordered_badges(src) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

/// # Safety
/// Input must be a live allocation of `input_len` bytes.
#[no_mangle]
pub unsafe extern "C" fn triancle_social_relation(input: *const u8, input_len: usize) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    relation(src).unwrap_or(-1)
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_social_lists(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    let Some(result) = lists(src) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}

#[cfg(test)]
mod tests {
    use super::lists;
    #[test]
    fn rejects_malformed_rows() {
        assert!(lists(br#"{"me":"a","rows":[{}]}"#).is_none());
    }
}
