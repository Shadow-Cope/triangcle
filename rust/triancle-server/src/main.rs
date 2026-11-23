use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs,
    io::{self, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

const MAX_MESSAGE: usize = 1024 * 1024;
const MAX_REQUEST: usize = 64 * 1024;
const WEBSOCKET_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

#[derive(Clone)]
struct Player {
    id: String,
    writer: Arc<Mutex<TcpStream>>,
    joined: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    details: Arc<Mutex<PlayerDetails>>,
}

#[derive(Default)]
struct PlayerDetails {
    name: String,
    colors: Option<Value>,
    items: Option<Value>,
    state: Option<Value>,
}

type Players = Arc<Mutex<HashMap<String, Player>>>;

fn main() -> io::Result<()> {
    let port = env::var("PORT").unwrap_or_else(|_| "3000".into());
    let address = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let root = env::var_os("TRIANCLE_ROOT")
        .map(PathBuf::from)
        .unwrap_or(env::current_dir()?);
    let listener = TcpListener::bind(format!("{address}:{port}"))?;
    let players: Players = Arc::new(Mutex::new(HashMap::new()));
    let next_id = Arc::new(AtomicU64::new(1));
    spawn_keepalive(players.clone());
    println!("Triancle Rust server on http://localhost:{port}");
    for connection in listener.incoming() {
        let Ok(stream) = connection else { continue };
        let players = players.clone();
        let next_id = next_id.clone();
        let root = root.clone();
        thread::spawn(move || {
            if let Err(error) = handle_connection(stream, &root, players, next_id) {
                eprintln!("connection error: {error}");
            }
        });
    }
    Ok(())
}

fn handle_connection(
    mut stream: TcpStream,
    root: &Path,
    players: Players,
    next_id: Arc<AtomicU64>,
) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    let request = read_headers(&mut stream)?;
    let text = std::str::from_utf8(&request)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "request is not UTF-8"))?;
    let mut lines = text.split("\r\n");
    let Some(line) = lines.next() else {
        return Ok(());
    };
    let mut request_line = line.split_whitespace();
    let method = request_line.next().unwrap_or("");
    let target = request_line.next().unwrap_or("");
    let headers: HashMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    let websocket = headers
        .get("upgrade")
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    if websocket {
        return upgrade(stream, headers, players, next_id);
    }
    serve_http(&mut stream, root, method, target, &headers)
}

fn read_headers(stream: &mut TcpStream) -> io::Result<Vec<u8>> {
    let mut request = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..count]);
        if request.windows(4).any(|part| part == b"\r\n\r\n") {
            break;
        }
        if request.len() > MAX_REQUEST {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request is too large",
            ));
        }
    }
    Ok(request)
}

fn serve_http(
    stream: &mut TcpStream,
    root: &Path,
    method: &str,
    target: &str,
    headers: &HashMap<String, String>,
) -> io::Result<()> {
    let path = target.split('?').next().unwrap_or(target);
    let Some(decoded) = percent_decode(path) else {
        return response(
            stream,
            400,
            "Bad Request",
            &[("Content-Type", "text/plain")],
            b"",
            false,
        );
    };
    if decoded == "/healthz" {
        return response(
            stream,
            200,
            "OK",
            &[("Content-Type", "text/plain")],
            b"ok",
            method == "HEAD",
        );
    }
    let requested = if decoded == "/" {
        "index.html"
    } else {
        decoded.trim_start_matches('/')
    };
    let Some(relative) = public_path(requested) else {
        return response(
            stream,
            404,
            "Not Found",
            &[("Content-Type", "text/plain")],
            b"Not found",
            method == "HEAD",
        );
    };
    let file = root.join(relative);
    let Ok(data) = fs::read(&file) else {
        return response(
            stream,
            404,
            "Not Found",
            &[("Content-Type", "text/plain")],
            b"Not found",
            method == "HEAD",
        );
    };
    let digest = hex(&sha1(&data));
    let etag = format!("\"{}\"", &digest[..20]);
    if headers.get("if-none-match") == Some(&etag) {
        return response(stream, 304, "Not Modified", &[("ETag", &etag)], b"", true);
    }
    let extension = file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = mime(&extension);
    let cache = if matches!(extension.as_str(), "html" | "js" | "css") {
        "no-cache"
    } else {
        "public, max-age=3600"
    };
    response(
        stream,
        200,
        "OK",
        &[
            ("Content-Type", mime),
            ("ETag", &etag),
            ("Cache-Control", cache),
        ],
        &data,
        method == "HEAD",
    )
}

fn response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    head: bool,
) -> io::Result<()> {
    write!(stream, "HTTP/1.1 {status} {reason}\r\n")?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(
        stream,
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    if !head {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn public_path(requested: &str) -> Option<PathBuf> {
    let normalized = requested.replace('\\', "/");
    let path = Path::new(&normalized);
    let mut components = path.components();
    let first = match components.next()? {
        Component::Normal(value) => value.to_str()?,
        _ => return None,
    };
    if !matches!(
        first,
        "index.html" | "download.html" | "css" | "js" | "assets"
    ) {
        return None;
    }
    if components.any(|part| !matches!(part, Component::Normal(_))) {
        return None;
    }
    Some(path.to_path_buf())
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = bytes.get(index + 1..index + 3)?;
            let text = std::str::from_utf8(pair).ok()?;
            output.push(u8::from_str_radix(text, 16).ok()?);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

fn mime(extension: &str) -> &'static str {
    match extension {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "json" => "application/json",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn upgrade(
    mut stream: TcpStream,
    headers: HashMap<String, String>,
    players: Players,
    next_id: Arc<AtomicU64>,
) -> io::Result<()> {
    let Some(key) = headers.get("sec-websocket-key") else {
        return stream.shutdown(Shutdown::Both);
    };
    let accept = base64(&sha1(format!("{key}{WEBSOCKET_GUID}").as_bytes()));
    write!(
        stream,
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    )?;
    stream.flush()?;
    stream.set_nodelay(true)?;
    stream.set_read_timeout(None)?;
    let id = next_id.fetch_add(1, Ordering::Relaxed).to_string();
    let player = Player {
        id: id.clone(),
        writer: Arc::new(Mutex::new(stream.try_clone()?)),
        joined: Arc::new(AtomicBool::new(false)),
        alive: Arc::new(AtomicBool::new(true)),
        details: Arc::new(Mutex::new(PlayerDetails::default())),
    };
    players.lock().unwrap().insert(id, player.clone());
    websocket_loop(&mut stream, &player, &players);
    remove_player(&player, &players);
    Ok(())
}

fn websocket_loop(stream: &mut TcpStream, player: &Player, players: &Players) {
    let mut fragmented: Option<(u8, Vec<u8>)> = None;
    loop {
        let Ok((fin, opcode, payload)) = read_frame(stream) else {
            break;
        };
        match opcode {
            0x8 => {
                let _ = send_frame(&player.writer, 0x8, &[]);
                break;
            }
            0x9 => {
                let _ = send_frame(&player.writer, 0xA, &payload);
            }
            0xA => {
                player.alive.store(true, Ordering::Relaxed);
            }
            0x1 | 0x2 => {
                fragmented = Some((opcode, payload));
                if fin {
                    let Some((kind, data)) = fragmented.take() else {
                        break;
                    };
                    if kind == 0x1 {
                        process_message(player, players, &data);
                    }
                }
            }
            0x0 => {
                let Some((_kind, data)) = fragmented.as_mut() else {
                    break;
                };
                if data.len().saturating_add(payload.len()) > MAX_MESSAGE {
                    break;
                }
                data.extend_from_slice(&payload);
                if fin {
                    let (kind, data) = fragmented.take().unwrap();
                    if kind == 0x1 {
                        process_message(player, players, &data);
                    }
                }
            }
            _ => break,
        }
    }
}

fn read_frame(stream: &mut TcpStream) -> io::Result<(bool, u8, Vec<u8>)> {
    let mut head = [0u8; 2];
    stream.read_exact(&mut head)?;
    let fin = head[0] & 0x80 != 0;
    let opcode = head[0] & 0x0f;
    if head[1] & 0x80 == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "client frame is not masked",
        ));
    }
    let mut length = u64::from(head[1] & 0x7f);
    if length == 126 {
        let mut extended = [0u8; 2];
        stream.read_exact(&mut extended)?;
        length = u64::from(u16::from_be_bytes(extended));
    } else if length == 127 {
        let mut extended = [0u8; 8];
        stream.read_exact(&mut extended)?;
        length = u64::from_be_bytes(extended);
    }
    if length > MAX_MESSAGE as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "message is too large",
        ));
    }
    let mut mask = [0u8; 4];
    stream.read_exact(&mut mask)?;
    let mut payload = vec![0u8; length as usize];
    stream.read_exact(&mut payload)?;
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index & 3];
    }
    Ok((fin, opcode, payload))
}

fn process_message(player: &Player, players: &Players, data: &[u8]) {
    let Ok(mut message) = serde_json::from_slice::<Value>(data) else {
        return;
    };
    let Some(kind) = message.get("t").and_then(Value::as_str).map(str::to_string) else {
        return;
    };
    if kind == "join" {
        if player.joined.swap(true, Ordering::Relaxed) {
            return;
        }
        let mut details = player.details.lock().unwrap();
        details.name = js_string_or_default(message.get("name"), "Player", 20);
        details.colors = message.get("colors").cloned();
        details.items = message.get("items").cloned();
        drop(details);
        let existing: Vec<Value> = players
            .lock()
            .unwrap()
            .values()
            .filter(|other| other.id != player.id && other.joined.load(Ordering::Relaxed))
            .map(player_json)
            .collect();
        send_json(
            player,
            &json!({"t":"welcome","id":player.id,"players":existing}),
        );
        let details = player.details.lock().unwrap();
        let joined = player_message("join", &player.id, &details);
        drop(details);
        broadcast(players, &player.id, &joined);
        return;
    }
    if !player.joined.load(Ordering::Relaxed)
        || !matches!(
            kind.as_str(),
            "s" | "died" | "parts" | "partdel" | "partreq" | "chat" | "name" | "colors"
        )
    {
        return;
    }
    if let Some(object) = message.as_object_mut() {
        object.insert("id".into(), Value::String(player.id.clone()));
    }
    {
        let mut details = player.details.lock().unwrap();
        if kind == "name" {
            details.name = js_string_or_default(message.get("name"), &details.name, 20);
        }
        if kind == "colors" {
            details.colors = message.get("colors").cloned();
        }
        if kind == "s" {
            details.state = Some(message.clone());
        }
    }
    broadcast(players, &player.id, &message);
}

fn js_string_or_default(value: Option<&Value>, default: &str, max: usize) -> String {
    let text = match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => default.to_string(),
        Some(Value::String(text)) if text.is_empty() => default.to_string(),
        Some(Value::Number(number)) if number.as_f64() == Some(0.0) => default.to_string(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(true)) => "true".to_string(),
        Some(Value::Number(number)) => js_number(number),
        Some(Value::Array(values)) => values
            .iter()
            .map(js_array_string)
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    };
    text.chars().take(max).collect()
}

fn js_number(number: &serde_json::Number) -> String {
    if let Some(value) = number.as_i64() {
        value.to_string()
    } else if let Some(value) = number.as_u64() {
        value.to_string()
    } else if let Some(value) = number.as_f64() {
        if value.fract() == 0.0 {
            format!("{value:.0}")
        } else {
            value.to_string()
        }
    } else {
        number.to_string()
    }
}

fn js_array_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(number) => js_number(number),
        Value::Array(values) => values
            .iter()
            .map(js_array_string)
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

fn player_message(kind: &str, id: &str, details: &PlayerDetails) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("t".into(), Value::String(kind.to_string()));
    object.insert("id".into(), Value::String(id.to_string()));
    object.insert("name".into(), Value::String(details.name.clone()));
    if let Some(colors) = &details.colors {
        object.insert("colors".into(), colors.clone());
    }
    if let Some(items) = &details.items {
        object.insert("items".into(), items.clone());
    }
    Value::Object(object)
}

fn player_json(player: &Player) -> Value {
    let details = player.details.lock().unwrap();
    let mut value = player_message("join", &player.id, &details);
    let object = value.as_object_mut().unwrap();
    object.remove("t");
    if let Some(state) = &details.state {
        object.insert("s".into(), state.clone());
    }
    value
}

fn send_json(player: &Player, value: &Value) {
    if let Ok(data) = serde_json::to_vec(value) {
        if data.len() <= MAX_MESSAGE {
            let _ = send_frame(&player.writer, 0x1, &data);
        }
    }
}

fn broadcast(players: &Players, sender: &str, value: &Value) {
    let recipients: Vec<Player> = players
        .lock()
        .unwrap()
        .values()
        .filter(|player| player.id != sender && player.joined.load(Ordering::Relaxed))
        .cloned()
        .collect();
    for player in recipients {
        send_json(&player, value);
    }
}

fn send_frame(writer: &Arc<Mutex<TcpStream>>, opcode: u8, payload: &[u8]) -> io::Result<()> {
    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x80 | opcode);
    match payload.len() {
        0..=125 => frame.push(payload.len() as u8),
        126..=65535 => {
            frame.push(126);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        _ => {
            frame.push(127);
            frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        }
    }
    frame.extend_from_slice(payload);
    let mut stream = writer.lock().unwrap();
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(&frame)?;
    stream.flush()
}

fn remove_player(player: &Player, players: &Players) {
    let removed = players.lock().unwrap().remove(&player.id).is_some();
    if removed && player.joined.load(Ordering::Relaxed) {
        broadcast(players, &player.id, &json!({"t":"leave","id":player.id}));
    }
}

fn spawn_keepalive(players: Players) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        let current: Vec<Player> = players.lock().unwrap().values().cloned().collect();
        for player in current {
            if !player.alive.swap(false, Ordering::Relaxed) {
                let _ = player.writer.lock().unwrap().shutdown(Shutdown::Both);
            } else {
                let _ = send_frame(&player.writer, 0x9, &[]);
            }
        }
    });
}

fn sha1(input: &[u8]) -> [u8; 20] {
    let mut data = input.to_vec();
    let bit_length = (data.len() as u64) * 8;
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_length.to_be_bytes());
    let mut h = [
        0x67452301u32,
        0xefcdab89,
        0x98badcfe,
        0x10325476,
        0xc3d2e1f0,
    ];
    for block in data.chunks_exact(64) {
        let mut words = [0u32; 80];
        for (index, part) in block.chunks_exact(4).enumerate() {
            words[index] = u32::from_be_bytes(part.try_into().unwrap());
        }
        for index in 16..80 {
            words[index] =
                (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                    .rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (index, word) in words.iter().enumerate() {
            let (f, k) = match index {
                0..=19 => ((b & c) | ((!b) & d), 0x5a827999),
                20..=39 => (b ^ c ^ d, 0x6ed9eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1bbcdc),
                _ => (b ^ c ^ d, 0xca62c1d6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (value, add) in h.iter_mut().zip([a, b, c, d, e]) {
            *value = value.wrapping_add(add);
        }
    }
    let mut output = [0u8; 20];
    for (index, value) in h.iter().enumerate() {
        output[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    output
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        output.push(TABLE[((value >> 18) & 63) as usize] as char);
        output.push(TABLE[((value >> 12) & 63) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[((value >> 6) & 63) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(value & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{base64, js_string_or_default, percent_decode, public_path, sha1};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn websocket_accept_example_matches_rfc() {
        assert_eq!(
            base64(&sha1(
                b"dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            )),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn only_public_paths_are_accepted() {
        assert_eq!(public_path("index.html"), Some(PathBuf::from("index.html")));
        assert_eq!(
            public_path("js/core/config.js"),
            Some(PathBuf::from("js/core/config.js"))
        );
        assert_eq!(public_path("../server.js"), None);
        assert_eq!(public_path("server.js"), None);
        assert_eq!(
            percent_decode("/%2e%2e/server.js").unwrap(),
            "/../server.js"
        );
    }

    #[test]
    fn names_follow_the_legacy_javascript_coercion() {
        assert_eq!(js_string_or_default(None, "Player", 20), "Player");
        assert_eq!(
            js_string_or_default(Some(&json!("")), "Player", 20),
            "Player"
        );
        assert_eq!(
            js_string_or_default(Some(&json!(0)), "Player", 20),
            "Player"
        );
        assert_eq!(js_string_or_default(Some(&json!(12.0)), "Player", 20), "12");
        assert_eq!(
            js_string_or_default(Some(&json!(["A", 2])), "Player", 20),
            "A,2"
        );
        assert_eq!(
            js_string_or_default(Some(&json!({"name":"A"})), "Player", 20),
            "[object Object]"
        );
        assert_eq!(
            js_string_or_default(Some(&json!("123456789012345678901")), "Player", 20),
            "12345678901234567890"
        );
    }
}
