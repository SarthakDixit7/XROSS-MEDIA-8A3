import { LauncherAudio } from './audio.js';
import { ControllerInput } from './controller.js';
import { createWaveScene } from './wave-engine.js';
import { createDialogInput } from './dialog-input.js';
import { firmwareIcon } from './firmware-icons.js';
import { createMediaCenter } from './media-center.js';

const $ = q => document.querySelector(q), $$ = q => [...document.querySelectorAll(q)];
const api = window.launcher, audio = new LauncherAudio();
const waveScene = createWaveScene({ idleCanvas: $('#idle-wave-canvas'), bootCanvas: $('#boot-wave-canvas') });
window.__auraWaveStatus = () => waveScene.status;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
  users:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/>',
  settings:'<path d="m9.5 3-.6 2.2-2 .9-2-.8-2.5 4.3 1.7 1.5v2.2l-1.7 1.5 2.5 4.3 2-.8 2 .9.6 2.2h5l.6-2.2 2-.9 2 .8 2.5-4.3-1.7-1.5v-2.2l1.7-1.5-2.5-4.3-2 .8-2-.9L14.5 3Z"/><circle cx="12" cy="12.2" r="3.2"/>',
  photo:'<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 3 3 3-3 5 5"/>',
  sound:'<path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
  video:'<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 5v14m8-14v14M3 9h5m8 0h5M3 15h5m8 0h5"/>',
  game:'<path d="M6.3 6h11.4c2.2 0 3.5 2.2 4.1 5.6l.8 4.5c.4 2.4-1.8 3.8-3.5 2.1L16.5 16h-9l-2.6 2.2c-1.7 1.7-3.9.3-3.5-2.1l.8-4.5C2.8 8.2 4.1 6 6.3 6Z"/><path d="M7.2 9.1v5M4.7 11.6h5"/><circle cx="16.5" cy="10.2" r=".7"/><circle cx="19" cy="12.7" r=".7"/>',
  network:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9"/>',
  controllers:'<path d="M7 3h10v6H7zM7 15h10v6H7zM2 6h5m10 0h5M2 18h5m10 0h5"/>',
  windows:'<path d="m3 5 8-1v7H3Zm10-1 8-1v8h-8ZM3 13h8v7l-8-1Zm10 0h8v8l-8-1Z"/>',
  steam:'<circle cx="16" cy="7" r="5"/><circle cx="16" cy="7" r="2.5"/><circle cx="7" cy="17" r="4"/><path d="m10 19 8-7M7 13l4-8M1 13l7 3"/>',
  folder:'<path d="M3 7V4h7l2 3h9v13H3V7Z"/><path d="M3 9h18"/>',
  search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  file:'<path d="M5 2h9l5 5v15H5V2Z"/><path d="M14 2v6h5"/>',
  check:'<path d="m4 13 5 5L20 6"/>', plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>', expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  theme:'<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4H17a4 4 0 0 0 4-4c0-3.3-4-6-9-6Z"/>',
  play:'<path d="m7 4 13 8-13 8V4Z"/>', power:'<path d="M12 2v10m-6.4-7A9 9 0 1 0 18.4 5"/>',
  star:'<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>'
};
const icon = name => firmwareIcon(name) || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.game}</svg>`;
$$('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const categories = [
  { id:'users', label:'Users', icon:'users' }, { id:'settings', label:'Settings', icon:'settings' },
  { id:'photo', label:'Photo', icon:'photo' }, { id:'sound', label:'Music', icon:'sound' },
  { id:'video', label:'Video', icon:'video' }, { id:'games', label:'Game', icon:'game' },
  { id:'network', label:'Network', icon:'network' }, { id:'media', label:'Media Center', icon:'media' },
  { id:'controllers', label:'Controllers', icon:'controllers' }
];
let state, categoryIndex = 5, itemByCategory = {}, introDone = false, busy = false;
let toastTimer, bootTimer, returnTimer, controllerInfo = { connected:false }, managedGameId, removeGameId;
let favoriteOnly = false, settingsRevision = 0, settingsQueue = Promise.resolve(), fontUrl = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dialogInput = createDialogInput({ onNavigate: () => audio.navigate(), onConfirm: () => audio.confirm(),
  onBack: () => audio.back(), onClose: dialog => closeDialog(dialog, { silent:true }) });
const mediaCenter = createMediaCenter({ dialog:$('#media-dialog'), api,
  onState:next => applyState(next), onError:error => toast(errorText(error),true),
  onOpen:() => open('#media-dialog'), onClose:dialog => closeDialog(dialog),
  onFocus:() => dialogInput.focusFirst($('#media-dialog')) });
const category = () => categories[categoryIndex].id;
const selected = () => items()[itemByCategory[category()] || 0];
const currentGame = () => selected()?.game || null;
const managedGame = () => state?.games.find(game => game.id === managedGameId);
const gameType = game => ({ rpcs3:'PlayStation®3', exe:'Windows Game', steam:'Steam', shortcut:'Windows Shortcut' })[game.kind || 'rpcs3'];
const gameIcon = game => ({ exe:'windows', steam:'steam', shortcut:'windows' })[game.kind] || 'game';
const itemOffset = offset => offset === 0 ? '0vh' : offset < 0 ? `${-31-8*(Math.abs(offset)-1)}vh` : `${15+8*(offset-1)}vh`;

function toast(text, error = false) {
  clearTimeout(toastTimer); const el = $('#toast'); el.textContent = text; el.classList.toggle('error', error); el.hidden = false;
  toastTimer = setTimeout(() => el.hidden = true, error ? 7000 : 3500);
}
function errorText(error) { return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
async function run(fn, success) {
  if (busy) return null; busy = true;
  try { const result = await fn(); if (result?.settings) applyState(result); if (success && result) toast(success); return result; }
  catch (error) { toast(errorText(error), true); return null; } finally { busy = false; }
}
function games() {
  const list = state.games.filter(game => !favoriteOnly || game.favorite);
  if (state.settings.gameSort === 'title') list.sort((a,b) => a.title.localeCompare(b.title));
  if (state.settings.gameSort === 'recent') list.sort((a,b) => (Date.parse(b.lastPlayed) || 0) - (Date.parse(a.lastPlayed) || 0));
  return list;
}
function items() {
  if (!state) return [];
  const entry = (id, label, description, iconName, action) => ({ id, label, description, iconName, action });
  if (category() === 'games') return [
    ...games().map(game => ({ id:game.id, label:game.title, description:gameType(game),
      caption:[game.serial, game.playCount ? `Played ${game.playCount} time${game.playCount === 1 ? '' : 's'}` : 'Ready to play'].filter(Boolean).join(' · '),
      icon:game.icon, iconName:gameIcon(game), game, action:() => playGame(game) })),
    entry('add', 'Add to Collection', 'Windows games, Steam shortcuts and PlayStation®3', 'plus', () => open('#add-dialog'))
  ];
  if (category() === 'settings') return [
    entry('system','System Settings','Startup, launch behaviour and library order','settings',() => open('#settings-dialog')),
    entry('display','Display & Theme','PS3 / PSP waves, colours, font and interface size','theme',() => open('#theme-dialog')),
    entry('sound','Sound Settings','PSP startup chime and XMB menu sounds','soundSettings',() => open('#sound-dialog')),
    entry('controller','Controller Settings','Xbox controller, choice lists and on-screen keyboard','game',() => open('#controller-dialog')),
    entry('exit','Turn Off XROSS-MEDIA-8A3','Close the game hub','power',() => api.requestClose())
  ];
  if (category() === 'users') return [entry('profile',state.settings.profileName,'Profile picture, name and clock settings','users',() => open('#profile-dialog'))];
  if (category() === 'photo') return [
    entry('artwork','Game Artwork','Select a game, then press Y → Artwork & Details','photo',() => { categoryIndex = 5; render(); if (currentGame()) manage(currentGame()); else open('#add-dialog'); }),
    entry('display','Background Settings','Wave style, colours and game backgrounds','theme',() => open('#theme-dialog'))
  ];
  if (category() === 'sound') return [entry('sounds','Menu Sounds','Preview or change startup, cursor and confirmation sounds','sound',() => open('#sound-dialog'))];
  if (category() === 'video') return [entry('captures','Game Captures','Screenshots and recordings stay with each game or emulator','video',() => info('Game Captures','Use Steam’s screenshot tools or RPCS3’s capture controls during gameplay. XROSS-MEDIA-8A3 keeps your existing capture and save folders in place.'))];
  if (category() === 'network') return [
    entry('steam','Steam Games','Add a game using its Steam desktop shortcut','steam',() => importGame('addShortcut')),
    entry('rpc','RPCS3 Connection',state.settings.rpcs3Path ? 'Your emulator is connected' : 'Select rpcs3.exe to play PS3 games','network',() => run(() => api.chooseEmulator(),'RPCS3 connected.'))
  ];
  if (category() === 'media') return [
    ...(state.mediaLinks || []).map(link => ({ id:link.id, label:link.title, description:link.builtin ? 'Video · opens in Chrome' : 'Saved website · opens in Chrome',
      caption:link.url, iconName:link.builtin ? 'browser' : 'media', action:() => mediaCenter.openLink(link.id) })),
    entry('manage-media','Manage Media Tabs','Add, edit or remove saved websites','add',() => mediaCenter.show())
  ];
  return [entry('pad','Controller Settings',controllerInfo.connected ? `${controllerInfo.source} controller ${controllerInfo.index + 1} connected` : 'Connect an Xbox controller','game',() => open('#controller-dialog'))];
}
function renderCategories() {
  $('#category-track').style.transform = `translateX(calc(${-categoryIndex} * var(--category-step)))`;
  if (!$('#category-track').children.length) $('#category-track').innerHTML = categories.map((c,i) => `<button class="category" style="--index:${i}" data-category="${i}" aria-label="${c.label}"><span class="category-symbol">${icon(c.icon)}</span><span class="category-label">${c.label}</span></button>`).join('');
  $$('#category-track button').forEach((button,i) => { button.classList.toggle('active',i === categoryIndex); button.setAttribute('aria-current',String(i === categoryIndex)); });
}
function renderItems() {
  const list = items(), index = Math.max(0, Math.min(list.length - 1, itemByCategory[category()] || 0)); itemByCategory[category()] = index;
  const container = $('#xmb-items'), existing = new Map([...container.children].map(button => [button.dataset.key,button]));
  const nodes = list.flatMap((item,i) => {
    if (Math.abs(i-index) > 6) return [];
    const key = category()+':'+item.id, button = existing.get(key) || document.createElement('button');
    button.className = `xmb-item ${i === index ? 'selected' : ''}`; button.style.setProperty('--item-offset',itemOffset(i-index));
    button.dataset.item = i; button.dataset.key = key; button.setAttribute('aria-label',item.label); button.tabIndex = i === index ? 0 : -1;
    const content = `<span class="item-symbol">${item.icon ? `<img src="${esc(item.icon)}" alt="">` : icon(item.iconName)}${item.game?.favorite ? '<span class="item-favorite" aria-label="Favorite">★</span>' : ''}</span><span class="item-copy"><span class="item-label">${esc(item.label)}</span><span class="item-description">${esc(item.description)}</span>${item.caption ? `<span class="item-caption">${esc(item.caption)}</span>` : ''}</span>`;
    if (button._content !== content) { button.innerHTML = content; button._content = content; }
    return [button];
  });
  // Keep mounted buttons in place so their position/scale transitions can run.
  for (const child of [...container.children]) if (!nodes.includes(child)) child.remove();
  nodes.forEach((node,i) => { if (container.children[i] !== node) container.insertBefore(node,container.children[i] || null); });
  const game = currentGame(), background = $('#game-background');
  if (state.settings.gameBackground && game?.background) { if (background.src !== game.background) background.src = game.background; background.classList.add('visible'); }
  else background.classList.remove('visible');
  $('#collection-meta').textContent = category() === 'media' ? `Media Center · ${(state.mediaLinks || []).length} tabs` :
    `${favoriteOnly ? 'Favorites' : 'Collection'} · ${state.games.length} game${state.games.length === 1 ? '' : 's'} · ${state.games.filter(g => g.favorite).length} favorites`;
}
function avatar(element, source) { element.innerHTML = source ? `<img src="${esc(source)}" alt="Profile picture">` : icon('users'); }
function clock() {
  if (!state) return; const now = new Date(), s = state.settings;
  $('#clock').dateTime = now.toISOString();
  $('#clock').textContent = now.toLocaleDateString(undefined, { month:'numeric', day:'numeric' }) + '  ' + now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', ...(s.showSeconds ? { second:'2-digit' } : {}), hour12:!s.clock24 });
}
function appearance() {
  const s = state.settings; audio.configure(s); waveScene.configure(s);
  document.body.dataset.theme = s.theme; document.body.dataset.animations = s.animationsEnabled ? 'on' : 'off';
  document.documentElement.style.setProperty('--ui-scale', s.uiScale);
  if (fontUrl !== s.customFont) {
    fontUrl = s.customFont; let style = $('#custom-font-style');
    if (!style) { style = document.createElement('style'); style.id = 'custom-font-style'; document.head.append(style); }
    style.textContent = fontUrl ? `@font-face{font-family:AuraCustom;src:url("${fontUrl}");font-display:swap}` : '';
    document.documentElement.style.setProperty('--font', `${fontUrl ? 'AuraCustom,' : ''}"PS3 Rodin","Segoe UI",Arial,sans-serif`);
  }
  $('#header-profile').textContent = s.profileName; avatar($('#header-avatar'), s.profileAvatar); clock();
}
function render() {
  if (!state) return; appearance(); renderCategories(); renderItems(); fillDialogs();
  $('#system-status').textContent = state.runtime.runningGameId ? 'Game running' : `${state.games.length} game${state.games.length === 1 ? '' : 's'} · Ready`;
}
function applyState(next) {
  const selectedId = currentGame()?.id; state = next;
  mediaCenter.setState(next);
  if (selectedId && category() === 'games') { const index = games().findIndex(game => game.id === selectedId); if (index >= 0) itemByCategory.games = index; }
  render();
}
function moveCategory(delta) { categoryIndex = (categoryIndex + delta + categories.length) % categories.length; audio.navigate(); renderCategories(); renderItems(); }
function moveItem(delta) { const id = category(), count = items().length; const next = Math.max(0, Math.min(count-1, (itemByCategory[id] || 0)+delta)); if (next !== (itemByCategory[id] || 0)) { itemByCategory[id] = next; audio.navigate(); renderItems(); } }
function activate() { if (!busy) { audio.confirm(); selected()?.action?.(); } }
function dismissIntro() {
  if (introDone) return; introDone = true; clearTimeout(bootTimer);
  $('#intro').classList.add('dismissed'); $('#intro').inert = true; $('#intro').setAttribute('aria-hidden','true'); document.body.classList.remove('booting');
  setTimeout(() => waveScene.stopBoot(), state?.settings.animationsEnabled === false ? 0 : 850);
}
function open(selector) {
  const dialog = $(selector); if (dialog.open) return;
  fillDialogs(true); dialog.classList.remove('closing'); dialog.showModal(); dialogInput.focusFirst(dialog); audio.confirm();
}
async function closeDialog(dialog = $$('dialog[open]').at(-1), { silent = false, immediate = false } = {}) {
  if (!dialog?.open || dialog.classList.contains('closing')) return;
  if (!silent) audio.back(); dialogInput.reset();
  if (!immediate && state?.settings.animationsEnabled) { dialog.classList.add('closing'); await sleep(160); }
  dialog.close(); dialog.classList.remove('closing');
}
function closeAll() { for (const dialog of $$('dialog[open]')) closeDialog(dialog, { silent:true, immediate:true }); }
function info(title, text) { $('#info-title').textContent = title; $('#info-content').innerHTML = `<p class="help-text">${esc(text)}</p>`; open('#info-dialog'); }
function fillDialogs(force = false) {
  if (!state) return; const s = state.settings;
  const values = {
    'startup-select':s.skipIntro ? 'off' : 'on', 'boot-duration-select':String(s.startupDuration),
    'animations-select':s.animationsEnabled ? 'on' : 'off', 'minimize-select':s.hideOnLaunch ? 'on' : 'off',
    'nogui-select':s.noGui ? 'on' : 'off', 'sort-select':s.gameSort, 'theme-select':s.theme,
    'wave-style-select':s.waveStyle, 'wave-enabled-select':s.waveEnabled ? 'on' : 'off',
    'artwork-select':s.gameBackground ? 'on' : 'off', 'sound-select':s.muted ? 'off' : 'on',
    'clock-format-select':s.clock24 ? '24' : '12', 'seconds-select':s.showSeconds ? 'on' : 'off'
  };
  for (const [id,value] of Object.entries(values)) $('#'+id).value = value;
  for (const [id,key] of [['volume','volume'],['wave-speed','waveSpeed'],['wave-opacity','waveOpacity'],['ui-scale','uiScale']]) {
    const value = Math.round(s[key]*100); if (document.activeElement !== $('#'+id)) $('#'+id).value = value; $('#'+id+'-value').textContent = value+'%';
  }
  $('#emulator-path').textContent = s.rpcs3Path || 'Not connected';
  $('#font-description').textContent = s.customFont ? 'Your custom font' : 'PS3 Rodin · console firmware font';
  $('#profile-preview-name').textContent = s.profileName; avatar($('#profile-preview-avatar'), s.profileAvatar);
  $('#profile-library-stats').textContent = `${state.games.length} games · ${state.games.reduce((sum,g) => sum+(g.playCount || 0),0)} launches`;
  if (force || !$('#profile-dialog').open) $('#profile-name').value = s.profileName;
  const soundMarkup = [['startup','Startup Sound','Original PSP startup chime'],['navigate','Navigation Sound','PS3 XMB cursor'],['confirm','Confirm Sound','PS3 XMB confirm']].map(([kind,label,builtin]) => `<div class="sound-row"><span>${label}<small>${s.sounds[kind] ? 'Custom sound' : builtin}</small></span><button data-preview="${kind}">Preview</button><button data-sound="${kind}">Choose</button>${s.sounds[kind] ? `<button data-reset="${kind}">Reset</button>` : ''}</div>`).join('');
  if ($('#sound-rows').innerHTML !== soundMarkup) $('#sound-rows').innerHTML = soundMarkup;
  fillManage(force);
}
function fillManage(force = false) {
  const game = managedGame(); if (!game) return;
  if (force || !$('#manage-dialog').open) $('#game-name').value = game.title;
  $('#game-serial').textContent = [gameType(game),game.serial,game.lastPlayed ? `Last played ${new Date(game.lastPlayed).toLocaleDateString()}` : 'Not played yet'].filter(Boolean).join(' · ');
  $('#game-path').textContent = game.path; $('#favorite-value').textContent = game.favorite ? '★ Yes' : 'No';
  $('#game-art-preview').style.backgroundImage = game.background ? `url("${game.background}")` : 'none';
  $('#game-art-preview').innerHTML = game.icon ? `<img src="${esc(game.icon)}" alt="Game cover">` : icon(gameIcon(game));
}
function save(patch) {
  const revision = ++settingsRevision; state.settings = { ...state.settings, ...patch }; render();
  settingsQueue = settingsQueue.then(() => api.updateSettings(patch)).then(next => { if (revision === settingsRevision) applyState(next); })
    .catch(async error => { toast(errorText(error),true); if (revision === settingsRevision) applyState(await api.getState()); });
  return settingsQueue;
}
async function importGame(method) {
  closeAll(); const oldIds = new Set(state.games.map(g => g.id)); const result = await run(() => api[method]()); if (!result) return;
  if (method === 'scanGames') { applyState(result.state); toast(`${result.added} new game${result.added === 1 ? '' : 's'} added.${result.warnings?.length ? ' '+result.warnings[0] : ''}`); }
  else toast('Game added to your collection.');
  favoriteOnly = false; categoryIndex = 5; const added = games().findIndex(g => !oldIds.has(g.id)); itemByCategory.games = Math.max(0, added); render();
}
function manage(game = currentGame()) { if (!game) return; managedGameId = game.id; closeAll(); open('#manage-dialog'); }
function confirmRemove(game = managedGame() || currentGame()) { if (!game) return; removeGameId = game.id; closeAll(); $('#remove-title').textContent = `Remove ${game.title}?`; open('#remove-dialog'); }
async function favorite(game = currentGame()) { if (game) await run(() => api.setFavorite({ id:game.id, favorite:!game.favorite })); }
function openOptions() {
  const game = currentGame(); const options = game ? [
    ['Start','play','play'],['Artwork & Details','photo','manage'],[game.favorite ? 'Remove Favorite' : 'Add Favorite','star','favorite'],['Remove from Collection','minus','remove']
  ] : [];
  options.push(['Add to Collection','plus','add'],[favoriteOnly ? 'Show All Games' : 'Show Favorites','star','filter']);
  $('#options-list').innerHTML = options.map(([label,name,action]) => `<button class="option-item" data-option="${action}">${icon(name)}<span>${label}</span></button>`).join(''); open('#options-dialog');
}
function finishLaunch() {
  clearTimeout(returnTimer); if (!document.body.classList.contains('launching')) return;
  document.body.classList.remove('launching'); $('#transition-screen').setAttribute('aria-hidden','true'); waveScene.transition('return');
}
async function playGame(game = currentGame()) {
  if (!game || busy) return;
  if (state.runtime.runningGameId) { toast('A game is already running. Close it before starting another.'); return; }
  if ((game.kind || 'rpcs3') === 'rpcs3' && !state.settings.rpcs3Path) { open('#settings-dialog'); toast('Choose rpcs3.exe to play this PS3 game.'); return; }
  busy = true; closeAll();
  $('#transition-icon').innerHTML = game.icon ? `<img src="${esc(game.icon)}" alt="">` : icon(gameIcon(game));
  $('#transition-title').textContent = game.title; $('#transition-subtitle').textContent = 'Starting '+gameType(game);
  $('#transition-screen').setAttribute('aria-hidden','false'); document.body.classList.add('launching'); waveScene.transition('launch');
  try { await settingsQueue; if (state.settings.animationsEnabled) await sleep(600); await api.launchGame(game.id); applyState(await api.getState()); returnTimer = setTimeout(finishLaunch,500); }
  catch (error) { finishLaunch(); toast(errorText(error),true); } finally { busy = false; }
}

$('#category-track').onclick = event => { const button = event.target.closest('[data-category]'); if (button) { categoryIndex = Number(button.dataset.category); audio.navigate(); renderCategories(); renderItems(); } };
$('#xmb-items').onclick = event => { const button = event.target.closest('[data-item]'); if (!button) return; const index = Number(button.dataset.item); if (index === (itemByCategory[category()] || 0)) activate(); else { itemByCategory[category()] = index; audio.navigate(); renderItems(); } };
$('#options-list').onclick = event => {
  const action = event.target.closest('[data-option]')?.dataset.option; if (!action) return; const game = currentGame(); closeAll();
  if (action === 'play') playGame(game); if (action === 'manage') manage(game); if (action === 'favorite') favorite(game);
  if (action === 'remove') confirmRemove(game); if (action === 'add') open('#add-dialog');
  if (action === 'filter') { favoriteOnly = !favoriteOnly; categoryIndex = 5; itemByCategory.games = 0; render(); }
};
$('#choose-emulator').onclick = () => run(() => api.chooseEmulator(),'RPCS3 connected.');
const settingBindings = {
  'startup-select':['skipIntro',value => value === 'off'], 'boot-duration-select':['startupDuration',Number],
  'animations-select':['animationsEnabled',value => value === 'on'], 'minimize-select':['hideOnLaunch',value => value === 'on'],
  'nogui-select':['noGui',value => value === 'on'], 'sort-select':['gameSort',String], 'theme-select':['theme',String],
  'wave-style-select':['waveStyle',String], 'wave-enabled-select':['waveEnabled',value => value === 'on'],
  'artwork-select':['gameBackground',value => value === 'on'], 'sound-select':['muted',value => value === 'off'],
  'clock-format-select':['clock24',value => value === '24'], 'seconds-select':['showSeconds',value => value === 'on']
};
for (const [id,[key,convert]] of Object.entries(settingBindings)) $('#'+id).onchange = event => save({ [key]:convert(event.target.value) });
for (const [id,key] of [['volume','volume'],['wave-speed','waveSpeed'],['wave-opacity','waveOpacity'],['ui-scale','uiScale']]) {
  $('#'+id).onchange = event => save({ [key]:Number(event.target.value)/100 });
  $('#'+id).oninput = event => { const value = Number(event.target.value)/100; $('#'+id+'-value').textContent = event.target.value+'%';
    if (key === 'volume') audio.configure({ ...state.settings, volume:value }); else if (key === 'uiScale') document.documentElement.style.setProperty('--ui-scale',value); else waveScene.configure({ [key]:value }); };
}
$('#profile-badge').onclick = () => open('#profile-dialog');
$('#save-profile').onclick = async () => { await save({ profileName:$('#profile-name').value }); toast('Profile saved.'); };
$('#choose-avatar').onclick = () => run(() => api.chooseProfileAvatar(),'Profile picture updated.');
$('#reset-avatar').onclick = () => run(() => api.clearProfileAvatar(),'Default profile picture restored.');
$('#choose-font').onclick = () => run(() => api.chooseFont(),'Font updated.');
$('#reset-font').onclick = () => run(() => api.resetFont(),'PS3 Rodin restored.');
$('#sound-rows').onclick = event => { const p = event.target.closest('[data-preview]'), c = event.target.closest('[data-sound]'), r = event.target.closest('[data-reset]'); if (p) audio.preview(p.dataset.preview); if (c) run(() => api.chooseSound(c.dataset.sound),'Sound updated.'); if (r) run(() => api.resetSound(r.dataset.reset),'Original sound restored.'); };
for (const [id,method] of [['import-exe','addExecutable'],['import-shortcut','addShortcut'],['import-folder','addGame'],['import-scan','scanGames'],['import-file','addGameFile']]) $('#'+id).onclick = () => importGame(method);
$('#save-game-name').onclick = () => { const game = managedGame(); if (game) run(() => api.renameGame({ id:game.id, title:$('#game-name').value }),'Title saved.'); };
for (const [id,kind,method] of [['choose-cover','icon','chooseGameArtwork'],['choose-background','background','chooseGameArtwork'],['reset-cover','icon','clearGameArtwork'],['reset-background','background','clearGameArtwork']]) $('#'+id).onclick = () => { const game = managedGame(); if (game) run(() => api[method]({ id:game.id, kind }),'Artwork updated.'); };
$('#toggle-favorite').onclick = () => favorite(managedGame()); $('#remove-game').onclick = () => confirmRemove(managedGame());
$('#confirm-remove').onclick = async () => { const result = await run(() => api.removeGame(removeGameId),'Removed from XROSS-MEDIA-8A3. Your game files are untouched.'); if (result) { managedGameId = null; removeGameId = null; closeAll(); } };
$$('[data-dismiss]').forEach(button => button.onclick = () => closeDialog(button.closest('dialog')));
$$('dialog').forEach(dialog => dialog.addEventListener('cancel',event => { event.preventDefault(); closeDialog(dialog); }));
$('#fullscreen').onclick = () => api.toggleFullscreen(); $('#minimize').onclick = () => api.minimize(); $('#close').onclick = () => api.requestClose();
$('#skip-intro').onclick = dismissIntro; $('#intro').onclick = dismissIntro;

function controllerAction(action) {
  $('#controller-last-input').textContent = action; if (!state) return;
  if (!introDone) { dismissIntro(); return; }
  if (action === 'fullscreen') { api.toggleFullscreen(); return; }
  if (dialogInput.handle(action)) return;
  if (busy || document.body.classList.contains('exiting')) return;
  if (action === 'left' || action === 'previousCategory') moveCategory(-1);
  else if (action === 'right' || action === 'nextCategory') moveCategory(1);
  else if (action === 'up') moveItem(-1); else if (action === 'down') moveItem(1); else if (action === 'select') activate();
  else if (action === 'back' || action === 'home') { finishLaunch(); categoryIndex = 5; render(); }
  else if (action === 'options') openOptions(); else if (action === 'secondary') favorite();
}
const controller = new ControllerInput({ bridge:api, onAction:controllerAction, onConnection:connection => {
  controllerInfo = connection; $('#controller-status').innerHTML = connection.connected ? `${icon('game')}<span class="controller-number">${connection.index+1}</span>` : '';
  $('#controller-detail').textContent = connection.connected ? `${connection.source} controller ${connection.index+1} is connected and ready.` : 'Connect an Xbox controller by USB, Bluetooth, or Xbox Wireless.';
  if (state && category() === 'controllers') renderItems();
} });
document.addEventListener('keydown',event => {
  if (event.defaultPrevented || !state) return;
  if (event.key === 'F11') { event.preventDefault(); api.toggleFullscreen(); return; }
  if (!introDone) { event.preventDefault(); dismissIntro(); return; }
  const dialog = $$('dialog[open]').at(-1);
  if (dialog) {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(dialog); }
    else if (!event.target.matches('input,select,textarea') && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); dialogInput.handle(({ ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' })[event.key]); }
    return;
  }
  const action = ({ ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down', Enter:'select', Escape:'back', y:'options', Y:'options', x:'secondary', X:'secondary' })[event.key];
  if (action) { event.preventDefault(); controllerAction(action); }
});
api.onBeforeClose(() => {
  closeAll(); dismissIntro(); clearTimeout(returnTimer); document.body.classList.remove('launching'); document.body.classList.add('exiting');
  $('#transition-icon').innerHTML = icon('power'); $('#transition-title').textContent = 'See you soon'; $('#transition-subtitle').textContent = state?.settings.profileName || 'XROSS-MEDIA-8A3';
  $('#transition-screen').setAttribute('aria-hidden','false'); waveScene.transition('exit'); audio.back();
  setTimeout(() => api.finishClose(), state?.settings.animationsEnabled === false ? 0 : 850);
});
window.addEventListener('beforeunload',() => { controller.stop(); dialogInput.destroy(); waveScene.stop(); audio.dispose(); });
async function init() {
  waveScene.start();
  try {
    applyState(await api.getState());
    api.onRuntime(runtime => { if (!state) return; const wasRunning = state.runtime.runningGameId; state.runtime = runtime; $('#system-status').textContent = runtime.runningGameId ? 'Game running' : `${state.games.length} games · Ready`;
      if (wasRunning && !runtime.runningGameId) { finishLaunch(); api.getState().then(applyState).catch(() => {}); }
      if (runtime.error) toast(runtime.error,true);
    });
    controller.start(); setInterval(clock,1000);
    if (state.settings.skipIntro || state.settings.startupDuration === 0) dismissIntro();
    else { audio.startup(); bootTimer = setTimeout(dismissIntro,state.settings.startupDuration*1000); }
    document.body.dataset.ready = 'true';
    if (state.runtime.error) toast(state.runtime.error,true);
  } catch (error) { dismissIntro(); console.error(error); toast('Could not start XROSS-MEDIA-8A3: '+errorText(error),true); }
}
init();
