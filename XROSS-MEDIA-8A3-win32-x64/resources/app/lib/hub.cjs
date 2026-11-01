'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { assertAbsolute, cleanText, regularFile, readBounded, gameId } = require('./core.cjs');

function validateSteamUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value || !/^steam:\/\/(?:rungameid|run)\/[0-9]{1,20}$/.test(value)) {
    throw new Error('Choose a Steam game shortcut using steam://rungameid/<game ID> or steam://run/<game ID>.');
  }
  // Both supported forms refer to the same game, so imports deduplicate.
  return `steam://rungameid/${BigInt(value.slice(value.lastIndexOf('/') + 1))}`;
}

function parseSteamShortcut(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length > 64 * 1024) throw new Error('This shortcut is too large.');
  let text = buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
    ? buffer.subarray(2).toString('utf16le') : buffer.toString('utf8').replace(/^\uFEFF/, '');
  let inShortcut = false;
  const urls = [];
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) { inShortcut = section[1].toLowerCase() === 'internetshortcut'; continue; }
    const match = /^\s*URL\s*=\s*(.*?)\s*$/i.exec(line);
    if (inShortcut && match) urls.push(match[1]);
  }
  if (urls.length !== 1) throw new Error('This is not a valid Steam Internet shortcut.');
  return validateSteamUrl(urls[0]);
}

async function executablePath(input) {
  const selected = assertAbsolute(input, 'Executable');
  if (path.extname(selected).toLowerCase() !== '.exe' || !(await regularFile(selected))) {
    throw new Error('Choose an existing Windows .exe file.');
  }
  return fs.realpath(selected);
}

async function describeExecutable(input) {
  const file = await executablePath(input);
  return { id: gameId(file), kind: 'exe', path: file, title: cleanText(path.basename(file, path.extname(file))) || 'PC game', serial: '', favorite: false, playCount: 0 };
}

async function describeShortcut(input, readShortcutLink) {
  const selected = assertAbsolute(input, 'Shortcut');
  const ext = path.extname(selected).toLowerCase();
  if (!['.url', '.lnk'].includes(ext) || !(await regularFile(selected, 1024 * 1024))) throw new Error('Choose a Windows .lnk or Steam .url shortcut.');
  const file = await fs.realpath(selected);
  let kind = 'shortcut';
  let target = file;
  if (ext === '.url') {
    target = parseSteamShortcut(await readBounded(file, 64 * 1024));
    kind = 'steam';
  } else {
    if (typeof readShortcutLink !== 'function') throw new Error('Windows shortcuts are only supported on Windows.');
    const details = readShortcutLink(file);
    await executablePath(details.target);
  }
  return { id: gameId(target), kind, path: target, title: cleanText(path.basename(file, ext)) || 'PC game', serial: '', favorite: false, playCount: 0 };
}

function buildExecutableLaunch(file) {
  const executable = assertAbsolute(file, 'Executable');
  if (path.extname(executable).toLowerCase() !== '.exe') throw new Error('The game must point to an .exe file.');
  return { executable, args: [], options: { cwd: path.dirname(executable), shell: false, windowsHide: false, stdio: 'ignore' } };
}

module.exports = { validateSteamUrl, parseSteamShortcut, executablePath, describeExecutable, describeShortcut, buildExecutableLaunch };
