'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke(`launcher:${name}`, ...args);

contextBridge.exposeInMainWorld('launcher', Object.freeze({
  getState: () => invoke('getState'),
  addMediaLink: input => invoke('addMediaLink', input),
  updateMediaLink: input => invoke('updateMediaLink', input),
  removeMediaLink: id => invoke('removeMediaLink', id),
  openMediaLink: id => invoke('openMediaLink', id),
  chooseEmulator: () => invoke('chooseEmulator'),
  addGame: () => invoke('addGame'),
  addGameFile: () => invoke('addGameFile'),
  addExecutable: () => invoke('addExecutable'),
  addShortcut: () => invoke('addShortcut'),
  scanGames: () => invoke('scanGames'),
  updateSettings: patch => invoke('updateSettings', patch),
  removeGame: id => invoke('removeGame', id),
  renameGame: input => invoke('renameGame', input),
  launchGame: id => invoke('launchGame', id),
  chooseGameArtwork: input => invoke('chooseGameArtwork', input),
  clearGameArtwork: input => invoke('clearGameArtwork', input),
  setFavorite: input => invoke('setFavorite', input),
  chooseProfileAvatar: () => invoke('chooseProfileAvatar'),
  clearProfileAvatar: () => invoke('clearProfileAvatar'),
  chooseFont: () => invoke('chooseFont'),
  resetFont: () => invoke('resetFont'),
  chooseSound: kind => invoke('chooseSound', kind),
  resetSound: kind => invoke('resetSound', kind),
  toggleFullscreen: () => invoke('toggleFullscreen'),
  minimize: () => invoke('minimize'),
  close: () => invoke('close'),
  requestClose: () => invoke('requestClose'),
  finishClose: () => invoke('finishClose'),
  onBeforeClose: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = () => callback();
    ipcRenderer.on('launcher:beforeClose', listener);
    return () => { ipcRenderer.removeListener('launcher:beforeClose', listener); };
  },
  getGamepadState: () => invoke('getGamepadState'),
  onGamepad: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('launcher:gamepad', listener);
    return () => { ipcRenderer.removeListener('launcher:gamepad', listener); };
  },
  onRuntime: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, runtime) => callback(runtime);
    ipcRenderer.on('launcher:runtime', listener);
    return () => { ipcRenderer.removeListener('launcher:runtime', listener); };
  }
}));
