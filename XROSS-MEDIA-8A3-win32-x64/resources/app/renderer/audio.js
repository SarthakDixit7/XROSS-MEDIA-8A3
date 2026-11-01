const INCLUDED_SOUNDS = Object.freeze({
  startup: '../assets/sounds/psp_startup.mp3',
  navigate: '../assets/sounds/xmb_cursor.wav',
  confirm: '../assets/sounds/xmb_decide.wav',
  back: '../assets/sounds/xmb_cancel.wav',
});

/** Menu audio with the PSP startup and authentic XMB navigation assets. */
export class LauncherAudio {
  constructor(settings = {}) {
    this.settings = { volume: 0.55, muted: false, sounds: {} };
    this.context = null;
    this.master = null;
    this.samples = new Map();
    this.playing = new Set();
    this.lastNavigation = -Infinity;
    this.configure(settings);
  }

  configure(settings = {}) {
    const previous = this.settings;
    const volume = Number(settings.volume ?? previous.volume);
    const sounds = settings.sounds && typeof settings.sounds === 'object'
      ? { ...previous.sounds, ...settings.sounds }
      : previous.sounds;
    this.settings = {
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.55,
      muted: Boolean(settings.muted ?? previous.muted),
      sounds,
    };
    for (const [kind, cached] of this.samples) {
      if (cached.url !== sounds[kind]) this.samples.delete(kind);
    }
    for (const audio of this.playing) {
      audio.volume = this.settings.muted ? 0 : this.settings.volume;
    }
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.synthVolume, this.context.currentTime, 0.025);
    }
  }

  get synthVolume() {
    return this.settings.muted ? 0 : this.settings.volume * 0.45;
  }

  async startup() { await this.play('startup'); }

  async navigate() {
    const now = globalThis.performance?.now() ?? Date.now();
    if (now - this.lastNavigation < 65) return;
    this.lastNavigation = now;
    await this.play('navigate');
  }

  async confirm() { await this.play('confirm'); }

  async back() { await this.play('back'); }

  /** Call from a user gesture to preview a replacement or the built-in tone. */
  async preview(kind) {
    if (['startup', 'navigate', 'confirm', 'back'].includes(kind)) await this.play(kind);
  }

  async play(kind) {
    if (this.settings.muted || this.settings.volume <= 0) return;
    // Back uses a separate built-in descending tone unless explicitly customized.
    const url = this.settings.sounds[kind] || INCLUDED_SOUNDS[kind];
    if (typeof url === 'string' && url && await this.playSample(kind, url)) return;
    const context = await this.ensureContext();
    if (!context || this.settings.muted || this.settings.volume <= 0) return;
    try {
      const start = context.currentTime + 0.008;
      if (kind === 'startup') {
        // A restrained handheld-style boot swell: airy first, one clean resolve.
        this.tone(196, start, 1.7, 0.025, 'sine', 392);
        this.bell(523.25, start + 0.34, 1.48, 0.13);
        this.bell(783.99, start + 0.48, 1.35, 0.12);
        this.bell(1046.5, start + 0.62, 1.15, 0.07);
        this.air(start, 1.9);
      } else if (kind === 'navigate') {
        this.tone(1174.66, start, 0.075, 0.19, 'sine', 1396.91);
        this.tone(2349.32, start, 0.035, 0.025);
      } else if (kind === 'confirm') {
        this.bell(659.25, start, 0.32, 0.24);
        this.bell(987.77, start + 0.07, 0.43, 0.2);
      } else {
        this.tone(783.99, start, 0.15, 0.2, 'sine', 523.25);
      }
    } catch {
      // Audio is decorative: a suspended or unavailable device never blocks UI.
    }
  }

  async ensureContext() {
    try {
      if (!this.context || this.context.state === 'closed') {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return null;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.synthVolume;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 12;
        limiter.ratio.value = 6;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.18;
        this.master.connect(limiter);
        limiter.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') {
        // Some browsers leave resume pending until interaction. Never hold up
        // launcher navigation while waiting for an audio permission gesture.
        const context = this.context;
        const resumed = context.resume().then(() => true, () => false);
        let timeout;
        await Promise.race([
          resumed,
          new Promise(resolve => { timeout = setTimeout(() => resolve(false), 150); }),
        ]);
        clearTimeout(timeout);
      }
      return this.context.state === 'running' ? this.context : null;
    } catch {
      return null;
    }
  }

  async playSample(kind, url) {
    try {
      let cached = this.samples.get(kind);
      if (!cached || cached.url !== url) {
        const template = new Audio(url);
        template.preload = 'auto';
        cached = { url, template, failed: false };
        this.samples.set(kind, cached);
      }
      if (cached.failed) return false;
      // Separate voices let confirm and a fading startup coexist.
      if (this.playing.size >= 8) {
        const oldest = this.playing.values().next().value;
        oldest.pause();
        this.playing.delete(oldest);
      }
      const audio = cached.template.cloneNode();
      audio.volume = this.settings.muted ? 0 : this.settings.volume;
      this.playing.add(audio);
      const release = () => this.playing.delete(audio);
      audio.addEventListener('ended', release, { once: true });
      audio.addEventListener('error', release, { once: true });
      try {
        await audio.play();
        return true;
      } catch (error) {
        release();
        // A denied autoplay may work after the next user interaction. A missing
        // or unsupported file uses the synth until the setting changes.
        if (error?.name !== 'NotAllowedError') cached.failed = true;
        return false;
      }
    } catch {
      return false;
    }
  }

  tone(frequency, start, duration, volume, type = 'sine', endFrequency) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + Math.min(0.012, duration * 0.15));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
  }

  bell(frequency, start, duration, volume) {
    this.tone(frequency, start, duration, volume);
    this.tone(frequency * 1.003, start + 0.004, duration * 0.92, volume * 0.24);
    this.tone(frequency * 2, start, duration * 0.42, volume * 0.09);
  }

  air(start, duration) {
    const context = this.context;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, start);
    filter.frequency.exponentialRampToValueAtTime(5800, start + duration);
    filter.Q.value = 0.6;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.035, start + 0.22);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    noise.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    noise.onended = () => {
      noise.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
    noise.start(start);
    noise.stop(start + duration);
  }

  dispose() {
    for (const audio of this.playing) audio.pause();
    this.playing.clear();
    this.samples.clear();
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
