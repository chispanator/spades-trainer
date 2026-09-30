# IPTV Player for LG webOS

A lightweight Xtream Codes IPTV player you sideload onto an LG TV. You enter your server URL, username
and password on the TV (they're stored only in the TV's local storage — never in this repo).

Features:

- **Live TV** with channel logos, now/next guide info, and ▲▼ / CH± zapping in the player
- **Movies** and **Series** (seasons → episodes) with resume-where-you-left-off and auto-play of the next episode
- **Search** within each section (accent-insensitive), **favorites** (Red button)
- **Info** tab: account status/expiry and diagnostics showing exactly what the server returned
- Works with the remote's D-pad, the Magic Remote pointer, and a keyboard

## Why titles go missing in other players (and what this app does)

| Cause | This app |
|---|---|
| Player loads each category separately and skips titles whose category isn't in the list | Loads the **full** list in one request and puts orphans under **Uncategorized** |
| Title belongs to several categories (`category_ids`) and only the first is used | Shows it in **every** listed category |
| Server omits some titles from the full list but returns them per-category | **Info → Deep scan** requests each category individually and merges anything extra |
| Full list is too big and times out | Falls back automatically to per-category loading |
| Player hides "adult"/hidden categories or empty ones | Nothing is filtered |

Compare the **Unique titles** count on the Info tab with what your other player shows.

## Install on the TV (Developer Mode)

1. Create a free account at <https://webostv.developer.lge.com>.
2. On the TV, install **Developer Mode** from the LG Content Store, sign in, turn **Dev Mode Status** on
   (TV reboots), then open it again and turn on **Key Server**. Note the IP and passphrase it shows.
3. On your computer (Node.js required):
   ```sh
   npm install -g @webos-tools/cli
   ares-setup-device            # add → name: tv, IP: <TV IP>, port 9922, user prisoner
   ares-novacom --device tv --getkey   # enter the passphrase from the TV
   ```
4. Build and install:
   ```sh
   cd iptv-webos
   npm run package       # → dist/com.homebrew.iptvplayer_1.0.0_all.ipk
   npm run install-tv
   npm run launch
   ```
5. Debug with Chrome DevTools on the TV: `npm run inspect`.

**Dev Mode expires after ~50 hours** — open the Developer Mode app and press **Extend** now and then, or
the app is removed. If your TV's firmware supports it, the Homebrew Channel (via RootMyTV) avoids this.

## Remote controls

| Where | Keys |
|---|---|
| Browsing | Arrows move · OK opens · Back goes up a level · CH± pages through the grid (or jumps 10 categories) · **Red** toggles favorite |
| Live player | ▲▼ or CH± change channel · OK shows info · Back exits |
| Movie/episode player | ◀▶ ±10 s · ▲▼ ±1 min · OK play/pause · CH± next/previous episode · Back exits |

If a live channel won't play, the app retries it in the other format automatically; you can also switch the
default on **Info → Live format** (M3U8 ↔ TS).

## Develop in a desktop browser

```sh
node dev/mock-server.js
# open http://localhost:8787  — server: localhost:8787, user: test, pass: test
```

The mock server serves the app plus a fake Xtream API seeded with the problem cases above (orphaned,
multi-category, and per-category-only titles). Escape/Backspace act as the remote's Back button, `F` as Red.
Real streams need a server that sends CORS headers when testing from a browser; a packaged TV app usually isn’t subject to this.

**Interactive mockup:** `node dev/mockup/build.js` writes `dist/mockup.html`, a single page that runs the real app
with fake data and an on-screen remote.

The code avoids features newer than Chrome 53 (webOS 4.x) — no `async/await`, `?.`, `??` or object spread.
