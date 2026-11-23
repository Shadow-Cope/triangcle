"use strict";

/* Desktop app settings used by the website (the download page and the "Play" prompt). */
const APP_CFG = {
  // Where the installers are hosted. With the included GitHub workflow that's your latest release:
  //   "https://github.com/<you>/<repo>/releases/latest/download/"
  // Leave empty until the first release exists (buttons then say downloads aren't published yet).
  RELEASES_URL: "https://github.com/Shadow-Cope/triangcle/releases/latest/download/",
  WIN_FILE: "Triancle-Setup.exe",
  MAC_FILE: "Triancle-mac.dmg",
  STUDIO_WIN_FILE: "Triancle-Studio-Setup.exe",
  STUDIO_MAC_FILE: "Triancle-Studio-mac.dmg",
  MAC_AVAILABLE: false,
  STUDIO_MAC_AVAILABLE: false,
  VERSION: "1.0.7",
  // true  = games only start inside the desktop app (the browser shows the download / open prompt)
  // false = browser play works again (handy while you're still building the app)
  REQUIRE_APP: true,
};
