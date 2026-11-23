# Triancle

Roblox-style 3D game site. Plain HTML/CSS/JavaScript + Three.js, a Rust/WebAssembly game core, and
Supabase for accounts, saving and multiplayer. The frontend has no bundling step - the repo root is the site.

## Layout

```
index.html            page markup + the <script> list (load order lives here)
studio.html           Triancle Studio home + editor (own small page, plain scripts)
css/                  base, popups, theme, menu, chat, social, shop, studio
js/
  data/               generated data (player model, Sharknado map)
  core/               config, renderer, network, input, camera, main loop, start-up (main.js)
  game/               world, character, names/tags, physics, reset, animation, build tools
  studio/             Studio saved games, editor viewport (baseplate + fly camera), home screen
  ui/                 colours, account/login, home + games, custom games (.rbxl), owner games, tabs,
                      avatar preview, menu, chat window, faces, players page
  social/             profiles, friends, badges, owner page
  items/              UGC upload, wallet, item models, inventory, shop, item page, selling
assets/               logo, game images, face/badge images, stud textures, crosshair
rust/
  triancle-core/      browser game logic compiled to WebAssembly
  triancle-server/    supported static-file server + WebSocket relay
server.js             legacy Node server fallback
render.yaml           Render blueprint (static site by default)
```

## How the JS files fit together

They are plain scripts, not ES modules: all files share one global scope, exactly like the old single
`<script>`. That keeps every Supabase / Three.js call working as before.

- **Order matters.** Files load in the order listed in `index.html`. A file may use things from earlier
  files immediately, and from later files only inside functions that run later (clicks, timers, etc.).
- **Anything that starts async work at load goes in `js/core/main.js`** (login check, game list, graphics
  level, first frame). It loads last so every other file already exists.
- New file? Create it under `js/...` and add a `<script src>` line to `index.html` in the right place.

## Config

`js/core/config.js` holds `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ROOM`, physics numbers, etc. The anon key is
public by design; keep access rules in Supabase RLS. The SQL setup files (`supabase*.sql`) are separate from
this folder - keep them in the repo as before.

## Run locally

Install Rust, then start the supported static-file and WebSocket server:

```
npm start               # release build, http://localhost:3000
# or, while developing:
npm run dev
```

`PORT` and `HOST` are supported. `TRIANCLE_ROOT` can point at the site directory when the binary is
started from somewhere other than the repository root. `npm run start:node` keeps the old Node server
available as a temporary fallback; it is no longer the default.

## Deploy

- **GitHub**: push the folder as-is. GitHub Pages works from the repo root (`.nojekyll` is included).
- **Render, Static Site** (recommended with Supabase): New > Static Site > connect the repo, build command
  empty, publish directory `.` - or just use `render.yaml`.
- **Render, Web Service** (own multiplayer server): use the commented Rust service in `render.yaml`. Leave
  the Supabase fields empty in `config.js`, and either leave `SERVER_URL` empty (same host) or set it to
  `wss://your-app.onrender.com`.
- **Netlify** and similar: publish directory is the repo root, no build command.

## Clothing UGC (Shirts / Pants)

UGC creators can make clothes as well as 3D accessories. In the UGC tab pick **Type: Shirt or Pants**, download a template
(**Template** = the branded one, **Transparent** = just thin cell outlines on a clear background, **Labeled guide** = every
face marked U/D/F/B/L/R), paint in the cells, and upload the PNG (512 x 512, or any square from 256 to 2048; max 2 MB).
Transparent pixels show the body colour.

- Templates live in `assets/templates/` (`shirt-*.png`, `pants-*.png`). The cell rectangles used by the game are `CLOTH_CELLS`
  in `js/game/character.js` - if you redraw the templates, update those numbers to match.
- Layout: the torso is the cross at the top; the bottom-left cross is the avatar's **right** arm / leg (R F L B) and the bottom-right
  cross is the **left** arm / leg (B R F L). F = front, B = back, R / L = the avatar's own right / left side, U = top, D = bottom.
- Shirt = torso + both arms. Pants = both legs + the bottom strip of the torso. Shirt draws over pants.
- You can wear one shirt and one pants at a time (wearing a new one takes the old one off); accessories still stack up to 6.
- Stored like any item: `ugc_items.attach` is `Shirt` / `Pants` and `file_path` is a `.png` in the `ugc` bucket, so buying, selling,
  the Shop, inventory and the item page all work unchanged. Run `supabase_clothing.sql` once.
- Code: `js/game/character.js` (UVs, shader, `setAvatarCloth`), `js/items/item-models.js` (loading / thumbnails), `js/items/ugc.js` (editor).

## Triancle Studio (first version)

Studio is a second desktop app for making games. `studio.html` is its own page, so it also opens in a browser
while you're building.

**Access:** you must sign in with a normal Triancle account (accounts are still created on the main website).
Only players with the **Alpha Publisher** badge can open Studio:

> You need alpha publisher to use Triancle Studio, submit creations on the discord server to apply for alpha publisher

The badge is a built-in badge (`alpha`, `assets/badges/alpha.png`), so it appears in the Owners' badge buttons,
the Players filter and profiles. The Owner grants it from **Owner tab > player row > Alpha Publisher**. The badge
also carries `can_publish` for future publishing tools.

The first version has:

- **Your games** - create a game (name + Baseplate template), then see every saved game as a card with a viewport
  thumbnail. Click a card to edit, or the ⋮ menu to delete. Games are kept in `localStorage`
  (`triangle_studio_games`); cloud saving and publishing come later.
- **Editor** - a Studio-style shell with a File/Edit/View/Test/Help menu, Home ribbon, Explorer + Properties dock
  and status bar. The viewport holds a 512 × 512 gray baseplate using the project's `stud.png` top / `inlet.png`
  bottom textures, a sky and sun, plus a 3D orientation gizmo.
  - **Tools**: Select, Move, Scale and Rotate work on the selected part with coloured 3D handles. **Part** inserts a
    new part in front of the camera; the **Shape** picker beside it chooses what the Part tool inserts, and Properties
    has a **Shape** row to change an existing part: Part (block), Ball, Cylinder, Wedge and Corner wedge.
    `Delete` removes the selected part.
  - **Properties**: name, shape, position, size, orientation, colour, material (plastic, smooth plastic, metal, neon,
    glass), texture (studs, inlet, smooth), transparency, anchored and can-collide are editable. Changes sync
    with the gizmos and are saved into the game map.
  - **Panels**: drag the bar on the left of the dock to resize Explorer/Properties, drag the bar between them to
    change their heights, drag the Properties header into the viewport to float it (drag it back over the dock to
    re-dock, or use the dock button). View > Reset panel layout restores the defaults. Sizes and float position
    are remembered on the device.
  - **Camera**: `WASD` move, right-drag look, middle-drag pan, `Q`/`E` down/up, wheel zoom, `Shift` faster.
    `Ctrl+S` / File > Save stores the game and refreshes its card thumbnail; Help > Camera controls lists them all.
  - **Play testing**: **Play** (Home ribbon, Test > Play game, or `F5`) runs the real game on the map you built:
    the Studio viewport shows `index.html?playtest=1`, the same bundle the website ships, so the avatar, skin,
    physics (240 Hz), camera, shift lock, climbing, reset (`R`) and name tags are exactly the live game.
    **Play here** (`Shift+F5` / Test > Play here) starts you where the Studio camera is instead of at the spawn.
    **Stop** (next to Play in the Home ribbon, or `Esc`) goes back to editing with the camera where you left it.
    The editor keeps its normal layout while you play; only the viewport is replaced by the game.
    The playtest reuses the Supabase session you signed in to Studio with, so it wears your real profile:
    body colours, face and the shirt/pants/accessories you have equipped (`player_profiles.body_colors`
    plus `ugc_inventory`). Chat, the home screen and multiplayer are skipped (`NET.status = offline`);
    the map is handed to the game through `sessionStorage` (`triangle_studio_playtest`), and the two pages
    talk with `postMessage`.

Code: `css/studio.css`, `js/studio/auth.js` (sign-in + Alpha Publisher gate), `js/studio/store.js` (saved games),
`js/studio/ui.js` (Studio dialogs), `js/studio/editor.js` (Three.js viewport/camera/tools/panels),
`js/studio/play.js` (embeds the real game for play tests), `js/studio/menu.js` (home screen),
`js/core/playtest.js` (the `?playtest=1` boot that skips accounts/home/multiplayer). The game part rows match the
normal map format (with extra Studio-only values at the end for material/texture/name), so a later Studio version
can publish straight into `custom_games`.

## Database (Supabase) setup

The repo can build a brand-new Supabase project from scratch: run, in this order, in the
**SQL editor** of the new project:

1. `supabase_schema.sql` - every table, RPC, policy, storage bucket and the built-in badges.
2. `supabase_publish.sql` - publishing fields (`description`, `max_players`, …). This file ends with
   `delete from custom_games;`; run it once, then delete that line so re-running the file doesn't wipe games.
3. `supabase_clothing.sql` - clothing values for `ugc_items.attach` and PNG uploads.

Then in **Authentication**: turn **Confirm email** off (the site signs up as
`<username>@players.bounded.app`, so no confirmation mail can ever arrive), and set the Site URL.
Put the project URL and publishable/anon key in `js/core/config.js`. Sign up on the site, then give
yourself the badges in the SQL editor:

```sql
insert into badges (user_id, badge)
select id, 'alpha' from player_profiles where username = 'YOUR_NAME';
-- plus 'owner' and 'admin' for the Owner tab and the game/badge tools
```

## Publishing to Triancle (Studio > File > Publish to Triancle)

Studio games are drafts on the device; publishing puts the map on the website.

1. Run `supabase_publish.sql` once in the Supabase SQL editor. It adds `description`, `max_players`,
   `updated_at` and `created_by` to `custom_games`, adds policies so players can publish and update only
   their own games, and (one time) deletes every game published so far. Remove the last `delete from
   custom_games;` line after running it, or re-running the file would wipe the new games too.
2. In Studio, sign in (Alpha Publisher, as before), open a game and use **File > Publish to Triancle…**.
   You get a name, a description and **max players per server** (1-100). Publishing again from the same
   Studio game updates the same row instead of making a duplicate.
3. The website lists it with the other games; the game page shows the description and "1 – N" players.
   When a server is already at the cap, a joining player is sent back with "This server is full".

Until the SQL is run, publishing still works but only the basics are saved (name, owner, map, thumbnail);
Studio tells you when that happened. Nothing is deleted from the website by publishing - it only adds or
updates the one game you are publishing.

Every part property now carries into the game: colour, shape (ball, block, cylinder, wedge, corner wedge),
material (plastic, smooth plastic, metal, neon, glass), texture (studs, inlet, smooth), transparency and
can-collide. Wedges get a stepped collider that follows the slope, so ramps can be walked up.

## Desktop app (Windows + macOS)

Games now start only in the Triancle desktop app. In a browser, **Play** tries to open the app (`triancle://join/<game>`) and shows a
download prompt if nothing opens; `download.html` is the download page. The app itself lives in `desktop/` (Tauri + Rust) and is built for
Windows and macOS by `.github/workflows/build-desktop.yml`. Setup steps: `desktop/README.md`.

- `js/core/app-config.js` - installer links and the `REQUIRE_APP` switch.  `js/core/app.js` - app detection, Play gate, prompt, `?join=` links.
- Share links like `https://yoursite/?join=baseplate` open the app (or the download prompt) for that game.


## Catalog faces, owner tools, badges (supabase_catalog.sql)

Run `supabase_catalog.sql` once in the Supabase SQL editor, then log in as the Owner:

1. **Owner tab > Catalog faces > "Add faces to the Catalog"** puts every face from `FACE_BUILTIN` (js/game/character.js)
   in the Catalog and lets players who already wore an old face keep it. Press it again after adding a face there.
   To add a new face: drop a 256x256 transparent PNG in `assets/faces/`, add a line to `FACE_BUILTIN`, press the button.
2. **Any Catalog item page** shows *Owner tools* to the Owner (or a badge with "Can edit and delete Catalog items"):
   name, description, price, on/off sale, delete.
3. **Owner tab > Badges** makes new badges (picture + name + what they allow). Give them out from the player list above.
   "Can upload and sell UGC" works like the Official UGC Creator badge; "Can edit and delete Catalog items" works like Owner for items.

Faces are Catalog items (`ugc_items.attach = 'Face'`) with a number in `face_meta`; the number is what `body_colors.face` stores.

## Account settings, username changes, building tools (supabase_account.sql)

Run `supabase_account.sql` once in the Supabase SQL editor (check the wallet table names at the top first).

- **Settings tab**: change your display name (free) or your username (150 Shapes each time, charged inside Supabase by `change_username()`). Old usernames are kept in `username_history` and shown on the player's profile. Nobody can take an old username, and you log in with your current one (`login_email_for()`).
- **Building tools per game**: Owner tab > each game > *Building tools*: Everyone / Admins & Owner only / Off. Stored in `game_settings.btools`; checked in `js/game/btools.js` (`canBuild()`).


## Owner tools (update)
- Anyone with the **Owner** badge can use the Owner tab, not just the Owen account (Owen still works). Run `supabase_owner_tools.sql` once in Supabase so the database agrees.
- **Upload a new face** (Owner tab): pick a picture, name, price and description. It becomes a Catalog face automatically.
- **Edit Catalog items** (Owner tab): search any item, clothing or face and change its name, description, price and on-sale status.
- **Games** now have an editable description (shown on the game's About tab).

## Shapes, one-at-a-time and auto-update (update)
- The currency is now called **Shapes** with the new icon (`assets/img/shapes.png`).
- Only one Triancle tab/window can be open per browser, and one signed-in account can only play in one place at a time (run `supabase_owner_tools.sql` once for the account part). The desktop app also only runs one copy.
- The update check in `js/game.bundle.js` runs every 45 seconds. The website refreshes itself; the desktop app shows a "Restart Triancle for the new update" box with only a Close button.

## Taxes, fees and notifications

Run `supabase_taxes.sql` once in Supabase (after `supabase_catalog.sql` and `supabase_owner_tools.sql`). First make an account named
`THETriancleTaxer` - it gets 20% of every sale (the maker gets 80%). Uploading costs 5 Shapes (clothes) / 150 (accessories); putting an item
on sale or changing its price costs 15% of the new price. Prices: clothes 5-1,000,000, accessories 50-1,000,000. The SQL also charges existing
items once, never takes a balance under 0, and sends the maker a notification (bell in the home header, red badge, "9+" max).
