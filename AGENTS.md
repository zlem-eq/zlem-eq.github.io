# AGENTS.md

Orientation for AI coding agents working in this repository. Read this before making changes.

## What this is

`zlem-eq.github.io` is a static utility site for an EverQuest guild (Bloodthirst, OpenDKP client `bt`), served by **GitHub Pages** from the `main` branch of `github.com/zlem-eq/zlem-eq.github.io`. Live at `https://zlem-eq.github.io/`.

There is **no build step, no bundler, no framework and no test suite**. Every file in the repo is published as-is, so a push to `main` is a deploy.

Three separate pieces of code share the repo:

| Piece | Where | Runtime |
|---|---|---|
| The website | `index.html`, `pages/`, `js/`, `css/` | Browser (vanilla JS, Firebase JS SDK from CDN) |
| Firebase Cloud Function | `functions/` | Node 24 on Firebase (project `everquest-guild-potions`) |
| GuildPotions in-game script | `GuildPotions/` (+ `GuildPotions.zip`) | Lua inside MacroQuest on the player's Windows PC |

## Repository map

```
index.html                 Landing page: tile grid linking to each tool
pages/                     One HTML file per tool (see "Tools" below)
js/                        Shared/page scripts (classic <script>, no modules)
  theme.js                 Light/dark toggle; every page loads it
  parser.js                Raid Item Log Parser UI (filtering, grouping, rendering)
  parse-worker.js          Web Worker: extracts loot lines from eqlog files
  loot-actions.js          OpenDKP auction creation + Discord delivery list (log parser page)
  raid-targets.js          Raid boss list, localStorage persistence, edit modal  -> window.RaidTargets
  raid-loot.js             Known raid-drop item names (lowercase)               -> window.RaidLootItems
  delivery-parser.js       Raid Item Delivery Confirmations UI
  delivery-parse-worker.js Web Worker: extracts parcel/trade lines from eqlog files
  spells.js                Per-class spell name arrays (BARD_SPELLS, CLERIC_SPELLS, ...) as globals
css/                       main.css (theme tokens, header, tiles) + one stylesheet per tool
functions/                 Firebase Cloud Functions (scheduled cleanup only)
GuildPotions/              Source of the MacroQuest Lua script (init.lua + gp_*.lua)
GuildPotions.zip           Distributed build of GuildPotions/ (downloaded from the Guild Potions page)
spells/*.txt               Raw HTML scraped from a spell-list site; reference material for js/spells.js
howtoimages/               Screenshots used by help modals on the log parser page
raid_loot.txt, raid_targets.txt   Plain-text source lists mirrored into js/raid-loot.js and js/raid-targets.js
bidding_results.txt        Sample "Item;DKP;Winner gratss" paste for testing the delivery list
getAllAuctions_OpenDKP_response.json  Sample OpenDKP auctions API response (reference)
firebase_config.txt        Firebase console setup snippet (reference only, not loaded by any page)
firebase.json, .firebaserc Firebase CLI config (functions only; hosting is GitHub Pages, not Firebase)
.claude/launch.json        Local preview server config (npx serve on port 5500)
.idea/, *.iml              JetBrains IDE files
```

## Tools (pages)

| Page | Purpose | Scripts / data |
|---|---|---|
| `raid-item-log-parser.html` | Load EQ log files (`eqlog_<Name>_<server>.txt`), list loot by mob and kill session, filter to raid targets/raid loot, export an OpenDKP loot string, create OpenDKP auctions, generate a Discord delivery list | `raid-targets.js`, `raid-loot.js`, `parser.js`, `parse-worker.js`, `loot-actions.js`; OpenDKP API |
| `raid-item-delivery-confirmations.html` | Parse parcel/trade lines from a log and build a Discord list of delivered items | `raid-loot.js`, `delivery-parser.js`, `delivery-parse-worker.js` |
| `guild-potions.html` | Potion order board: players order, officers manage makers/officers/catalog, makers fulfil; includes a potion ingredient calculator and the GuildPotions.zip download + README | Inline `<script type="module">`; Firestore |
| `guild-potions-import.html` | One-off bulk CSV import of orders from the guild's potion purchasing sheet (not linked from index) | Inline module; Firestore |
| `guild-spell-bank.html` | Guild spell inventory: import an EQ inventory dump, players claim spells, deliveries auto-detected from logs | `spells.js` + inline module; Firestore |
| `priority-queue-raffle.html` | Weekly weighted raffle; roster import from a guild dump; password-gated manage mode | Inline module + inline `<style>`; Firestore |
| `raid-winner-delivery-list.html` | Placeholder ("under construction"); not linked from index | — |

## Conventions

- **Vanilla JS only.** No npm packages in the site, no transpiling. Code in `js/` is ES5-ish IIFEs (`(function () { ... })();`) using `var`/`function`; inline page modules use modern ES (`const`, arrow functions, `async`). Match the style of the file you are editing.
- **Cross-file communication is via `window` globals**, so script order in each HTML file matters:
  - `window.RaidTargets`, `window.RaidLootItems`, `*_SPELLS` arrays are defined by data scripts that must load first.
  - `parser.js` exposes `window.reapplyFilter`, `window.excludeItem`, `window.getCheckedLoot`, `window.getSelectedTargets`, which `raid-targets.js` and `loot-actions.js` call.
- **Paths are relative.** Pages live in `pages/` and reference `../css/...`, `../js/...`, `../favicon.ico`. Workers are created with `new Worker('../js/<worker>.js')` (relative to the page).
- **Every page shares the same shell:** `<html data-theme="light">`, favicon links, `css/main.css`, a header with a `#theme-toggle` button (sun/moon spans), a back link `../index.html`, and `js/theme.js` loaded at the end of `<body>`. `theme.js` assumes `#theme-toggle` exists.
- **Theming** uses CSS custom properties defined in `css/main.css` (`--bg`, `--surface`, `--text`, `--text-muted`, `--border`, `--accent`, `--accent-hover`, ...) with a `[data-theme="dark"]` override. Use these tokens in new styles so dark mode works.
- **New tool:** add `pages/<tool>.html` using the shared shell, an optional `css/<tool>.css`, and a tile in `index.html`.
- **No cache busting** on script/style URLs. GitHub Pages and browsers may serve stale JS briefly after a deploy; a hard refresh fixes it.
- **Discord output:** item names are wrapped with `discordCode()` (double-backtick form when the name contains a backtick, e.g. ``Kelorek`Dar``) and free text with `discordEscape()`. Reuse these helpers.
- Commit messages in history are short, lowercase, informal (e.g. `fix raffle manage mode`). There is a `localchanges` branch besides `main`.

## EverQuest log parsing (critical details)

- Log line format: `[Fri May 29 13:35:54 2026] <text>`. Timestamps are local time with no zone; parsed with `new Date(y, m, d, h, mi, s)`.
- Loot regex (`parse-worker.js`): `<Looter> has|have looted [N ]<item> from <mob>'s corpse.` with optional `--` wrappers. `You` is replaced by the player name taken from the filename (`eqlog_<Name>_<server>.txt`). Leading `a`/`an`/`the` is stripped from item names; mob names are capitalised.
- Logs are huge and **EverQuest keeps appending while the file is open**. The workers therefore:
  - read in 4 MB slices, and by default only the **last 7 days** by reading backwards from EOF (`tailDays`); a "full scan" toggle reads the whole file;
  - retry `NotReadableError`/`NotFoundError` up to 6 times, refreshing the `File` from a `FileSystemFileHandle` when the File System Access API (`showOpenFilePicker`) was used. Keep this retry path intact.
- Worker message protocol: in `{ file, handle, playerName?, tailDays }`; out `{type:'progress', pct}`, `{type:'done', entries}`, `{type:'error', name, message}`. Dates cross the worker boundary and are rehydrated with `new Date(...)` on the main thread.
- Kill sessions: loot for the same mob more than 15 minutes apart (`SESSION_GAP_MS`) is split into separate sessions.
- "Split" logs: additional files (other raiders' logs) are added as extra splits and rendered in their own sections; split files are always read in full.
- Raid target matching uses `RaidTargets.normalize()` (unifies backtick/apostrophe variants, collapses whitespace, lowercases). The stored target list in `localStorage['raidTargets']` is **merged with `DEFAULT_TARGETS`** on read: adding a default reaches everyone, but removing one from the defaults does not remove it from users' stored lists. Some defaults intentionally have trailing spaces (`"Emperor Ssraeshza "`); normalisation handles it.
- When adding raid targets or raid loot, update both the JS list and the matching `.txt` file to keep them in sync.

## Firebase / Firestore

- Project `everquest-guild-potions`. Pages import the SDK from `https://www.gstatic.com/firebasejs/10.12.0/...` (modular API). Keep all pages on the same SDK version; `firebase_config.txt` mentions 12.14.0 but nothing uses it.
- The Firebase web config (including `apiKey`) is duplicated inline in each Firestore page and in `GuildPotions/gp_firestore.lua`. It is a public client identifier, not a secret, but change it in all places together.
- **There is no Firebase Auth and no Firestore security rules file in this repo.** Access control is cosmetic, in client code:
  - Guild Potions "officers" are just names in the `officers` collection matched against the entered player name.
  - The raffle manage password is compared as a SHA-256 hash stored at `pq_raffle_meta/auth`.
  Don't describe these as secure, and don't add logic that assumes server-side enforcement.
- Collections in use:
  - Guild Potions: `orders` (`playerName`, `orderedAt`, `status` = `unassigned` -> `assigned` -> `complete`, `assignedTo`, `assignedAt`, `potions: [{name, category, stacks}]`, optional `isOfficer`), `makers` (`name`), `officers` (`name`), `potionGroups` (catalog groups with `order`, colors, `potions: [{name, enabled, max?}]`; seeded from `DEFAULT_CATALOG` with fixed IDs `default-<i>` only once the server confirms the collection is empty), `config/potionDefault`.
  - Spell Bank: single documents `gsb_spells/data` and `gsb_claims/data`.
  - Raffle: `pq_raffle_meta/{auth,settings,counter,winner}`, `pq_raffle_entries/entries`.
- Pages were tuned to reduce Firestore reads (single aggregate docs, `onSnapshot` with `includeMetadataChanges`, skipping metadata-only updates). Avoid introducing per-render `getDocs` loops.
- Guild Potions business rules live in the page: `ORDER_COOLDOWN_DAYS = 10` and per-potion stack limits (`maxPerPotion` / `max`), bypassed for verified officers.

### Cloud Function (`functions/`)

- `deleteOldCompletedOrders`: scheduled every 24 h; deletes `orders` with `status == 'complete'` and `orderedAt` older than 10 days. Requires a composite index on `orders(status, orderedAt)` in the Firebase console.
- Commands (run in `functions/`, need the Firebase CLI and project access): `npm install`, `npm run serve` (emulator), `npm run deploy`, `npm run logs`. Manual run: `firebase functions:shell` then `deleteOldCompletedOrders()`.
- Hosting is **not** on Firebase; `firebase.json` only configures functions.

## OpenDKP integration (`js/loot-actions.js`)

- Public reads: `GET https://api.opendkp.com/clients/<client>` (for `WebClientId`), `/clients/<client>/raids?count=20`, `/clients/<client>/auctions?page=N`. The client defaults to `bt` and can be overridden in the modal.
- Creating auctions: sign in with the user's OpenDKP username/password directly against AWS Cognito (`us-east-2`, `USER_PASSWORD_AUTH`), look up item IDs with `POST /items`, then `PUT /clients/<client>/auctions` with the ID token. **Never store, log or persist these credentials.**
- OpenDKP has changed its response shapes before (raids can come back as an array or under `Raids`/`raids`). Parse defensively.
- Delivery list input format: one line per win, `Item Name;DKP;Winner gratss` (see `bidding_results.txt`). Matching is two-pass: winner-is-looter matches are locked in first, then remaining units are assigned; quantities are expanded so each unit is used once.

## GuildPotions (MacroQuest Lua script)

- Runs in game via `/lua run guildpotions`; requires MQ2Nav (with meshes), MQ2EasyFind and a shaman with a Medicine Bag. User docs: `GuildPotions/README.txt` (also fetched and shown by the Guild Potions page).
- Talks to Firestore through the REST API by shelling out to Windows `curl.exe` (`gp_firestore.lua`). These calls block, so they must run from the main loop, never inside the ImGui draw function.
- `gp_plan.lua` is pure logic (no `mq` calls) so it can be tested outside the game; keep it that way.
- `gp_recipes.lua` mirrors the `POTION_RECIPES` table in `pages/guild-potions.html`. **If you add or change a potion on the page, update `gp_recipes.lua` too**, keyed by the exact order-board name.
- `gp_vendors.lua` is seed data; real merchant inventories are learned in game and saved to the player's MacroQuest config folder.
- **Releasing:** `GuildPotions.zip` must contain a top-level `guildpotions/` folder (lowercase) with `init.lua`, the `gp_*.lua` modules and `README.txt`. Rebuild the zip after changing anything in `GuildPotions/`, and bump the version note at the top of `init.lua` and in `README.txt`.

## Running and checking changes locally

- Serve the repo root over HTTP (Web Workers and ES modules don't work from `file://`): `npx serve -p 5500 .` (as in `.claude/launch.json`), then open `http://localhost:5500/`.
- There are no automated tests or linters. Verify in a browser: load the page, check the console for errors, try both themes, and test at mobile width (recent commits target mobile formatting).
- To test the log tools, use a real `eqlog_*.txt` file or a small hand-made one with lines in the format above.
- **Firestore pages talk to the live production database even when served locally.** Avoid creating, assigning, completing or deleting real orders, claims or raffle entries while testing; if you must write test data, clean it up.
- The developer works on Windows (`C:\workspaces\zlem-eq.github.io`); scripts and paths in docs should work there.

## Gotchas

- Everything committed is public on GitHub Pages, including the sample/reference files in the repo root. Don't commit real credentials, personal logs or anything that shouldn't be public.
- `functions/node_modules/` exists locally but is git-ignored; don't edit or commit it.
- Some inline HTML is built with template strings that interpolate names (e.g. maker names in `guild-potions.html`). When adding similar code, escape user-provided text (the raffle page has an `escHtml` helper) or use `textContent`.
- Large files (`pages/guild-potions.html`, `pages/guild-spell-bank.html`, `pages/priority-queue-raffle.html`, `js/parser.js`, `js/spells.js`) hold most of the logic; search them with grep rather than reading them top to bottom.
