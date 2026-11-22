"use strict";

/* Desktop app settings used by the website (the download page and the "Play" prompt). */
const APP_CFG = {
  // Where the installers are hosted. With the included GitHub workflow that's your latest release:
  //   "https://github.com/<you>/<repo>/releases/latest/download/"
  // Leave empty until the first release exists (buttons then say downloads aren't published yet).
  RELEASES_URL: "https://triangcle.onrender.com/download.html",
  WIN_FILE: "Triancle-Setup.exe",
  MAC_FILE: "Triancle-mac.dmg",
  VERSION: "1.0.4",
  // true  = games only start inside the desktop app (the browser shows the download / open prompt)
  // false = browser play works again (handy while you're still building the app)
  REQUIRE_APP: true,
};
