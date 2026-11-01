'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function findHelper() {
  const bundled = path.join(__dirname, '..', 'assets', 'XInputBridge.exe');
  // Executables must be unpacked when Electron is packaged with an ASAR.
  const unpacked = bundled.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2');
  return [...new Set([unpacked, bundled])].find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function validState(value) {
  if (!value || !Number.isInteger(value.index) || value.index < 0 || value.index > 3 ||
      typeof value.connected !== 'boolean' || value.normalized !== true ||
      !Number.isInteger(value.buttons) || value.buttons < 0 || value.buttons > 65535) return false;
  return ['leftX', 'leftY', 'rightX', 'rightY'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1) &&
    ['leftTrigger', 'rightTrigger'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
}

/**
 * Begin native Windows Xbox controller polling. onState receives individual
 * controller snapshots, including initial empty slots and disconnects.
 * Axes are normalized [-1,1] with Y positive up; triggers are [0,1].
 * Returns { stop(), getStates() }. Browser Gamepad API can remain the fallback.
 */
function startXInput({ onState = () => {}, onError = () => {} } = {}) {
  let child = null;
  let stopped = false;
  let pending = '';
  let stderr = '';
  let reportedError = false;
  const states = new Map();
  const previous = new Map();

  function report(error) {
    if (reportedError || stopped) return;
    reportedError = true;
    onError(error instanceof Error ? error : new Error(String(error)));
  }

  function emit(state) {
    const serialized = JSON.stringify(state);
    if (previous.get(state.index) === serialized) return;
    previous.set(state.index, serialized);
    states.set(state.index, state);
    onState({ ...state });
  }

  function disconnected() {
    for (const state of states.values()) {
      if (state.connected) emit({ ...state, connected: false, buttons: 0,
        leftX: 0, leftY: 0, rightX: 0, rightY: 0, leftTrigger: 0, rightTrigger: 0 });
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    process.removeListener('exit', stop);
    if (child && child.exitCode === null) child.kill();
    child = null;
    disconnected();
  }

  const handle = { stop, getStates: () => [...states.values()].map(state => ({ ...state })) };
  if (process.platform !== 'win32') return handle;
  const helper = findHelper();
  if (!helper) {
    queueMicrotask(() => report(new Error('Native XInput helper is unavailable; browser controller input remains available.')));
    return handle;
  }
  try {
    child = spawn(helper, ['--parent', String(process.pid)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    process.once('exit', stop);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stopped) return;
      pending += chunk;
      if (pending.length > 65536) {
        report(new Error('Native XInput helper returned an oversized response.'));
        stop();
        return;
      }
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line) continue;
        let state;
        try { state = JSON.parse(line); }
        catch { report(new Error('Native XInput helper returned malformed controller data.')); continue; }
        if (validState(state)) emit(state);
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
    child.on('error', report);
    child.on('close', code => {
      process.removeListener('exit', stop);
      if (!stopped) {
        disconnected();
        report(new Error(stderr.trim() || `Native XInput helper stopped (exit ${code}). Browser controller input remains available.`));
      }
    });
  } catch (error) { report(error); }
  return handle;
}

module.exports = { startXInput };
