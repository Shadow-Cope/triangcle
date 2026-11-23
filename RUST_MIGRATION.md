# Rust migration

Triancle must remain playable in both a browser and the desktop app. Migrate in
small, testable stages, keeping the existing game working while each replacement
is developed. Review changes locally before pushing to GitHub.

1. **Shared calculations (complete):** port self-contained movement calculations
   into `rust/triancle-core`, with tests against the existing behavior. The first
   calculation is `approach` from `js/game/physics.js`. The opt-in bridge now
   uses it in the game; JavaScript remains the default and fallback.
2. **Browser bridge (complete):** the movement calculation can now run as
   WebAssembly behind an opt-in switch. The JavaScript calculation remains the
   default and fallback. Test movement in both browser and desktop before making
   Rust the default.
3. **Player physics (complete):** input direction, velocity approach, and box
   and sphere overlap checks and axis collision response run in Rust when the bridge is enabled. Continue migrating movement, remaining collision response and
   climbing incrementally: animation easing, ladder movement and ledge shimmy
   calculations now use Rust when enabled; climb state and transitions remain
   in JavaScript. Preserve fixed-step behavior and test each
   feature in both environments. Keep Three.js rendering in place initially.
   The live `js/game.bundle.js` contains newer collision and climbing behavior
   than `js/game/physics.js`; use the live bundle as the behavior baseline.
4. **Other game systems (complete and approved):** the opt-in Rust core handles
   custom-map extraction for supported binary chunks, tilted-part collision
   geometry, built-part physics and manipulation, detached avatar debris physics,
   local and remote avatar
   animation, avatar colours and accessory positioning, network snapshot
   normalization, catalog filtering, item actions and edit checks, purchase
   error classification, inventory transformations, worn-item validation and clothing
   replacement decisions, friendship and badge grouping transformations,
   badge ordering, camera aim and positioning, chat/name processing, account
   input, rename checks, badge permissions and error classification, UGC upload
   planning, file signatures, upload and listing fee previews, custom-game
   metadata validation and building permissions, username and
   item-ID validation, and display-only fee calculations. Unsupported input
   falls back to JavaScript. Browser UI, Three.js rendering and Supabase
   requests remain in JavaScript. The account, social, inventory and UGC rule
   paths have mocked comparisons against the existing behavior. Debris physics
   has browser comparisons against the JavaScript simulation. Logged-in browser
   flows, real Roblox map files and the desktop app were covered by the phase review.
5. **Optional server (completed):** the supported static server and WebSocket
   relay now run in `rust/triancle-server`, retaining the existing public-file rules,
   cache behavior, health check, message protocol, keepalive and one-megabyte limit.
   `npm start` and the optional Render Web Service use Rust. The Node implementation
   remains available as `npm run start:node` during the transition. Supabase
   multiplayer remains a separate, unchanged path.
6. **Desktop shell:** evaluate and migrate Electron to Tauri after the web build
   is stable. Verify deep links, updates, single-instance behavior, installers,
   and browser play before replacing the existing app.

The later stages are a roadmap, not a claim that every JavaScript dependency can
be removed. Their order can change after testing and review.

## Test the first Rust component

Install Rust and run:

```sh
cd rust/triancle-core
cargo test
```

The current instructions for running the game and Rust server are in `README.md`.

## Try the WebAssembly bridge

Run the site over HTTP as described in the README. In the browser developer
console, enter `localStorage.setItem('triancleRustPhysics', '1')` and reload.
`window.TriancleRust.status` reports `loading`, `ready`, or `unavailable`.
Remove the setting with `localStorage.removeItem('triancleRustPhysics')` and
reload to return to JavaScript. Storage is separate for each browser and the
desktop app's webview. The switch enables the Rust-backed calculations and data
transformations listed in the stages above, with JavaScript fallback when the
bridge cannot handle an input. Depenetration, climb state, browser APIs, network
operations and rendering remain in JavaScript.

The built `js/core/triancle_core.wasm` is included so static hosts and the
existing desktop app can load it without a build on deployment. After changing
the Rust code, rebuild it from the repository root (requires the Rust target):

```sh
rustup target add wasm32-unknown-unknown
cargo build --manifest-path rust/triancle-core/Cargo.toml --release --target wasm32-unknown-unknown
# Copy rust/triancle-core/target/wasm32-unknown-unknown/release/triancle_core.wasm
# to js/core/triancle_core.wasm, then change the version in rust-bridge.js
# to prevent stale browser caches.
node rust/test-bridge.cjs
```

With the local server running, `node rust/test-browser.cjs` also runs a smoke
test in an isolated temporary Edge profile. Set `TRIANCLE_TEST_BROWSER` to an
Edge executable if it is not installed in its default Windows location.

Electron loads the hosted website, so its bridge and WASM must be deployed with
the website. The automated bridge test does not replace manual play testing in
the browser and desktop app.
