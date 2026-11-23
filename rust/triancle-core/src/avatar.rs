//! Avatar data transformations. Browser rendering remains in the host layer.
use serde_json::{json, Value};

const PARTS: [&str; 6] = [
    "Head", "Torso", "LeftArm", "RightArm", "LeftLeg", "RightLeg",
];

pub fn sanitize_colors(bytes: &[u8]) -> Option<Vec<u8>> {
    let root: Value = serde_json::from_slice(bytes).ok()?;
    let input = root.get("colors")?;
    let defaults = root.get("defaults")?.as_object()?;
    let mut result = serde_json::Map::new();
    for part in PARTS {
        let default = defaults.get(part)?.as_str()?;
        let choice = input
            .get(part)
            .and_then(Value::as_str)
            .filter(|s| {
                let b = s.as_bytes();
                b.len() == 7 && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit)
            })
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| default.to_string());
        result.insert(part.to_owned(), json!(choice));
    }
    let face = input
        .get("face")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && v.fract() == 0.0 && *v >= 0.0 && *v < 100000.0)
        .unwrap_or(0.0);
    result.insert("face".into(), json!(face));
    result.insert(
        "body".into(),
        json!(
            if input.get("body").and_then(Value::as_str) == Some("female") {
                "female"
            } else {
                "male"
            }
        ),
    );
    serde_json::to_vec(&result).ok()
}

/// # Safety
/// Input and output must be separate live allocations of the supplied lengths.
#[no_mangle]
pub unsafe extern "C" fn triancle_sanitize_colors(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let src = std::slice::from_raw_parts(input, input_len);
    let Some(result) = sanitize_colors(src) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    let dst = std::slice::from_raw_parts_mut(output, output_len);
    dst[..result.len()].copy_from_slice(&result);
    result.len() as i32
}
