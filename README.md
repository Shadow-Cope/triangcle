# Triancle

Roblox-style 3D game site. Plain HTML/CSS/JavaScript + Three.js, with Supabase for accounts, saving and
multiplayer. **No build step** - the repo root is the site.

## Layout

```
index.html            page markup + the <script> list (load order lives here)
css/                  base, popups, theme, menu, chat, social, shop
js/
  data/               generated data (player model, Sharknado map)
  core/               config, renderer, network, input, camera, main loop, start-up (main.js)
  game/               world, character, names/tags, physics, reset, animation, build tools
  ui/                 colours, account/login, home + games, custom games (.rbxl), owner games, tabs,
                      avatar preview, menu, chat window, faces, players page
  social/             profiles, friends, badges, owner page
  items/              UGC upload, wallet, item models, inventory, shop, item page, selling
assets/               logo, game images, face/badge images, stud textures, crosshair
server.js             optional Node server (static files + WebSocket relay) - see Deploy
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

Use any static server (images are real files now, so opening `index.html` straight from disk won't load
textures):

```
node server.js          # http://localhost:3000
# or: python3 -m http.server 8000
```

## Deploy

- **GitHub**: push the folder as-is. GitHub Pages works from the repo root (`.nojekyll` is included).
- **Render, Static Site** (recommended with Supabase): New > Static Site > connect the repo, build command
  empty, publish directory `.` - or just use `render.yaml`.
- **Render, Web Service** (own multiplayer server): runtime Node, start command `node server.js`. Leave the
  Supabase fields empty in `config.js`, and either leave `SERVER_URL` empty (same host) or set it to
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

## Desktop app (Windows + macOS)

Games now start only in the Triancle desktop app. In a browser, **Play** tries to open the app (`triancle://join/<game>`) and shows a
download prompt if nothing opens; `download.html` is the download page. The app itself lives in `desktop/` (Electron) and is built for
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

- **Settings tab**: change your display name (free) or your username (150 Triangcles each time, charged inside Supabase by `change_username()`). Old usernames are kept in `username_history` and shown on the player's profile. Nobody can take an old username, and you log in with your current one (`login_email_for()`).
- **Building tools per game**: Owner tab > each game > *Building tools*: Everyone / Admins & Owner only / Off. Stored in `game_settings.btools`; checked in `js/game/btools.js` (`canBuild()`).


## Owner tools (update)
- Anyone with the **Owner** badge can use the Owner tab, not just the Owen account (Owen still works). Run `supabase_owner_tools.sql` once in Supabase so the database agrees.
- **Upload a new face** (Owner tab): pick a picture, name, price and description. It becomes a Catalog face automatically.
- **Edit Catalog items** (Owner tab): search any item, clothing or face and change its name, description, price and on-sale status.
- **Games** now have an editable description (shown on the game's About tab).
