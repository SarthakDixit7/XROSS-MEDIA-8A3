'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_SETTINGS, MUTABLE_SETTINGS, SOUND_KINDS, validateSettings, cleanText, assertAbsolute, gameId, isArtworkName, isFontName } = require('./core.cjs');
const { validateSteamUrl } = require('./hub.cjs');
const { validateSavedMediaLinks } = require('./media.cjs');

function blankState() {
  return { version: 2, settings: { ...DEFAULT_SETTINGS, sounds: { ...DEFAULT_SETTINGS.sounds } }, games: [], mediaLinks: [] };
}

function validateSaved(raw) {
  if (!raw || ![1, 2].includes(raw.version) || !Array.isArray(raw.games) || raw.games.length > 10000 || !raw.settings) throw new Error('Unsupported library format.');
  const result = blankState();
  result.mediaLinks = validateSavedMediaLinks(raw.mediaLinks);
  const mutable = {};
  for (const key of MUTABLE_SETTINGS) {
    if (Object.hasOwn(raw.settings, key)) mutable[key] = raw.settings[key];
  }
  result.settings = validateSettings(mutable, result.settings);
  if (isArtworkName(raw.settings.profileAvatar)) result.settings.profileAvatar = raw.settings.profileAvatar;
  if (isFontName(raw.settings.customFont)) result.settings.customFont = raw.settings.customFont;
  if (raw.settings.rpcs3Path) result.settings.rpcs3Path = assertAbsolute(raw.settings.rpcs3Path, 'RPCS3');
  for (const kind of SOUND_KINDS) {
    const sound = raw.settings.sounds?.[kind];
    if (sound && typeof sound === 'string' && /^(startup|navigate|confirm)\.(wav|mp3|ogg|m4a|flac)$/.test(sound) && sound.startsWith(`${kind}.`)) {
      result.settings.sounds[kind] = sound;
    }
  }
  const seen = new Set();
  for (const item of raw.games) {
    if (!item || typeof item !== 'object') throw new Error('Invalid game in library.');
    const kind = item.kind || 'rpcs3';
    if (!['rpcs3', 'exe', 'shortcut', 'steam'].includes(kind)) throw new Error('Invalid game kind in library.');
    const file = kind === 'steam' ? validateSteamUrl(item.path) : assertAbsolute(item.path, 'Game');
    if (kind === 'rpcs3' && path.basename(file).toUpperCase() !== 'EBOOT.BIN') throw new Error('Invalid game path in library.');
    if (kind === 'exe' && path.extname(file).toLowerCase() !== '.exe') throw new Error('Invalid executable path in library.');
    if (kind === 'shortcut' && path.extname(file).toLowerCase() !== '.lnk') throw new Error('Invalid shortcut path in library.');
    const id = gameId(file);
    if (seen.has(id)) continue;
    seen.add(id);
    result.games.push({ id, kind, path: file, title: cleanText(item.title) || 'Untitled game', serial: cleanText(item.serial, 24),
      favorite: item.favorite === true, playCount: Number.isSafeInteger(item.playCount) && item.playCount >= 0 ? item.playCount : 0,
      ...(isArtworkName(item.iconFile) ? { iconFile: item.iconFile } : {}),
      ...(isArtworkName(item.backgroundFile) ? { backgroundFile: item.backgroundFile } : {}),
      ...(typeof item.lastPlayed === 'string' && Number.isFinite(Date.parse(item.lastPlayed)) ? { lastPlayed: item.lastPlayed } : {}) });
  }
  return result;
}

class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'library.json');
    this.state = blankState();
    this.queue = Promise.resolve();
    this.warning = null;
    this.isNew = false;
  }
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const info = await fs.stat(this.file);
      if (info.size > 8 * 1024 * 1024) throw new Error('Library file is too large.');
      this.state = validateSaved(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') this.isNew = true;
      else {
        const backup = path.join(this.directory, `library-recovery-${Date.now()}.json`);
        await fs.copyFile(this.file, backup);
        this.warning = `Your previous library could not be read. A backup was saved at ${backup}.`;
      }
    }
    return this.state;
  }
  transact(update) {
    const run = async () => {
      const next = structuredClone(this.state);
      await update(next);
      const validated = validateSaved(next);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx');
        try { await handle.writeFile(JSON.stringify(validated, null, 2), 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        await fs.rename(temporary, this.file);
        this.state = validated;
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return this.state;
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => {});
    return pending;
  }
}

module.exports = { Store, blankState, validateSaved };
