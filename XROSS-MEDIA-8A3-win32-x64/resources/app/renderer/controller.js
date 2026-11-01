const DEADZONE = 0.55;
const MOVEMENT = new Set(['up', 'down', 'left', 'right', 'previousCategory', 'nextCategory']);

function direction(x, y, up, down, left, right) {
  // Opposing D-pad directions cancel. Only one axis navigates per frame.
  const horizontal = Number(right) - Number(left);
  const vertical = Number(down) - Number(up);
  if (vertical) return vertical < 0 ? 'up' : 'down';
  if (horizontal) return horizontal < 0 ? 'left' : 'right';
  if (Math.max(Math.abs(x), Math.abs(y)) < DEADZONE) return null;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

/** Held actions from a Windows XINPUT_GAMEPAD state (raw signed axes/byte triggers). */
export function nativeActions(pad) {
  if (!pad || pad.connected === false) return [];
  const bits = Number(pad.buttons) || 0;
  const held = mask => Boolean(bits & mask);
  const axisScale = pad.normalized === true ? 1 : 32768;
  const triggerScale = pad.normalized === true ? 1 : 255;
  const actions = [];
  const move = direction(
    (Number(pad.leftX) || 0) / axisScale,
    -(Number(pad.leftY) || 0) / axisScale,
    held(0x0001), held(0x0002), held(0x0004), held(0x0008)
  );
  if (move) actions.push(move);
  if (held(0x0100) || (Number(pad.leftTrigger) || 0) / triggerScale >= DEADZONE) actions.push('previousCategory');
  if (held(0x0200) || (Number(pad.rightTrigger) || 0) / triggerScale >= DEADZONE) actions.push('nextCategory');
  if (held(0x1000)) actions.push('select');
  if (held(0x2000)) actions.push('back');
  if (held(0x4000)) actions.push('secondary');
  if (held(0x8000)) actions.push('options');
  if (held(0x0010)) actions.push('fullscreen');
  if (held(0x0020)) actions.push('home');
  return actions;
}

/** Standard browser Gamepad mapping used by Xbox controllers. */
export function browserActions(pad) {
  if (!pad || pad.connected === false) return [];
  const buttons = pad.buttons || [];
  const held = index => {
    const button = buttons[index];
    return typeof button === 'number' ? button >= DEADZONE : Boolean(button?.pressed) || Number(button?.value) >= DEADZONE;
  };
  const trigger = index => {
    const button = buttons[index];
    return Number(typeof button === 'number' ? button : button?.value) >= DEADZONE;
  };
  const actions = [];
  const move = direction(
    Number(pad.axes?.[0]) || 0, Number(pad.axes?.[1]) || 0,
    held(12), held(13), held(14), held(15)
  );
  if (move) actions.push(move);
  if (held(4) || trigger(6)) actions.push('previousCategory');
  if (held(5) || trigger(7)) actions.push('nextCategory');
  if (held(0)) actions.push('select');
  if (held(1)) actions.push('back');
  if (held(2)) actions.push('secondary');
  if (held(3)) actions.push('options');
  if (held(9)) actions.push('fullscreen');
  if (held(8)) actions.push('home');
  return actions;
}

/** Edge-only commands, paced navigation repeats, and release-to-arm focus protection. */
export class InputRepeatGate {
  constructor({ delay = 420, interval = 140 } = {}) {
    this.delay = delay;
    this.interval = interval;
    this.reset();
  }

  reset() {
    this.armed = false;
    this.held = new Map();
  }

  update(actions, now, enabled = true) {
    if (!enabled) {
      this.reset();
      return [];
    }
    const current = new Set(actions);
    if (!this.armed) {
      if (!current.size) this.armed = true;
      return [];
    }
    for (const action of this.held.keys()) {
      if (!current.has(action)) this.held.delete(action);
    }
    const emitted = [];
    for (const action of current) {
      if (!this.held.has(action)) {
        emitted.push(action);
        this.held.set(action, now + this.delay);
      } else if (MOVEMENT.has(action) && now >= this.held.get(action)) {
        emitted.push(action);
        // One repeat per frame, even after a delayed frame or a sleeping PC.
        this.held.set(action, now + this.interval);
      }
    }
    return emitted;
  }
}

export class ControllerInput {
  constructor({ bridge = globalThis.window?.launcher, onAction = () => {}, onConnection = () => {}, environment = {} } = {}) {
    this.bridge = bridge;
    this.onAction = onAction;
    this.onConnection = onConnection;
    this.document = environment.document ?? globalThis.document;
    this.navigator = environment.navigator ?? globalThis.navigator;
    this.requestFrame = environment.requestAnimationFrame ?? (callback => globalThis.requestAnimationFrame(callback));
    this.cancelFrame = environment.cancelAnimationFrame ?? (id => globalThis.cancelAnimationFrame(id));
    this.nativePads = new Map();
    this.gate = new InputRepeatGate();
    this.connection = null;
    this.started = false;
    this.generation = 0;
    this.resetFocus = () => this.gate.reset();
    this.tick = now => this.poll(now);
  }

  start() {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    this.gate.reset();
    this.document?.addEventListener('visibilitychange', this.resetFocus);
    this.document?.defaultView?.addEventListener('blur', this.resetFocus);
    this.document?.defaultView?.addEventListener('focus', this.resetFocus);
    if (typeof this.bridge?.onGamepad === 'function') {
      this.unsubscribe = this.bridge.onGamepad(snapshot => {
        if (this.started && generation === this.generation) this.receiveNative(snapshot);
      });
    }
    if (typeof this.bridge?.getGamepadState === 'function') {
      // Do not overwrite newer subscription events with a late initial snapshot.
      const revision = this.nativeRevision || 0;
      Promise.resolve().then(() => this.bridge.getGamepadState()).then(snapshot => {
        if (this.started && generation === this.generation && revision === (this.nativeRevision || 0)) {
          this.receiveNative(snapshot);
        }
      }).catch(() => {});
    }
    this.frame = this.requestFrame(this.tick);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    ++this.generation;
    this.cancelFrame(this.frame);
    if (typeof this.unsubscribe === 'function') this.unsubscribe();
    this.unsubscribe = null;
    this.document?.removeEventListener('visibilitychange', this.resetFocus);
    this.document?.defaultView?.removeEventListener('blur', this.resetFocus);
    this.document?.defaultView?.removeEventListener('focus', this.resetFocus);
    this.nativePads.clear();
    this.gate.reset();
    this.connection = null;
  }

  receiveNative(snapshot) {
    this.nativeRevision = (this.nativeRevision || 0) + 1;
    const collection = Array.isArray(snapshot) ? snapshot : snapshot?.controllers ?? snapshot?.gamepads;
    if (Array.isArray(collection)) {
      this.nativePads.clear();
      collection.forEach(pad => this.storeNative(pad));
    } else if (!snapshot || snapshot.available === false) {
      this.nativePads.clear();
    } else {
      this.storeNative(snapshot);
    }
  }

  storeNative(pad) {
    if (!pad || !Number.isInteger(pad.index) || pad.index < 0 || pad.index > 3) return;
    if (pad.connected === false) this.nativePads.delete(pad.index);
    else this.nativePads.set(pad.index, pad);
  }

  readController() {
    if (this.nativePads.size) {
      const index = Math.min(...this.nativePads.keys());
      const pad = this.nativePads.get(index);
      return { source: 'XInput', index, focused: pad.focused !== false, actions: nativeActions(pad) };
    }
    try {
      const pads = this.navigator?.getGamepads?.() || [];
      for (const pad of pads) {
        if (pad && pad.connected !== false) {
          return { source: 'Gamepad', index: pad.index, actions: browserActions(pad) };
        }
      }
    } catch {
      // Some browser contexts forbid getGamepads. Keyboard navigation still works.
    }
    return { source: null, index: null, actions: [] };
  }

  poll(now) {
    if (!this.started) return;
    const pad = this.readController();
    const connected = pad.source !== null;
    const identity = `${pad.source}:${pad.index}`;
    if (identity !== this.connection) {
      this.connection = identity;
      this.gate.reset();
      this.onConnection({ connected, source: pad.source, index: pad.index });
    }
    const enabled = connected && pad.focused !== false && !this.document?.hidden && (this.document?.hasFocus?.() ?? true);
    for (const action of this.gate.update(pad.actions, now, enabled)) {
      if (!this.started) break;
      this.onAction(action);
    }
    if (this.started) this.frame = this.requestFrame(this.tick);
  }
}
