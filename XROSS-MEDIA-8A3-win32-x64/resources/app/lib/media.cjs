'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { cleanText } = require('./core.cjs');

const MAX_MEDIA_LINKS = 40;
const YOUTUBE_LINK = Object.freeze({ id: 'youtube', title: 'YouTube', url: 'https://www.youtube.com/', builtin: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizeMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Enter a valid website address.');
  }
  const text = value.trim();
  if (!text || !/^https?:\/\//i.test(text)) throw new Error('Website links must start with https:// or http://.');
  let url;
  try { url = new URL(text); } catch { throw new Error('Enter a valid website address.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Enter a normal website address without a username or password.');
  }
  return url.href;
}

function validateMediaInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a site name and address.');
  const title = cleanText(input.title, 60);
  if (!title) throw new Error('Enter a site name.');
  return { title, url: normalizeMediaUrl(input.url) };
}

function validateSavedMediaLinks(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const ids = new Set();
  for (const input of value.slice(0, MAX_MEDIA_LINKS)) {
    try {
      if (!input || !UUID.test(input.id) || ids.has(input.id)) continue;
      const { title, url } = validateMediaInput(input);
      result.push({ id: input.id, title, url });
      ids.add(input.id);
    } catch { /* A bad bookmark must not make the game library unreadable. */ }
  }
  return result;
}

function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') return [
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
}

async function findChromeExecutable(platform = process.platform, env = process.env) {
  for (const candidate of chromeCandidates(platform, env)) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* Check the next installation location. */ }
  }
  return null;
}

module.exports = { MAX_MEDIA_LINKS, YOUTUBE_LINK, normalizeMediaUrl, validateMediaInput,
  validateSavedMediaLinks, chromeCandidates, findChromeExecutable };
