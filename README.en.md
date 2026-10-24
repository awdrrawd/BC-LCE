# Liko - LCE (Liko Club Extensions)

[繁體中文](./README.md) | **English**

A **mega-addon** for Bondage Club that bundles and refines interface theming, instant messaging, expressions and animations, performance tuning, anti-cheat, wardrobe tools and more. It also ships a horizontal login screen and a vertical (mobile) layout. LCE is positioned as a **replacement for WCE**: it ports and integrates features from WCE, Themed, Responsive, NotifyPlus and others.

## Installation

1. Install a userscript manager in your browser (for example Tampermonkey).
2. Install the loader: [`loader.user.js`](https://awdrrawd.github.io/BC-LCE/loader.user.js).
3. Open or reload Bondage Club. Once you are in the game, use `/lcesetting` to open the settings page, or find LCE under Preferences → Extensions.

The loader only fetches the latest `assets/main.js` from GitHub Pages, so updating LCE never requires reinstalling the loader.

> **Data compatible with WCE.** LCE deliberately reuses WCE's `ExtensionSettings` keys and field names (wardrobe `FBCWardrobe`, layer hiding `WCEOverrides` + `item.Property.wceOverrideHide`), so saves from accounts that used WCE can be read directly.
>
> **Coexistence with WCE.** When WCE is loaded and the matching feature is enabled, LCE steps aside instead of running a duplicate. LCE takes over only when WCE has that feature turned off. See [WCE / LCE coexistence check](docs/wce-compatibility.md) for details and known limits (the document is written in Traditional Chinese).
>
> **Badges and `/versions` share one channel.** The greeting message used for overhead badges and version queries goes over the same hidden `BCEMsg` channel as WCE, with an extra `lce` marker so each side can tell LCE and WCE apart. WCE users can therefore see LCE users (shown with a WCE badge), while LCE users see each other with the proper LCE badge. See the header comment of [`src/features/social/hello.js`](src/features/social/hello.js).

## Features at a glance

The settings page has ten categories:

| Category | Contents (examples) |
|---|---|
| **Chat & Social** | Instant messenger, chat link / image embeds, rich profiles with edit protection, friend online/offline notifications, change others' poses, registered commands as buttons, italic whispers and automatic whisper-target reset, show sent messages while waiting for the server, message freeze, save and browse seen profiles… |
| **BC Theme** | A port of Themed's coloring engine. Simple mode (main / accent / text colours) and advanced mode (every colour, status colours), interface and CJK fonts, colour palette slots. **Shared across accounts** |
| **UI** | Horizontal login UI; vertical login, room search and chatroom UIs; colours for LCE system messages and notification bubbles. **Shared across accounts** |
| **Immersion** | Expression engine, automatic arousal expressions, activity expressions, text-emoticon expressions, open mouth when talking, anti-garble, anti-deafen, arousal growth boost, stutter when aroused, ECHO mouth pulling, richer sound effects, pet-suit actions… |
| **Wardrobe** | Extended wardrobe (96 slots), configurable layer hiding (BETA), grant wardrobe |
| **Performance** | Visible chat-log size with auto-pruning, texture quality (lower character resolution), staggered room character rebuilds (experimental), low frame-rate mode, FPS counter, drawing-cache clearing… |
| **Cheats & Anti-cheat** | Anti-cheat (thresholds by relationship) with automatic blacklisting, UWALL, lockpicking order reveal, layering while bound, auto progress while struggling, let IMs bypass BCX beep limits |
| **Misc** | Automatic relogin on disconnect (including login-elsewhere detection), confirm before leaving the game, prompt before loading third-party content, auto-ghost unnatural new accounts, safeword keeps interaction permission, quick Mixed / Female region switch, hide the arousal meter in the wardrobe |
| **Animal** | Ear wiggling, tail wagging, wing flapping (see below) |
| **Storage** | View, back up and delete `ExtensionSettings` data |

The design and timing of automatic reconnect and ChatLog protection are described in [`docs/automatic-reconnect.md`](docs/automatic-reconnect.md).

### Animal animations (ears / tail / wings)

The settings page has three tabs along the top, one each for ears, tail and wings. Every part has two poses:

1. In the game, set the item to the look you want (colour, properties, rotation, resize, layers, …), return to the LCE settings page and press "Save Resting Pose" to store it as **A**.
2. Change the item to a second look and press "Save Wiggling / Wagging / Flapping Pose" to store it as **B**.

Playback goes B → A → B → A … for the configured number of cycles and **always ends on A** (the resting pose), so everyone ends in the same state. The right-hand side of the settings page has a preview: it runs on a separate copy of your character, never changes your own appearance and never sends any packets. A button also takes you straight to BC's native wardrobe to adjust the item.

- **Manual (text) trigger:** type one of the following in a chatroom and send it to play the matching animation. **Seven languages are supported** (English, Traditional Chinese, Simplified Chinese, Russian, French, Ukrainian, German), and the words work regardless of your UI language, so anyone can trigger in their own language.

  | Part | English | 繁體中文 | 简体中文 |
  |---|---|---|---|
  | Ears | `*wiggle*`, `*twitch*` | `*搖耳朵*`, `*抖耳朵*` | `*摇耳朵*`, `*抖耳朵*` |
  | Tail | `*wag*` | `*搖尾巴*`, `*擺尾巴*` | `*摇尾巴*`, `*摆尾巴*` |
  | Wings | `*flap*` | `*拍翅膀*`, `*搧翅膀*` | `*拍翅膀*`, `*扇翅膀*` |

  The Russian, French, Ukrainian and German words, plus every word for each language, are listed in [Animal animation trigger words](docs/animal-trigger-words.md), for example `*шевелит ушами*`, `*remue la queue*`, `*махає крилами*` and `*wackelt mit den ohren*`.

  - The whole message must be exactly `*keyword*` or `*keyword` (BC treats any message starting with `*` as an emote, so the closing asterisk is optional and both forms behave the same): `*wag*` and `*wag` work, but `*wag slowly*` or `I *wag*` do not. Case, accents (`é`, `ö`, `ё`…), repeated spaces and trailing mood marks (`~`, `!`, `.`…) do not matter, and both the normal `*` and the full-width `＊` that CJK input methods produce are accepted. English also accepts the third-person forms (`*wiggles*`, `*wags*`, `*flaps*`) and a part name (`*wag tail*`).
  - The message is sent as usual, so people in the room see the text; the animation starts right after it is sent.
  - This is chat text, not a `/` command, and it is not listed in the `/lce` command overview.
  - The part's switch must be on (Animal tab in settings) and both the resting pose A and the animated pose B must be saved; if either is missing, nothing happens.
  - A manual trigger does not require you to be wearing the item (if you are not, the A/B pose item is put on); only the automatic trigger needs it to be worn.
  - Triggering again during playback restarts from the beginning with the latest request.
- **Automatic trigger:** fires at random based on the trigger interval, and only if the part is currently worn; an item you took off is never put back.
- **Sync model:** the setting only decides whether *you* animate; it never affects whether you see other people's animations. Every frame of your own animation is sent as an item update packet (like BCAR), so everyone in the room sees it, **with no LCE and no setting required on their side**. The animation ends on A, and the server-side state is A as well. Because frames are sent one by one, a shorter delay or more cycles means more packets.
- **Early stop:** if the part is removed or replaced with another item during playback, the animation stops immediately and does not overwrite that change.
- Default cycles are 9 for ears and tail and 3 for wings, with a maximum of 20; the per-frame delay is limited to 100–2000 ms.
- Pose data received from other players is validated against an allow-list, types, depth and size limits, and dangerous keys are filtered out.

### Commands

(The ear / tail / wing triggers (`*wiggle*`, `*wag*`, `*flap*` and their translations in seven languages) are chat-text triggers, not `/` commands; see "Animal animations" above.)

`/lce` (command overview), `/lcesetting` (open settings), `/profiles <keyword>`, `/versions [name]`, `/w`, `/beep`, `/cum`, `/lcegotoroom`, `/exportlooks`, `/importlooks`, `/lcedebug`, `/lceThemetest`. Some general-purpose commands are filtered at registration time depending on whether WCE is active.

### Vertical (mobile) layout

The vertical login, room search and chatroom layouts are ported from MPL and can be switched on individually under UI settings. Unlike MPL, which applies them purely by screen orientation, LCE applies a layout only when the screen is in portrait **and** the matching setting is on. The storage layer for accounts, avatars and keys is shared with MPL, so login data works in both. Other plugins can read the current layout state through `window.Liko.LCE.Vertical.getState()`; see [vertical-api](docs/vertical-api.md).

### Immersion settings and ECHO compatibility

Immersion settings are split into three pages: "Immersion & Expressions", "Chat" and "Other". The right side of the Chat page holds anti-garble and its sub-settings; the right side of the Other page holds the pet-suit action settings. The anti-cheat relationship list and the action-button position can be chosen directly from dropdowns.

- **Activity expressions:** one switch covers the original activities and the supported ECHO activities. Existing expression rules take priority; the new lookup tables and matching logic live in `src/features/expressions/qol-data.js` and `qol-rules.js` and share the existing expression engine.
- **Emoticon expressions:** off by default. Sending space-separated emoticons triggers a five-second expression; requires the expression engine.
- **Mouth pulling:** on by default. When both hands are restricted, the mouth is available and the puller's Misc slot is empty, ECHO's "pull to side" can be used. Both sides need ECHO; the other person does not need LCE. Item pairing and permission checks are still handled by ECHO. The supplementary action messages are translated into seven languages through the shared L10N engine.
- **Richer sound effects:** off by default. Adds sound effects for supported ECHO activities while preserving the existing sound priority and the game's volume and mute settings.
- **Pet-suit actions:** off by default; requires the expression engine, a pet suit and permission to change arm poses. You can set the animation count, the action interval and four button positions. Each run raises the left and right arms once and then restores the original pose. The left/right alternation is composited locally; other players still see BC's native two-arm pose. Changing pose manually stops the action.
- **Delays and cancellation in chat QoL:** emoticon expressions always last 5 seconds. Mouth shapes triggered by messages can be delayed by message length, but a new message cancels the pending mouth timer so a stale expression never overwrites a newer one. Pet suit and emoticons share a temporary expression cache, and the original face is restored only after the last hold ends.
- **Echo activity safety boundary:** only recognised custom Echo activities or Luzi activities enter LCE's expression and sound mapping. Ordinary BC activities are never triggered just because their names contain keywords such as `Kiss` or `Hit`.

Anti-garble keeps the existing WCE-compatible logic. "See the room with eyes closed" is not provided for now; after updating from a version that had loaded it, reload the game to clear the old hooks.

### Wardrobe

BC R132's native wardrobe already includes character preview and overwrite confirmation, so LCE no longer takes those over (the former "character-preview wardrobe" and "overwrite confirmation" features were removed). What remains is the 96-slot extended wardrobe, configurable layer hiding (BETA) and grant wardrobe. The extra wardrobe slots are stored under the same `FBCWardrobe` key as WCE, so accounts that used WCE can read them directly.

## Languages

The language follows BC's language setting (`TranslationLanguage`) and supports seven languages: **TW / CN / EN / DE / FR / RU / UA**. The string tables are in [`Translation/`](Translation/), and language detection is shared with other Liko plugins through `window.Liko.I18N`.

## Documentation

Most documents are written in Traditional Chinese.

- [LCE architecture and extension guide](docs/architecture.md) and the [interactive feature map](docs/lce-architecture.html)
- [ExtensionSettings and AccountUpdate handling](docs/extension-settings-account-update.md)
- [Automatic reconnect and ChatLog protection](docs/automatic-reconnect.md)
- [Shared profile database](docs/profile-database.md)
- [Vertical layout API](docs/vertical-api.md) (English)
- [Animal animation trigger words (7 languages)](docs/animal-trigger-words.md)
- [WCE / LCE coexistence check](docs/wce-compatibility.md)
- [R132Beta3 compatibility fixes](docs/r132-compatibility.md)
- [Automated checks (CI)](docs/automation.md)
- [Responsive / LCE expression and mouth-shape ownership](docs/responsive-ownership-review.md)
- [Unfinished work and acceptance](docs/unfinished-work.md)
- Review records: [2026-09-05 code structure review](docs/code-review-2026-09-05.md) and [2026-10-06 code audit](docs/code-audit-2026-10-06.md) (they record the state at the time and do not describe the current state)

## Project structure

```
src/
  main.js            Entry point: duplicate-load guard, dynamically loads app.js
  app.js             Pre-login essentials (global settings / colours / FUSAM / login page)
                     → wait for the BC core → wait for login and settings
                     → install each feature in order (each step isolated by safe())
                     → attach the public API
  modsdk.js          Bundled bcModSdk (included in the bundle, no @require)

  core/              Shared foundations: constants, settings schema and storage, i18n, hook
                     management, lifecycle, WCE coexistence checks, public API, theme API
  commands/          Command system (commander.js)
  features/          Feature modules, each providing installXxx():
                     chat / social / messenger / theme / expressions / wardrobe /
                     safety / performance / vertical / animal (animation playback, pose logic,
                     7-language triggers, settings preview) /
                     echo-mouth-pull / petsuit-render / region-switch / misc …
  game/              Thin wrappers around BC functions (chat actions, room search and
                     navigation, language)
  loginpage/         Horizontal login page (background, account carousel, settings overlay,
                     hiding BC's native login + FUSAM pass-through)
  settings/          In-game settings pages (storage manager, colour pickers,
                     trusted-origin manager)
  storage/           Accounts, credentials, reconnect credentials, wallpaper and the
                     IndexedDB databases
  ui/                Chat message rendering, notifications and transitions
  assets/            Icons

Translation/         Seven-language JSON string tables (TW / CN / EN / DE / FR / RU / UA)
tests/               Node VM modules tests
scripts/             Asset verification and bundle-size report
docs/                Design notes and maintenance records
loader.user.js       Production loader (emitted into dist/ by vite.config.js at build time and served by GitHub Pages; loads the generated assets/main.js)
loader.local.user.js Local development loader (loads http://localhost:5174/assets/main.js)
```

## Public API (`window.Liko.LCE`)

```js
LCE.version                         // version string
LCE.getFeature(key) / setFeature(key, value)   // read / write feature settings (runs sideEffects and saves)
LCE.settings                        // current settings object (read-only getter)

// Trusted image origins (origins are normalised to https://example.com)
LCE.TrustedImageOrigins.list()                  // copy of the permanently trusted origins
LCE.TrustedImageOrigins.isPermanentlyTrusted(urlOrOrigin)
LCE.TrustedImageOrigins.isSessionTrusted(urlOrOrigin)
LCE.TrustedImageOrigins.isTrusted(urlOrOrigin)  // permanently or for this session
LCE.TrustedImageOrigins.addPermanent(urlOrOrigin)
LCE.TrustedImageOrigins.removePermanent(urlOrOrigin)
await LCE.TrustedImageOrigins.request(urlOrOrigin, 'image', { persistent: true })

// Theme colours (prefer Theme.*; colours are always null while theming is disabled)
LCE.Theme.enabled                   // boolean: whether theming is enabled
LCE.Theme.Main / .Accent / .Text …  // hex, or null when disabled (plus the full Element/ElementHover… set)
LCE.Theme.isDark / .palette / .special
LCE.isThemeEnabled()                // same as Theme.enabled
// Backward compatible (same as Theme.*, also null when disabled):
// getMainColor / getAccentColor / getTextColor / getPalette / isDarkTheme

// Canvas buttons (every full path starts with window.Liko.LCE)
LCE.Button.Messenger
LCE.Button.EditProfile
LCE.Button.pastProfiles
// Shared methods: getPosition/setPosition/resetPosition, hide/show/isHidden,
// hideVisual/showVisual/isVisualHidden, and isEnabled.

// The instant messenger window also has z-index control
LCE.Button.Messenger.getZIndex()
LCE.Button.Messenger.setZIndex(100)
LCE.Button.Messenger.resetZIndex()

// Past Profiles personal notes
await LCE.pastProfiles.get(memberNumber)
await LCE.pastProfiles.set(memberNumber, note)

// Profile sharing (receive priority: FCM > LCE > standalone WPS)
LCE.ProfileShare.apiVersion
await LCE.ProfileShare.share(memberNumber)  // send using the profile stored by LCE
LCE.ProfileShare.handlesReceive()           // whether LCE is currently the PROFILESHARE receiver

// Vertical layout state (see docs/vertical-api.md)
LCE.Vertical.getState()

// Expressions and diagnostics
LCE.FaceCache                       // temporary expression cache (read-only): { original, applied }
LCE.expressionData                  // expression data tables (read-only)
LCE.debugExpressions(true) / getExpressionQueue() / getExpressionHookOrder()
LCE.getHookFailures()               // BC hooks that are currently not attached (diagnoses BC updates)
LCE.debugRelogSnapshot()            // reconnect snapshot diagnostics
LCE.WCECompatibility                // WCE coexistence checks (isLoaded / isFeatureEnabled / shouldLceHandle)
```

## Local testing and building

Requires Node.js 22.12 or newer (CI uses Node 22).

1. Install dependencies:
   ```
   npm install
   ```
   When you clone the project with Git, `npm install` automatically verifies and fills in `assets`. With GitHub's Source ZIP there is no `.git`, so the build skips asset hash verification and does not fetch the login images and videos. For the full login backgrounds, use a Git clone or provide `assets/` yourself.

2. Run the tests:
   ```
   npm test
   ```

3. Start the local development server (builds once, then watches and previews):
   ```
   npm run dev
   ```
   or just double-click `run_dev.bat`.
4. Install **`loader.local.user.js`** in Tampermonkey (only this one; do not install the production loader at the same time).
5. Open or reload BC and LCE appears. After you change `src/`, Vite rebuilds automatically, and reloading BC loads the newest build.

> The `Access-Control-Allow-Private-Network` header in the Vite config (the PNA plugin) is required;
> without it Chrome blocks the HTTPS BC page from fetching the bundle from localhost.

## Production build and deployment

```
npm run build
```

Build output (`dist/`) is **not committed to Git**, to avoid conflicts when branches are merged. It is always generated by CI:

- **Pull requests:** `LCE checks` runs `npm test` and `npm run build` and compares the bundle size with the PR's base branch. It does not deploy.
- **Merging into `main`:** `Deploy GitHub Pages` runs the tests and the build, then deploys `dist/` to GitHub Pages (the Pages source must be set to GitHub Actions).

`loader.user.js` loads `assets/main.js` straight from Pages. The loader is versioned independently and updated by hand only when the loading mechanism changes; build / dev never rewrite the loader's `@version` from `package.json`.

## License

LCE itself is licensed under **AGPL-3.0**; see [LICENSE](./LICENSE). The project incorporates code from open-source projects including WCE, Themed, Responsive and NotifyPlus. Their licenses and copyright notices are in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md), and the full license texts are in [`licenses/`](./licenses/).
