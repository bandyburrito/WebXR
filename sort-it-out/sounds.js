// Sort It Out: sound effects and vibration.
// All sounds are made with the Web Audio API, so we don't need any sound files.

const Sound = {
  ctx: null,

  // Browsers only allow sound after a tap, so the start buttons call this
  init() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
    } catch (e) {
      this.ctx = null; // no sound, but the game still works
    }
  },

  // One beep. type = wave shape, slideTo = frequency at the end (for "whoop" sounds)
  tone(freq, seconds, { type = 'sine', volume = 0.2, delay = 0, slideTo = null } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + seconds);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + seconds); // fade out
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + seconds);
  },

  // A short burst of noise (whooshes and thuds). filterFreq = how bright it sounds
  noise(seconds, { volume = 0.2, filterFreq = 1000, delay = 0, slideTo = null } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, start);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, start + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(start);
  },

  // ----- The game's sounds -----
  place()   { this.tone(392, 0.12, { type: 'triangle' }); this.tone(587, 0.18, { type: 'triangle', delay: 0.1 }); },
  pickUp()  { this.tone(520, 0.08, { type: 'triangle', volume: 0.15, slideTo: 780 }); },
  throw()   { this.noise(0.25, { volume: 0.25, filterFreq: 400, slideTo: 2200 }); },
  bounce()  { this.tone(260, 0.06, { type: 'triangle', volume: 0.12 }); },
  land()    { this.noise(0.12, { volume: 0.35, filterFreq: 180 }); this.tone(90, 0.12, { volume: 0.25 }); },
  roll()    { this.noise(0.6, { volume: 0.12, filterFreq: 300, slideTo: 150 }); },
  correct() { this.tone(880, 0.12, { type: 'triangle' }); this.tone(1320, 0.2, { type: 'triangle', delay: 0.1 }); },
  clink()   { this.tone(2600, 0.15, { type: 'triangle', volume: 0.1 }); this.tone(3400, 0.2, { type: 'triangle', volume: 0.08, delay: 0.05 }); },
  wrong()   { this.tone(160, 0.3, { type: 'square', volume: 0.1 }); this.tone(120, 0.35, { type: 'square', volume: 0.1, delay: 0.12 }); },
  tick()    { this.tone(1000, 0.05, { type: 'square', volume: 0.05 }); },
  count()   { this.tone(660, 0.12, { type: 'triangle' }); },
  go()      { this.tone(990, 0.3, { type: 'triangle', volume: 0.25 }); },
  roundEnd() {
    [523, 659, 784, 1047].forEach((freq, i) => this.tone(freq, 0.25, { type: 'triangle', volume: 0.18, delay: i * 0.12 }));
  },

  // Short phone vibration (Android). pattern = milliseconds, e.g. 40 or [80, 60, 80]
  vibrate(pattern) {
    try {
      // Chrome only allows vibration after the player has tapped the page at least once
      const tapped = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (navigator.vibrate && tapped) navigator.vibrate(pattern);
    } catch (e) {
      // some browsers block vibration; that's fine
    }
  },
};
