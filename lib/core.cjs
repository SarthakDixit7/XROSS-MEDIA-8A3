'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const SOUND_KINDS = ['startup', 'navigate', 'confirm'];
const DEFAULT_SETTINGS = Object.freeze({ rpcs3Path: '', volume: 0.45, muted: false,
  theme: 'ocean', skipIntro: false, hideOnLaunch: true, noGui: true, gameBackground: true,
  waveStyle: 'ps3', waveSpeed: 1, waveOpacity: 0.65, waveEnabled: true, animationsEnabled: true,
  clock24: true, showSeconds: false, uiScale: 1, startupDuration: 3, profileName: 'Player',
  profileAvatar: null, customFont: null, gameSort: 'manual',
  sounds: { startup: null, navigate: null, confirm: null } });

const MUTABLE_SETTINGS = ['volume', 'muted', 'theme', 'skipIntro', 'hideOnLaunch', 'noGui', 'gameBackground',
  'waveStyle', 'waveSpeed', 'waveOpacity', 'waveEnabled', 'animationsEnabled', 'clock24', 'showSeconds',
  'uiScale', 'startupDuration', 'profileName', 'gameSort'];

function cleanText(value, max = 180) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
}

function assertAbsolute(value, label = 'File') {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error(`${label} must have a valid absolute path.`);
  }
  return path.normalize(value);
}

function validateSettings(patch, current = DEFAULT_SETTINGS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings.');
  const result = { ...current, sounds: { ...current.sounds } };
  for (const [key, value] of Object.entries(patch)) {
    if (['muted', 'skipIntro', 'hideOnLaunch', 'noGui', 'gameBackground', 'waveEnabled', 'animationsEnabled', 'clock24', 'showSeconds'].includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`Invalid ${key} setting.`);
      result[key] = value;
    } else if (key === 'volume') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Volume must be between 0 and 1.');
      result.volume = value;
    } else if (key === 'theme') {
      if (!['ocean', 'violet', 'rose', 'midnight', 'amber', 'emerald', 'pearl'].includes(value)) throw new Error('Unknown theme.');
      result.theme = value;
    } else if (['waveSpeed', 'waveOpacity', 'uiScale', 'startupDuration'].includes(key)) {
      const [min, max] = { waveSpeed: [0.25, 2], waveOpacity: [0.1, 1], uiScale: [0.8, 1.3], startupDuration: [0, 5] }[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
      result[key] = value;
    } else if (key === 'waveStyle' || key === 'gameSort') {
      const allowed = key === 'waveStyle' ? ['ps3', 'psp'] : ['manual', 'title', 'recent'];
      if (!allowed.includes(value)) throw new Error(`Invalid ${key} setting.`);
      result[key] = value;
    } else if (key === 'profileName' || key === 'username') {
      const name = cleanText(value, 40);
      if (!name) throw new Error('Enter a profile name.');
      result.profileName = name;
    } else {
      throw new Error(`This setting cannot be changed directly: ${key}`);
    }
  }
  return result;
}

// PARAM.SFO is an indexed little-endian PSF document. Never trust offsets from a game dump.
function parseSfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.length > 1024 * 1024 ||
      buffer.readUInt32LE(0) !== 0x46535000) throw new Error('Invalid PARAM.SFO header.');
  const keyStart = buffer.readUInt32LE(8);
  const dataStart = buffer.readUInt32LE(12);
  const count = buffer.readUInt32LE(16);
  if (count > 4096 || 20 + count * 16 > keyStart || keyStart > dataStart || dataStart > buffer.length) {
    throw new Error('Invalid PARAM.SFO index.');
  }
  const values = Object.create(null);
  for (let i = 0; i < count; i++) {
    const at = 20 + i * 16;
    const keyAt = keyStart + buffer.readUInt16LE(at);
    const format = buffer.readUInt16LE(at + 2);
    const size = buffer.readUInt32LE(at + 4);
    const maxSize = buffer.readUInt32LE(at + 8);
    const valueAt = dataStart + buffer.readUInt32LE(at + 12);
    if (keyAt >= dataStart || size > maxSize || valueAt > buffer.length || size > buffer.length - valueAt) {
      throw new Error('Invalid PARAM.SFO entry.');
    }
    const keyEnd = buffer.indexOf(0, keyAt);
    if (keyEnd < keyAt || keyEnd >= dataStart) throw new Error('Invalid PARAM.SFO key.');
    const key = buffer.toString('utf8', keyAt, keyEnd);
    if (format === 0x0204) {
      values[key] = buffer.toString('utf8', valueAt, valueAt + size).split('\0')[0];
    } else if (format === 0x0404 && size === 4) {
      values[key] = buffer.readUInt32LE(valueAt);
    }
  }
  return values;
}

async function regularFile(file, maxBytes = Infinity) {
  try {
    const stat = await fs.lstat(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes;
  } catch { return false; }
}

async function safeCandidate(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) return null; }
    catch { return null; }
  }
  return await regularFile(current) ? current : null;
}

async function resolveGame(input) {
  const selected = assertAbsolute(input, 'Game');
  const stat = await fs.lstat(selected);
  if (stat.isSymbolicLink()) throw new Error('Choose the original game folder, not a shortcut or symbolic link.');
  if (stat.isFile()) {
    if (path.basename(selected).toUpperCase() !== 'EBOOT.BIN' || path.basename(path.dirname(selected)).toUpperCase() !== 'USRDIR') {
      throw new Error('Choose the game’s USRDIR/EBOOT.BIN file.');
    }
    return fs.realpath(selected);
  }
  if (!stat.isDirectory()) throw new Error('Choose a game folder.');
  for (const segments of [['PS3_GAME', 'USRDIR', 'EBOOT.BIN'], ['USRDIR', 'EBOOT.BIN'], ['EBOOT.BIN']]) {
    if (segments.length === 1 && path.basename(selected).toUpperCase() !== 'USRDIR') continue;
    const candidate = await safeCandidate(selected, segments);
    if (candidate) return fs.realpath(candidate);
  }
  throw new Error('No game found here. Select a game folder containing PS3_GAME/USRDIR/EBOOT.BIN or USRDIR/EBOOT.BIN. Install PKG games in RPCS3 first.');
}

async function readBounded(file, maxBytes) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('File is too large.');
    const data = Buffer.alloc(stat.size);
    let read = 0;
    while (read < data.length) {
      const result = await handle.read(data, read, data.length - read, read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    return data.subarray(0, read);
  } finally { await handle.close(); }
}

async function imageData(file) {
  try {
    if (!(await regularFile(file, 12 * 1024 * 1024))) return null;
    const data = await readBounded(file, 12 * 1024 * 1024);
    const mime = imageMime(data);
    return mime ? `data:${mime};base64,${data.toString('base64')}` : null;
  } catch { return null; }
}

function imageMime(data) {
  if (data.length >= 8 && data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function gameId(file) {
  const stable = process.platform === 'win32' ? file.toLowerCase() : file;
  return createHash('sha256').update(stable).digest('hex').slice(0, 24);
}

async function describeGame(file) {
  const gameRoot = path.dirname(path.dirname(file));
  const fallback = path.basename(gameRoot).toUpperCase() === 'PS3_GAME' ? path.basename(path.dirname(gameRoot)) : path.basename(gameRoot);
  let metadata = {};
  try { metadata = parseSfo(await readBounded(path.join(gameRoot, 'PARAM.SFO'), 1024 * 1024)); } catch { /* incomplete dump: folder name is useful */ }
  return { id: gameId(file), title: cleanText(metadata.TITLE) || cleanText(fallback) || 'Untitled game',
    serial: cleanText(metadata.TITLE_ID, 24), kind: 'rpcs3', path: file, favorite: false, playCount: 0 };
}

async function gameArtwork(game, directory) {
  const root = (game.kind || 'rpcs3') === 'rpcs3' ? path.dirname(path.dirname(game.path)) : null;
  const [icon, background] = await Promise.all(['icon', 'background'].map(kind => {
    const custom = game[`${kind}File`];
    if (directory && isArtworkName(custom)) return imageData(path.join(directory, 'artwork', custom));
    return root ? imageData(path.join(root, kind === 'icon' ? 'ICON0.PNG' : 'PIC1.PNG')) : null;
  }));
  return { ...game, icon, background };
}

function isArtworkName(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{24}-(?:icon|background)|profile)-[a-f0-9-]{36}\.png$/.test(value);
}

function isFontName(value) {
  return typeof value === 'string' && /^font-[a-f0-9-]{36}\.(?:ttf|otf|woff2?)$/.test(value);
}

async function scanGames(root, { maxDepth = 4, maxDirectories = 3000 } = {}) {
  const target = assertAbsolute(root, 'Library');
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a normal library folder.');
  const games = new Map();
  const warnings = [];
  const queue = [{ dir: target, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxDirectories) {
    const { dir, depth } = queue.shift();
    visited++;
    try {
      const file = await resolveGame(dir);
      const game = await describeGame(file);
      games.set(game.id, game);
      // Game contents can be enormous and do not contain other game roots.
      continue;
    } catch { /* this may be a library parent */ }
    if (depth >= maxDepth) continue;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') &&
            !['node_modules', 'cache', 'shadercache', '$RECYCLE.BIN', 'System Volume Information'].includes(entry.name)) {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
      }
    } catch { if (warnings.length < 20) warnings.push(`Could not read ${path.basename(dir)}.`); }
  }
  if (queue.length) warnings.push(`Stopped after ${maxDirectories} folders. Scan a smaller folder to find more games.`);
  return { games: [...games.values()], warnings };
}

function buildLaunch(executable, game, noGui = true) {
  const executablePath = assertAbsolute(executable, 'RPCS3');
  const gamePath = assertAbsolute(game, 'Game');
  if (process.platform === 'win32' && path.basename(executablePath).toLowerCase() !== 'rpcs3.exe') {
    throw new Error('Select rpcs3.exe from your RPCS3 folder.');
  }
  if (path.basename(gamePath).toUpperCase() !== 'EBOOT.BIN') throw new Error('The game must point to EBOOT.BIN.');
  return { executable: executablePath, args: [...(noGui ? ['--no-gui'] : []), gamePath],
    options: { cwd: path.dirname(executablePath), shell: false, windowsHide: false, stdio: 'ignore' } };
}

module.exports = { DEFAULT_SETTINGS, MUTABLE_SETTINGS, SOUND_KINDS, cleanText, assertAbsolute, validateSettings, parseSfo,
  regularFile, readBounded, resolveGame, describeGame, gameArtwork, scanGames, buildLaunch, gameId,
  imageMime, imageData, isArtworkName, isFontName };
