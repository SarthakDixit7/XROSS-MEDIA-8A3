/* Stock PS3 XMB pictograms decoded from the installed firmware icontex.qrc.
 * Every mapping points at the normalized HD canvas in assets/icons-hd so the
 * category row, submenu row, and dialogs share one optical size and padding. */
const icons = Object.freeze({
  users: 'users', settings: 'settings', system: 'settings',
  photo: 'photo', sound: 'music', music: 'music', video: 'video',
  game: 'game', controllers: 'game', network: 'network',
  browser: 'browser', media: 'browser', tv: 'browser',
  theme: 'settings', display: 'display', soundSettings: 'sound',
  clock: 'display', gameSettings: 'settings',
  friend: 'friends', friends: 'friends', search: 'search', play: 'play',
  plus: 'playlist-add', add: 'playlist-add', update: 'update',
  power: 'power', keyboard: 'keyboard', exit: 'exit',
});

export function firmwareIconPath(name) {
  const file = icons[name];
  return file ? `../assets/icons-hd/${file}.png` : null;
}

export function firmwareIcon(name) {
  const source = firmwareIconPath(name);
  return source ? `<img class="firmware-icon" src="${source}" alt="" draggable="false">` : null;
}
