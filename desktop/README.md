# Triancle desktop app (Windows + macOS)

The app is your website in its own window (Electron). It tells the site "you're in the app", which unlocks the Play button,
and it opens `triancle://join/<gameId>` links - that's how the website's Play button launches a game here.

## One-time setup
1. Host your website (Render etc.) and put its address in `desktop/config.json` -> `siteUrl`
   (or set a repo variable `SITE_URL`, see below).
2. In `js/core/app-config.js` set `RELEASES_URL` to your GitHub releases link, e.g.
   `https://github.com/<you>/<repo>/releases/latest/download/` (after the first release exists).

## Build the installers (recommended: GitHub does it for you)
- Repo Settings -> Secrets and variables -> Actions -> **Variables** -> add `SITE_URL` (your site address).
- `git tag v1.0.0 && git push --tags` -> the "Build desktop app" workflow builds on Windows **and** macOS runners and attaches
  `Triancle-Setup.exe` and `Triancle-mac.dmg` to a GitHub Release. The download page links to them.
- Or run it by hand from the Actions tab; the files show up as downloadable artifacts.

## Build / try it on your own computer
```
cd desktop
npm install
npm start -- --url=http://localhost:3000     # run against your local site (Rust server)
npm run dist:win                             # on Windows -> dist/Triancle-Setup.exe
npm run dist:mac                             # on a Mac   -> dist/Triancle-mac.dmg  (Apple Silicon + Intel)
```
(Windows installers can't be built on a Mac, and the Mac build needs a Mac - that's why the CI workflow uses both.)

## Good to know
- **Not code-signed yet**, so Windows shows "Windows protected your PC" (More info -> Run anyway) and macOS needs right-click -> Open.
  The download page explains both. For public players, get a Windows code-signing certificate and an Apple Developer ID and add the
  secrets listed in `.github/workflows/build-desktop.yml`.
- The app loads your live site, so website updates reach everyone immediately; you only rebuild the app to change the shell itself.
- `triancle://` links work once the app has been opened at least once after installing.
- The "must use the app" rule is enforced in the page, so it keeps normal players on the app but can't stop someone who edits the page.
  Set `REQUIRE_APP: false` in `js/core/app-config.js` to allow browser play again (handy while building).
- Electron should stay on a currently supported major version: bump `electron` in `desktop/package.json` every so often.
