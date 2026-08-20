# World Clock Widget

A Windows desktop World Clock Widget. Electron based, lives in the system tray.

Copyright (c) Don Ryu

## Features

| # | Requirement | How it is implemented |
|---|-------------|-----------------------|
| 1 | Date / time / city | Each widget shows a city name, the time, the date and the time zone. All IANA zones (~420) plus a curated city list including Seoul, Daegu, Busan |
| 2 | Daylight saving time | Offsets are recomputed from the ICU IANA database on every tick, so the clock and the displayed UTC offset switch over on their own at a transition. Verified for 30-minute DST (Lord Howe), +5:45 (Kathmandu) and southern-hemisphere zones |
| 3 | Font size / color | Font, size (12-300 px), text color, background color or a background image, plus a single opacity slider |
| 4 | Background operation | No console window, never shown in the taskbar, managed from the tray icon. Closing the settings window leaves the app running. Autostart is a registry `Run` entry, so only the widgets appear at login |
| 5 | Z-order control | Per-widget pin. Pinned, the widget uses the `screen-saver` level and stays above browsers and full-screen apps; unpinned, it behaves like a normal window |

## Running from source

```
npm install
node node_modules/electron/install.js
npm start
```

The second line is only needed because npm blocks Electron's postinstall (the step that
downloads the Electron binary). Or double-click `Start World Clock Widget.vbs`, which launches the
app with no console window.

Run the daylight saving time checks:

```
npm test
```

## Building the installer

```
npm run dist
```

That regenerates `build/icon.ico` from the same drawing the tray uses, then packages an NSIS
installer. Output:

- `dist/World Clock Widget Setup 1.0.0.exe` - the installer to hand to other people
- `dist/win-unpacked/World Clock Widget.exe` - runs without installing, but needs the whole
  `win-unpacked` folder beside it

Bump `version` in `package.json` to change the output file name.

The build is **not code signed**, so Windows SmartScreen shows an "unknown publisher"
warning. Selling the app means buying a code signing certificate and adding it to the `win`
section of the build config.

## Using a widget

| Action | Result |
|--------|--------|
| Drag the card | Move the widget |
| Drag the bottom-right grip | Resize (scales the whole widget, 12-300 px) |
| Lock button (top right) | Pin: locks the position and puts the widget above every other window |
| Gear button (top right) | Open this widget's settings |
| Double-click the card | Open this widget's settings |
| Right-click the card | Pin, show/hide, duplicate, delete, quit |
| Eye button in the settings list | Hide or show a widget without deleting it |
| Tray icon | Per-widget toggles, add a widget, autostart, quit |

## Settings

Deliberately small. One list of widgets on the left, four groups on the right:

- **City** - a single dropdown listing curated cities as `City - Country`, followed by every
  IANA zone so nothing is unreachable, plus the name shown on the widget
- **Show** - city name, date, seconds, 12-hour clock, time zone
- **Appearance** - font, size, text color, background color, opacity, background image
- **Behavior** - pin on top

Notes on what is deliberately *not* there:

- No live preview. The widget itself updates as you change a setting.
- No separate background-transparency slider. The background is solid and one **Opacity**
  slider fades the whole widget.
- No separate summer-time badge. The clock and the `PDT - UTC-07:00` line already carry it,
  and they flip on their own at a transition.
- Weight, padding, corner radius, alignment, secondary colors, text shadow, digit width
  and date format are fixed at sensible values instead of being exposed as options.

### Background image

**Choose image...** copies the picked file into `%APPDATA%\World Clock Widget\backgrounds` and the
widget serves it over a private `widget-bg://` protocol, so the renderer's CSP stays tight
and no file paths need escaping. The image is drawn with `object-fit: cover`: it fills the
card at whatever size the widget currently is and is cropped, never stretched. A fixed dark
scrim sits on top so the clock stays readable over a busy photo.

## Layout

```
src/
  main/
    main.js       windows, tray, IPC, autostart
    store.js      config persistence + schema migration
    icon.js       clock icon drawn in code (bundled PNG encoder)
  preload/        minimal contextBridge API
  renderer/
    timelogic.js  time zone and DST math (shared by widget and settings)
    widget.*      widget window
    settings.*    settings window
scripts/
  make-icon.js    builds build/icon.ico from the same drawing
test/dst.test.js  22 DST regression checks
```

Config file: `%APPDATA%\World Clock Widget\config.json`

## Credits

The pin button uses [Bootstrap Icons](https://icons.getbootstrap.com) (`pin-angle`,
`pin-angle-fill`), MIT licence, (c) 2019-2024 The Bootstrap Authors. Every other graphic,
including the app icon, is drawn in code.

## Time zone rule overrides

The DST rules live inside the app: Electron bundles ICU, which carries the IANA time zone
database. Nothing is fetched at runtime, so transitions happen with no network. The only
thing that has to be right is the PC clock itself.

The catch is that the bundled database is a snapshot. Electron 43 ships **tzdata 2025c**,
and any rule changed after that cut is missing until Electron ships a newer ICU.

`ZONE_OVERRIDES` in `src/renderer/timelogic.js` patches those zones. Currently one entry:

| Zone | Change | Landed in tzdata |
|------|--------|------------------|
| `America/Vancouver` | British Columbia stays on daylight time from the November 2026 fall back onward, so the clock never returns to UTC-08:00 | 2026b |

Each entry **retires itself**. Before applying, the code probes the bundled database at a
date where the two would disagree; if ICU already returns the new offset, the override is
skipped. So when Electron catches up the patch silently stops firing, and the entry can be
deleted whenever convenient rather than urgently.

Why not read the Windows time zone data instead, so Windows Update maintains it? It does
not help here. Windows has 141 zones against the 418 in IANA, and it puts Vancouver and
Los Angeles in one shared "Pacific Time (US & Canada)" zone, so a British-Columbia-only
change cannot be expressed until Microsoft adds a new zone id, as they did with "Yukon
Standard Time". The IANA-to-Windows mapping this app would need is then stale in exactly
the same way, and 418 zones collapse to 141 in the bargain.

## Notes

- DST is detected as "current offset > the smaller of this year's January and July offsets",
  which covers both hemispheres without a hard-coded transition table.
- The clock re-arms `setTimeout` on each second boundary, so it does not drift over long runs
  and it refreshes immediately after the machine wakes from sleep.
- Widget windows set `backgroundThrottling: false`, so they keep ticking while covered.
- The config file is versioned and each widget is rebuilt from the current schema on load, so
  options removed in a later version are dropped instead of lingering as stale keys. A UTF-8
  BOM at the start of the file is stripped before parsing.
- Autostart args must not be quoted by hand: `setLoginItemSettings` escapes them itself, and
  double quoting puts the quotes inside the path, which Windows then resolves against
  `C:\Windows\System32` and the app fails to launch at login.
- **Keep this project out of OneDrive.** `node_modules` and `dist` are large and churn
  heavily; syncing them is slow and has already cost one loss of the working tree here.
