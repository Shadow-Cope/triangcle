# Triangle

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

UGC creators can now make clothes as well as 3D accessories. In the UGC tab pick **Type: Shirt or Pants**, press
**Template** to download the guide, paint over it, and upload the PNG (640 x 512, or exactly 2x that; max 2 MB).

- Template regions: Torso `(0,0,384,256)`, right arm / right leg `(384,0,256,256)`, left arm / left leg `(384,256,256,256)`.
  Each region is a cross: right | front | left | back, with top above and bottom below the front. Transparent pixels show the body colour.
- Shirt = torso + both arms. Pants = both legs + the bottom strip of the torso. Shirt draws over pants.
- You can wear one shirt and one pants at a time (wearing a new one takes the old one off); accessories still stack up to 6.
- Stored like any item: `ugc_items.attach` is `Shirt` / `Pants` and `file_path` is a `.png` in the `ugc` bucket, so buying, selling,
  the Shop, inventory and the item page all work unchanged. Run `supabase_clothing.sql` once.
- Code: `js/game/character.js` (UVs, `setAvatarCloth`), `js/items/item-models.js` (loading / thumbnails), `js/items/ugc.js` (editor).
