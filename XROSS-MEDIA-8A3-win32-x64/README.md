# XROSS-MEDIA-8A3 Game Hub 1.3

Open `XROSS-MEDIA-8A3.exe` inside the `XROSS-MEDIA-8A3-win32-x64` folder. Every session starts
fullscreen. Keep the other files and folders beside the executable.

## Your collection

Game → Add to Collection supports:

- Windows game `.exe` files.
- Steam `.url` desktop shortcuts and Windows `.lnk` game shortcuts.
- RPCS3 game folders, library scans, and `USRDIR/EBOOT.BIN` files.

For Steam, right-click a game in Steam → Manage → Add desktop shortcut, then
select that shortcut in XROSS-MEDIA-8A3. Steam still handles its own login and updates.

Select a game and press Y → Artwork & Details to choose a cover and a fullscreen
background, rename the game, or set a favorite. X toggles favorite directly.
Y → Show Favorites filters your collection. System Settings can sort games by
date added, title, or recently played. Removing an entry leaves game files and
saves on disk. Imported photos are copied to XROSS-MEDIA-8A3's own data folder.

The existing Desktop RPCS3 installation is detected for a new library on this
computer. Use System Settings → RPCS3 Application if it has moved.

## Media Center

Move across the XMB to Media Center to open YouTube. Choose Manage Media Tabs
to add, rename, edit or remove your own website links. Websites open in Chrome
tabs when Chrome is installed, with your default browser as a fallback.
XROSS-MEDIA-8A3 minimizes while you browse; select XROSS-MEDIA-8A3 on the taskbar to return fullscreen.
The media manager supports Xbox navigation and its on-screen keyboard.

## Xbox controller and keyboard

- D-pad / left stick: navigate. LB / RB: change XMB category.
- A: enter, play, open a dropdown, or open the on-screen keyboard.
- B: cancel the current editor or go back. Y: options. X: favorite.
- Dropdowns: A opens the choices, D-pad moves, A applies, B cancels.
- Sliders: left/right changes the value. Up/down moves to another control.
- Text fields: A opens the keyboard; X deletes, Y shifts, Done applies.
- Menu / Start or F11: toggle fullscreen. View / Back: return to Game.
- Keyboard: arrows, Enter, Escape, X, Y. Normal typing and Tab also work.

Native XInput is preferred, with browser gamepad support as a fallback. Release
held buttons after connecting or returning to XROSS-MEDIA-8A3. Native Windows file pickers
use mouse/keyboard. Games and emulators handle their own input during gameplay.

## Personalization

Users or the profile name at top right opens your name, profile picture and
12/24-hour clock settings. Display & Theme includes seven colours, PS3/PSP
wave styles, wave speed and brightness, game backgrounds, UI size, and fonts.

Startup length is adjustable from 1–5 seconds and any button skips it. Startup,
game launch, return, menu panels and shutdown have transitions. Animations and
the startup screen can also be disabled separately.

## Wave, icon, font and sound assets

The wave is an original continuously animated surface inspired by PSP/PS3 and
RetroArch XMB references. It is a recreation, not Sony's firmware renderer.
WebGL is used when available, with a software canvas fallback.

PS3 Rodin regular/light/bold fonts and XMB cursor/confirm/cancel sounds were
copied from the user's locally installed PS3 firmware. The PSP PGF bitmap font
is not browser-compatible; both styles use Rodin. A custom TTF, OTF, WOFF or
WOFF2 may be selected. Firmware assets are for this personal installation and
are not covered by the source-code MIT license; see assets/fonts/SOURCE.txt.

The XMB category and system icons are normalized, high-resolution monochrome
silhouettes decoded from the locally installed PS3 firmware `icontex.qrc`.
They share a 256px optical canvas with consistent 192px visible bounds, so the
category row and submenu row stay aligned at high-DPI sizes. See
`assets/icons-hd/SOURCE.txt` and `dimensions.json` for provenance and exact
normalization. No web icon pack is required.

Startup uses the PSP chime from https://storage.instantsbutton.com/psp-boot.mp3.
Sound Settings lets you preview or replace each sound with WAV, MP3, OGG, M4A
or FLAC audio. Original defaults can be restored there.

Settings and game entries remain in the existing XROSS-MEDIA-8A3 user-data directory.
The previous RPCS3-only library migrates automatically. No games are bundled.

## Development checks

`npm test` runs the unit tests. `node test/integration.cjs` exercises the real
Electron bridge and persistence with isolated data and mocked launches.
`node test/renderer.integration.cjs` drives the actual menus and XInput event
pipeline with an isolated mock library. `npm run package` builds Windows x64.
