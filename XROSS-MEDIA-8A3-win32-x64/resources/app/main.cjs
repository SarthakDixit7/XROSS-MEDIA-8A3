'use strict';

const { app, BrowserWindow, dialog, ipcMain, session, shell, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Store } = require('./lib/store.cjs');
const { SOUND_KINDS, validateSettings, cleanText, regularFile, readBounded, resolveGame,
  describeGame, gameArtwork, scanGames, buildLaunch, imageData, imageMime } = require('./lib/core.cjs');
const { validateSteamUrl, executablePath, describeExecutable, describeShortcut, buildExecutableLaunch } = require('./lib/hub.cjs');
const { MAX_MEDIA_LINKS, YOUTUBE_LINK, normalizeMediaUrl, validateMediaInput, findChromeExecutable } = require('./lib/media.cjs');

app.setName('XROSS-MEDIA-8A3');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const argValue = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const testData = argValue('--test-user-data');
if (testData && !app.isPackaged && path.isAbsolute(testData)) app.setPath('userData', testData);
const smoke = process.argv.includes('--smoke-test');
const requestedSmokeDelay = Number(argValue('--smoke-delay'));
const smokeDelay = Number.isFinite(requestedSmokeDelay) ? Math.min(10000, Math.max(250, requestedSmokeDelay)) : 5000;
const indexPath = path.join(__dirname, 'renderer', 'index.html');
const rendererUrl = pathToFileURL(indexPath).href;
let window;
let store;
let child = null;
let launching = false;
let quitting = false;
let closeRequested = false;
let closeApproved = false;
let closeTimer = null;
let externalTimer = null;
let mediaMinimized = false;
let controllerBridge = null;
const gamepads = new Map();
const runtime = { runningGameId: null, error: null, status: 'idle', lastExitCode: null };
const artCache = new Map();
const soundCache = new Map();
const fontCache = new Map();
const smokeErrors = [];
const audioMime = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' };

function sendRuntime(patch) {
  Object.assign(runtime, patch);
  if (window && !window.isDestroyed()) window.webContents.send('launcher:runtime', { ...runtime });
  broadcastGamepads();
}

function gamepadSnapshots() {
  const focused = Boolean(window && !window.isDestroyed() && window.isFocused() && !runtime.runningGameId);
  return [...gamepads.values()].map(state => ({ ...state, focused }));
}

function broadcastGamepads() {
  if (!window || window.isDestroyed()) return;
  for (const state of gamepadSnapshots()) window.webContents.send('launcher:gamepad', state);
}

function stopControllers() {
  controllerBridge?.stop();
  controllerBridge = null;
}

function exitApp(code) {
  stopControllers();
  app.exit(code);
}

function restoreWindow() {
  if (quitting || !window || window.isDestroyed()) return;
  window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
}

async function publicState() {
  const settings = { ...store.state.settings, sounds: { ...store.state.settings.sounds } };
  settings.profileAvatar = settings.profileAvatar ? await imageData(path.join(store.directory, 'artwork', settings.profileAvatar)) : null;
  if (settings.customFont) {
    const filename = settings.customFont;
    if (!fontCache.has(filename)) {
      try {
        const data = await readBounded(path.join(store.directory, 'fonts', filename), 16 * 1024 * 1024);
        const mime = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' }[path.extname(filename)];
        fontCache.set(filename, `data:${mime};base64,${data.toString('base64')}`);
      } catch { fontCache.set(filename, null); }
    }
    settings.customFont = fontCache.get(filename);
  }
  for (const kind of SOUND_KINDS) {
    const filename = settings.sounds[kind];
    settings.sounds[kind] = null;
    if (!filename) continue;
    if (!soundCache.has(filename)) {
      try {
        const data = await readBounded(path.join(store.directory, 'sounds', filename), 20 * 1024 * 1024);
        soundCache.set(filename, `data:${audioMime[path.extname(filename)]};base64,${data.toString('base64')}`);
      } catch { soundCache.set(filename, null); }
    }
    settings.sounds[kind] = soundCache.get(filename);
  }
  const games = await Promise.all(store.state.games.map(async game => {
    if (!artCache.has(game.id)) artCache.set(game.id, gameArtwork(game, store.directory).then(async ({ icon, background }) => {
      if (!icon && game.kind === 'exe') {
        try { icon = (await app.getFileIcon(game.path, { size: 'large' })).toDataURL(); } catch { /* artwork is optional */ }
      }
      return { icon, background };
    }));
    return { ...game, ...await artCache.get(game.id) };
  }));
  return { settings, games, mediaLinks: [YOUTUBE_LINK, ...store.state.mediaLinks], runtime: { ...runtime } };
}

function register(name, handler) {
  ipcMain.handle(`launcher:${name}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererUrl) {
      throw new Error('This request did not come from the launcher.');
    }
    return handler(...args);
  });
}

async function selectFile(options) {
  const result = await dialog.showOpenDialog(window, options);
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
}

function findGame(id) {
  if (typeof id !== 'string') throw new Error('Invalid game.');
  const game = store.state.games.find(item => item.id === id);
  if (!game) throw new Error('This game is no longer in your library.');
  return game;
}

function findMediaLink(id) {
  if (id === YOUTUBE_LINK.id) return YOUTUBE_LINK;
  if (typeof id !== 'string') throw new Error('Invalid media link.');
  const link = store.state.mediaLinks.find(item => item.id === id);
  if (!link) throw new Error('This media link is no longer in your library.');
  return link;
}

async function openMediaUrl(rawUrl) {
  const url = normalizeMediaUrl(rawUrl);
  const chrome = await findChromeExecutable();
  if (chrome) {
    try {
      await new Promise((resolve, reject) => {
        const processHandle = spawn(chrome, ['--new-tab', url], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
        processHandle.once('spawn', () => { processHandle.unref(); resolve(); });
        processHandle.once('error', reject);
      });
      if (window && !window.isDestroyed()) { mediaMinimized = true; window.minimize(); }
      return { ok: true, browser: 'chrome' };
    } catch { /* Use the user's default browser if Chrome cannot start. */ }
  }
  await shell.openExternal(url);
  if (window && !window.isDestroyed()) { mediaMinimized = true; window.minimize(); }
  return { ok: true, browser: 'default' };
}

async function importGame(selected) {
  const game = await describeGame(await resolveGame(selected));
  await store.transact(next => { if (!next.games.some(item => item.id === game.id)) next.games.push(game); });
  return publicState();
}

async function addLibraryGame(game) {
  await store.transact(next => { if (!next.games.some(item => item.id === game.id)) next.games.push(game); });
  return publicState();
}

function finishExternalLaunch() {
  if (runtime.status !== 'external') return;
  clearTimeout(externalTimer);
  externalTimer = null;
  sendRuntime({ runningGameId: null, status: 'idle' });
}

async function recordLaunch(id) {
  await store.transact(next => {
    const saved = next.games.find(item => item.id === id);
    if (saved) { saved.lastPlayed = new Date().toISOString(); saved.playCount++; }
  }).catch(error => sendRuntime({ error: `The game started, but play history could not be saved: ${error.message}` }));
}

function requestClose() {
  if (!window || window.isDestroyed() || closeRequested) return;
  closeRequested = true;
  window.webContents.send('launcher:beforeClose');
  // Still close if a renderer is stalled or an old version lacks the handshake.
  closeTimer = setTimeout(finishClose, 1400);
}

function finishClose() {
  if (!closeRequested || closeApproved) return;
  clearTimeout(closeTimer);
  closeApproved = true;
  quitting = true;
  window?.close();
}

async function chooseArtwork(prefix) {
  const selected = await selectFile({ title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Pictures (up to 12 MB)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (!selected) return null;
  if (!(await regularFile(selected, 12 * 1024 * 1024))) throw new Error('Choose a picture smaller than 12 MB.');
  const buffer = await readBounded(selected, 12 * 1024 * 1024);
  if (!imageMime(buffer)) throw new Error('Choose a PNG, JPEG or WebP picture.');
  let picture = nativeImage.createFromBuffer(buffer);
  if (picture.isEmpty()) throw new Error('This picture could not be opened.');
  const size = picture.getSize();
  const limit = prefix === 'profile' ? 512 : prefix.includes('-icon') ? 768 : 2560;
  if (size.width > limit || size.height > limit) picture = picture.resize({ width: Math.round(size.width * Math.min(limit / size.width, limit / size.height)), height: Math.round(size.height * Math.min(limit / size.width, limit / size.height)), quality: 'good' });
  let png = picture.toPNG();
  // A compressed JPEG can expand into a much larger PNG; keep saved assets
  // within the same bound used when loading them back into the library.
  while (png.length > 12 * 1024 * 1024) {
    const currentSize = picture.getSize();
    picture = picture.resize({ width: Math.max(1, Math.floor(currentSize.width * 0.8)), height: Math.max(1, Math.floor(currentSize.height * 0.8)), quality: 'good' });
    png = picture.toPNG();
  }
  const filename = `${prefix}-${randomUUID()}.png`;
  const directory = path.join(store.directory, 'artwork');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), png, { flag: 'wx' });
  return filename;
}

async function launchGame(id) {
  if (launching || child || runtime.runningGameId) throw new Error('A game is already running. Close it before starting another game.');
  const game = findGame(id);
  const settings = { ...store.state.settings };
  const kind = game.kind || 'rpcs3';
  if (kind === 'rpcs3' && !settings.rpcs3Path) throw new Error('Choose rpcs3.exe in Settings first.');
  launching = true;
  try {
    if (kind === 'steam' || kind === 'shortcut') {
      sendRuntime({ runningGameId: id, error: null, status: 'starting', lastExitCode: null });
      if (kind === 'steam') await shell.openExternal(validateSteamUrl(game.path));
      else {
        // Check the shortcut's current target again in case it has changed since import.
        await describeShortcut(game.path, file => shell.readShortcutLink(file));
        const message = await shell.openPath(game.path);
        if (message) throw new Error(message);
      }
      sendRuntime({ status: 'external' });
      if (settings.hideOnLaunch && window && !window.isDestroyed()) window.minimize();
      // Steam and Windows own these processes; returning to the hub must never
      // leave it locked waiting for an exit event that Electron cannot receive.
      externalTimer = setTimeout(finishExternalLaunch, 1500);
      await recordLaunch(id);
      return { ok: true, external: true };
    }
    if (kind === 'rpcs3' && !(await regularFile(settings.rpcs3Path))) throw new Error('RPCS3 could not be found. Choose rpcs3.exe again in Settings.');
    if (!(await regularFile(game.path))) throw new Error('The game file could not be found. Check that its drive is connected, or add the game again.');
    const launch = kind === 'exe' ? buildExecutableLaunch(await executablePath(game.path)) : buildLaunch(settings.rpcs3Path, game.path, settings.noGui);
    const applicationName = kind === 'rpcs3' ? 'RPCS3' : game.title;
    sendRuntime({ runningGameId: id, error: null, status: 'starting', lastExitCode: null });
    const processHandle = spawn(launch.executable, launch.args, launch.options);
    child = processHandle;
    processHandle.once('exit', (code, signal) => {
      if (child !== processHandle) return;
      child = null;
      sendRuntime({ runningGameId: null, status: 'idle', lastExitCode: code,
        error: code !== 0 && code !== null ? `${applicationName} exited with code ${code}.` :
          signal ? `${applicationName} stopped (${signal}).` : null });
      restoreWindow();
    });
    await new Promise((resolve, reject) => {
      processHandle.once('spawn', resolve);
      processHandle.once('error', error => {
        if (child === processHandle) child = null;
        sendRuntime({ runningGameId: null, status: 'idle', error: `Could not start ${applicationName}: ${error.message}` });
        restoreWindow();
        reject(new Error(`Could not start ${applicationName}: ${error.message}`));
      });
    });
    if (child === processHandle) {
      sendRuntime({ status: 'running' });
      if (settings.hideOnLaunch && window && !window.isDestroyed()) window.minimize();
    }
    await recordLaunch(id);
    return { ok: true };
  } catch (error) {
    if (!child) {
      sendRuntime({ runningGameId: null, status: 'idle', error: error.message });
      restoreWindow();
    }
    throw error;
  } finally { launching = false; }
}

function installHandlers() {
  register('getState', publicState);
  register('addMediaLink', async input => {
    const link = validateMediaInput(input);
    if (store.state.mediaLinks.length >= MAX_MEDIA_LINKS) throw new Error(`The media center can hold up to ${MAX_MEDIA_LINKS} custom sites.`);
    await store.transact(next => { next.mediaLinks.push({ id: randomUUID(), ...link }); });
    return publicState();
  });
  register('updateMediaLink', async input => {
    if (!input || typeof input !== 'object') throw new Error('Invalid media link.');
    if (input.id === YOUTUBE_LINK.id) throw new Error('The built-in YouTube link cannot be edited.');
    const saved = findMediaLink(input.id);
    const link = validateMediaInput(input);
    await store.transact(next => { Object.assign(next.mediaLinks.find(item => item.id === saved.id), link); });
    return publicState();
  });
  register('removeMediaLink', async id => {
    if (id === YOUTUBE_LINK.id) throw new Error('The built-in YouTube link cannot be removed.');
    findMediaLink(id);
    await store.transact(next => { next.mediaLinks = next.mediaLinks.filter(item => item.id !== id); });
    return publicState();
  });
  register('openMediaLink', async id => openMediaUrl(findMediaLink(id).url));
  register('getGamepadState', () => gamepadSnapshots());
  register('chooseEmulator', async () => {
    const selected = await selectFile({ title: 'Choose RPCS3', properties: ['openFile'], filters: [{ name: 'RPCS3 executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }] });
    if (!selected) return null;
    if (process.platform === 'win32' && path.basename(selected).toLowerCase() !== 'rpcs3.exe') throw new Error('Choose the file named rpcs3.exe in your RPCS3 folder.');
    if (!(await regularFile(selected))) throw new Error('Choose the original RPCS3 executable.');
    await store.transact(next => { next.settings.rpcs3Path = selected; });
    return publicState();
  });
  register('addGame', async () => {
    const selected = await selectFile({ title: 'Choose a PS3 game folder', properties: ['openDirectory'] });
    return selected ? importGame(selected) : null;
  });
  register('addGameFile', async () => {
    const selected = await selectFile({ title: 'Choose USRDIR/EBOOT.BIN', properties: ['openFile'], filters: [{ name: 'PS3 boot file', extensions: ['bin', 'BIN'] }] });
    return selected ? importGame(selected) : null;
  });
  register('addExecutable', async () => {
    const selected = await selectFile({ title: 'Add a PC game executable', properties: ['openFile'], filters: [{ name: 'Windows game', extensions: ['exe'] }] });
    return selected ? addLibraryGame(await describeExecutable(selected)) : null;
  });
  register('addShortcut', async () => {
    const selected = await selectFile({ title: 'Add a Steam or Windows game shortcut', properties: ['openFile'], filters: [{ name: 'Game shortcuts', extensions: ['lnk', 'url'] }] });
    return selected ? addLibraryGame(await describeShortcut(selected, file => shell.readShortcutLink(file))) : null;
  });
  register('scanGames', async () => {
    const selected = await selectFile({ title: 'Scan a PS3 games library (up to four folders deep)', properties: ['openDirectory'] });
    if (!selected) return { state: await publicState(), added: 0, warnings: [] };
    const scanned = await scanGames(selected);
    let added = 0;
    await store.transact(next => {
      const ids = new Set(next.games.map(game => game.id));
      for (const game of scanned.games) if (!ids.has(game.id)) { next.games.push(game); ids.add(game.id); added++; }
    });
    return { state: await publicState(), added, warnings: scanned.warnings };
  });
  register('updateSettings', async patch => {
    await store.transact(next => { next.settings = validateSettings(patch, next.settings); });
    return publicState();
  });
  register('removeGame', async id => {
    const game = findGame(id);
    await store.transact(next => { next.games = next.games.filter(item => item.id !== id); });
    artCache.delete(game.id);
    return publicState();
  });
  register('renameGame', async input => {
    if (!input || typeof input !== 'object') throw new Error('Invalid game title.');
    findGame(input.id);
    const title = cleanText(input.title);
    if (!title) throw new Error('Enter a game title.');
    await store.transact(next => { next.games.find(item => item.id === input.id).title = title; });
    return publicState();
  });
  register('launchGame', launchGame);
  register('setFavorite', async input => {
    if (!input || typeof input !== 'object' || typeof input.favorite !== 'boolean') throw new Error('Invalid favorite setting.');
    findGame(input.id);
    await store.transact(next => { next.games.find(game => game.id === input.id).favorite = input.favorite; });
    return publicState();
  });
  register('chooseGameArtwork', async input => {
    if (!input || !['icon', 'background'].includes(input.kind)) throw new Error('Invalid picture type.');
    const game = findGame(input.id);
    const filename = await chooseArtwork(`${game.id}-${input.kind}`);
    if (!filename) return null;
    await store.transact(next => { next.games.find(item => item.id === game.id)[`${input.kind}File`] = filename; });
    artCache.delete(game.id);
    return publicState();
  });
  register('clearGameArtwork', async input => {
    if (!input || !['icon', 'background'].includes(input.kind)) throw new Error('Invalid picture type.');
    const game = findGame(input.id);
    await store.transact(next => { delete next.games.find(item => item.id === game.id)[`${input.kind}File`]; });
    artCache.delete(game.id);
    return publicState();
  });
  register('chooseProfileAvatar', async () => {
    const filename = await chooseArtwork('profile');
    if (!filename) return null;
    await store.transact(next => { next.settings.profileAvatar = filename; });
    return publicState();
  });
  register('clearProfileAvatar', async () => {
    await store.transact(next => { next.settings.profileAvatar = null; });
    return publicState();
  });
  register('chooseFont', async () => {
    const selected = await selectFile({ title: 'Choose a custom font', properties: ['openFile'], filters: [{ name: 'Fonts (up to 16 MB)', extensions: ['ttf', 'otf', 'woff', 'woff2'] }] });
    if (!selected) return null;
    const extension = path.extname(selected).toLowerCase();
    if (!['.ttf', '.otf', '.woff', '.woff2'].includes(extension) || !(await regularFile(selected, 16 * 1024 * 1024))) throw new Error('Choose a TTF, OTF, WOFF or WOFF2 font smaller than 16 MB.');
    const buffer = await readBounded(selected, 16 * 1024 * 1024);
    const signature = buffer.subarray(0, 4).toString('hex');
    if (!['00010000', '4f54544f', '74727565', '774f4646', '774f4632'].includes(signature)) throw new Error('This file is not a supported font.');
    const directory = path.join(store.directory, 'fonts');
    await fs.mkdir(directory, { recursive: true });
    const filename = `font-${randomUUID()}${extension}`;
    await fs.writeFile(path.join(directory, filename), buffer, { flag: 'wx' });
    await store.transact(next => { next.settings.customFont = filename; });
    return publicState();
  });
  register('resetFont', async () => {
    await store.transact(next => { next.settings.customFont = null; });
    fontCache.clear();
    return publicState();
  });
  register('chooseSound', async kind => {
    if (!SOUND_KINDS.includes(kind)) throw new Error('Invalid sound.');
    const selected = await selectFile({ title: `Choose a ${kind} sound`, properties: ['openFile'], filters: [{ name: 'Audio files (up to 20 MB)', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] }] });
    if (!selected) return null;
    const ext = path.extname(selected).toLowerCase();
    if (!audioMime[ext] || !(await regularFile(selected, 20 * 1024 * 1024))) throw new Error('Choose a WAV, MP3, OGG, M4A or FLAC file smaller than 20 MB.');
    const data = await readBounded(selected, 20 * 1024 * 1024);
    const filename = `${kind}${ext}`;
    const soundDir = path.join(store.directory, 'sounds');
    await fs.mkdir(soundDir, { recursive: true });
    await fs.writeFile(path.join(soundDir, filename), data);
    soundCache.delete(filename);
    await store.transact(next => { next.settings.sounds[kind] = filename; });
    return publicState();
  });
  register('resetSound', async kind => {
    if (!SOUND_KINDS.includes(kind)) throw new Error('Invalid sound.');
    await store.transact(next => { next.settings.sounds[kind] = null; });
    return publicState();
  });
  register('toggleFullscreen', () => { const value = !window.isFullScreen(); window.setFullScreen(value); return value; });
  register('minimize', () => window.minimize());
  register('close', requestClose);
  register('requestClose', requestClose);
  register('finishClose', finishClose);
}

async function bootstrap() {
  if (!store.isNew) return;
  try {
    const legacyDir = path.join(app.getPath('appData'), 'Aura PS3');
    const legacyLibrary = path.join(legacyDir, 'library.json');
    if (await regularFile(legacyLibrary)) {
      await fs.copyFile(legacyLibrary, store.file);
      for (const sub of ['artwork', 'fonts', 'sounds']) {
        const srcSub = path.join(legacyDir, sub);
        const dstSub = path.join(store.directory, sub);
        try { await fs.cp(srcSub, dstSub, { recursive: true }); } catch {}
      }
      await store.load();
      if (!store.isNew) return;
    }
  } catch (err) { console.warn('Legacy migration skipped:', err.message); }
  try {
    const source = JSON.parse(await readBounded(path.join(__dirname, 'bootstrap.json'), 64 * 1024));
    const imported = [];
    for (const selected of Array.isArray(source.gamePaths) ? source.gamePaths.slice(0, 1000) : []) {
      try { imported.push(await describeGame(await resolveGame(selected))); } catch { /* removable drives can be disconnected */ }
    }
    const emulator = source.settings?.rpcs3Path;
    const validEmulator = typeof emulator === 'string' && path.isAbsolute(emulator) && await regularFile(emulator) &&
      (process.platform !== 'win32' || path.basename(emulator).toLowerCase() === 'rpcs3.exe');
    if (validEmulator || imported.length) await store.transact(next => {
      if (validEmulator) next.settings.rpcs3Path = emulator;
      next.games = [...new Map(imported.map(game => [game.id, game])).values()];
    });
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Bootstrap skipped:', error.message); }
}

async function smokeReport() {
  const output = argValue('--smoke-output');
  if (!output || !path.isAbsolute(output)) { console.error('--smoke-output requires an absolute PNG path.'); exitApp(2); return; }
  try {
    const details = await window.webContents.executeJavaScript(`({ title: document.title, ready: document.readyState, text: document.body.innerText, width: innerWidth, height: innerHeight, launcher: typeof window.launcher, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight })`);
    const waveBefore = await window.webContents.executeJavaScript(`window.__auraWaveStatus?.() ?? null`);
    await new Promise(resolve => setTimeout(resolve, 360));
    const waveAfter = await window.webContents.executeJavaScript(`window.__auraWaveStatus?.() ?? null`);
    details.waveMotion = { before: waveBefore, after: waveAfter };
    if (!waveBefore || !waveAfter || waveAfter.idleFrames <= waveBefore.idleFrames)
      smokeErrors.push('Idle ribbon did not advance during the motion check.');
    details.errors = smokeErrors;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, (await window.webContents.capturePage()).toPNG());
    await fs.writeFile(output.replace(/\.png$/i, '') + '.json', JSON.stringify(details, null, 2));
    exitApp(smokeErrors.length ? 1 : 0);
  } catch (error) { console.error(error); exitApp(2); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', restoreWindow);
  app.on('before-quit', () => { quitting = true; stopControllers(); });
  process.on('exit', stopControllers);
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    store = new Store(app.getPath('userData'));
    await store.load();
    await bootstrap();
    if (store.warning) runtime.error = store.warning;
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"] } }));
    installHandlers();
    window = new BrowserWindow({ width: 1280, height: 800, minWidth: 960, minHeight: 640, title: 'XROSS-MEDIA-8A3',
      backgroundColor: '#03192d', show: false, frame: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('console-message', details => { if (details.level === 'error') smokeErrors.push(details.message); });
    window.webContents.on('render-process-gone', (_event, details) => { console.error('Renderer exited:', details.reason); if (smoke) exitApp(2); });
    window.on('focus', () => { finishExternalLaunch(); broadcastGamepads(); });
    window.on('restore', () => {
      if (!mediaMinimized) return;
      mediaMinimized = false;
      if (!window.isFullScreen()) window.setFullScreen(true);
    });
    window.on('blur', broadcastGamepads);
    window.on('close', event => {
      if (quitting || closeApproved) return;
      event.preventDefault();
      requestClose();
    });
    // This is a couch-style console shell, so every new session starts fullscreen.
    window.setFullScreen(true);
    window.once('ready-to-show', () => { window.setFullScreen(true); window.show(); });
    try {
      const { startXInput } = require('./lib/xinput.cjs');
      controllerBridge = startXInput({
        onState: state => {
          if (!state || !Number.isInteger(state.index) || state.index < 0 || state.index > 3) return;
          gamepads.set(state.index, state);
          broadcastGamepads();
        },
        onError: error => {
          console.warn('Native controller support:', error.message || String(error));
          sendRuntime({ controllerError: error.message || String(error) });
        }
      });
    } catch (error) {
      console.warn('Native controller support unavailable:', error.message);
      runtime.controllerError = error.message;
    }
    await window.loadFile(indexPath);
    if (smoke) setTimeout(smokeReport, smokeDelay);
  }).catch(error => { console.error(error); dialog.showErrorBox('XROSS-MEDIA-8A3 could not start', error.message); exitApp(1); });
}
