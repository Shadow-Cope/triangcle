use serde_json::{Map, Value};

fn clean_text(value: Option<&Value>, max: usize) -> Option<String> {
    let text = value?.as_str()?;
    if !text.is_ascii() {
        return None;
    }
    let cleaned: String = text
        .chars()
        .filter(|c| *c >= ' ' && *c != '<' && *c != '>')
        .collect();
    let trimmed = cleaned.trim();
    let output: String = trimmed.chars().take(max).collect();
    (!output.is_empty()).then_some(output)
}

fn image(value: Option<&Value>) -> Option<&str> {
    let text = value?.as_str()?;
    if text.len() >= 400_000 {
        return None;
    }
    let suffix = ["png", "jpeg", "webp", "gif"]
        .iter()
        .find_map(|kind| text.strip_prefix(&format!("data:image/{kind};base64,")))?;
    if suffix.is_empty()
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return None;
    }
    Some(text)
}

pub fn normalize(bytes: &[u8]) -> Option<Vec<u8>> {
    let row: Value = serde_json::from_slice(bytes).ok()?;
    let object = row.as_object()?;
    let mut result = Map::new();
    for (field, limit) in [("name", 40), ("by", 20), ("about", 600)] {
        if let Some(text) = clean_text(object.get(field), limit) {
            result.insert(field.into(), Value::String(text));
        }
    }
    for field in ["thumb", "icon"] {
        if let Some(text) = image(object.get(field)) {
            result.insert(field.into(), Value::String(text.into()));
        }
    }
    let mode = object.get("btools").and_then(Value::as_str);
    if matches!(mode, Some("all" | "staff" | "off")) {
        result.insert("btools".into(), Value::String(mode?.into()));
    }
    serde_json::to_vec(&result).ok()
}

/// # Safety
/// Input and output reference separate live allocations of the supplied sizes.
#[no_mangle]
pub unsafe extern "C" fn triancle_game_settings(
    input: *const u8,
    input_len: usize,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    let Some(result) = normalize(std::slice::from_raw_parts(input, input_len)) else {
        return -1;
    };
    if result.len() > output_len || result.len() > i32::MAX as usize {
        return -1;
    }
    std::slice::from_raw_parts_mut(output, output_len)[..result.len()].copy_from_slice(&result);
    result.len() as i32
}
