import { clamp } from './util.js';
import { DemoSynth, renderDemoBuffer } from './synth.js';

const OUT_RATE = 44100;
const MAX_CHUNK = 8192;

/**
 * Owns the Web Audio graph, the demo track, microphone capture and the
 * 44.1 kHz PCM stream that feeds the MilkDrop engine.
 */
export class AudioEngine extends EventTarget {
  constructor({ volume = 0.8 } = {}) {
    super();
    this.volume = volume;
    this.ctx = null;
    this.master = null;
    this.source = null;
    this.sourceStartCtx = 0;
    this.sourceOffset = 0;
    this.pauseOffset = 0;
    this.vizPos = 0;
    this.mode = 'synth';
    this.playing = false;
    this.buffer = null;
    this.track = { name: 'Neon Pulse — visual only', kind: 'synth', duration: 0 };
    this.demoBuffer = null;
    this.demoArrayPromise = null;
    this.micStream = null;
    this.micNode = null;
    this.micProcessor = null;
    this.micSilentGain = null;
    this.micQueue = [];
    this.micQueueLength = 0;
    this.micResamplePos = 0;
    this.micCarry = 0;
    this.micNativeRate = 0;
    this.micDropped = 0;
    this.synth = new DemoSynth(OUT_RATE);
    this.out = new Float32Array(MAX_CHUNK);
    this.silence = new Float32Array(MAX_CHUNK);
    this.acc = 0;
    this.level = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.bassAvg = 0.08;
    this.lastBeatAt = 0;
    this.beatFlash = 0;
    this.meter = new Array(12).fill(0);
    this.filterLp1 = 0;
    this.filterLp2 = 0;
    this.sourceToken = 0;
  }

  get isMicActive() {
    return this.mode === 'mic' && Boolean(this.micStream);
  }

  get isAudible() {
    return this.mode === 'demo' || this.mode === 'file';
  }

  startDemoPrefetch() {
    if (this.demoArrayPromise) return this.demoArrayPromise;
    this.demoArrayPromise = fetch('assets/demo/neon-pulse.mp3')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .catch(() => null);
    return this.demoArrayPromise;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("The Web Audio API is not available in this browser.");
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.micSilentGain = this.ctx.createGain();
      this.micSilentGain.gain.value = 0;
      this.micSilentGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
  }

  getState() {
    return {
      mode: this.mode,
      playing: this.playing,
      track: this.track,
      isMicActive: this.isMicActive,
      progress: this.getProgress(),
    };
  }

  emitState() {
    this.dispatchEvent(new CustomEvent('state', { detail: this.getState() }));
  }

  emitTrack() {
    this.dispatchEvent(new CustomEvent('track', { detail: this.track }));
  }

  _stopSource() {
    this.sourceToken += 1;
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
      try {
        this.source.disconnect();
      } catch {
        /* already disconnected */
      }
      this.source = null;
    }
  }

  _startBuffer(offsetSeconds = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.buffer) return;
    this._stopSource();

    const duration = this.buffer.duration || 1;
    const offset = this.mode === 'demo'
      ? ((offsetSeconds % duration) + duration) % duration
      : clamp(offsetSeconds, 0, Math.max(0, duration - 0.02));

    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.mode === 'demo';
    source.connect(this.master);

    const token = this.sourceToken;
    source.onended = () => {
      if (token !== this.sourceToken) return;
      if (this.mode === 'file' && this.source === source) {
        this.playing = false;
        this.pauseOffset = duration;
        this.vizPos = duration;
        this.emitState();
      }
    };

    try {
      source.start(0, offset);
    } catch {
      // Safari sometimes refuses an offset outside the buffer.
      source.start(0, 0);
    }
    this.source = source;
    this.sourceStartCtx = ctx.currentTime;
    this.sourceOffset = offset;
    this.vizPos = offset;
    this.acc = 0;
  }

  currentPosition() {
    if (!this.isAudible) return 0;
    if (!this.playing || !this.ctx || !this.source) {
      return this.pauseOffset || 0;
    }
    const duration = this.buffer?.duration || 0;
    let pos = this.sourceOffset + (this.ctx.currentTime - this.sourceStartCtx);
    if (this.mode === 'demo' && duration > 0) {
      pos %= duration;
      if (pos < 0) pos += duration;
    } else {
      pos = clamp(pos, 0, duration);
    }
    return pos;
  }

  getProgress() {
    if (!this.isAudible || !this.buffer || !this.buffer.duration) return 0;
    return clamp(this.currentPosition() / this.buffer.duration, 0, 1);
  }

  async loadDemoBuffer() {
    if (this.demoBuffer) return this.demoBuffer;
    const ctx = await this.ensureContext();
    await this.startDemoPrefetch();
    let arrayBuffer = null;
    try {
      arrayBuffer = await this.demoArrayPromise;
    } catch {
      arrayBuffer = null;
    }
    if (arrayBuffer) {
      try {
        this.demoBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      } catch {
        this.demoBuffer = null;
      }
    }
    if (!this.demoBuffer) {
      // The bundled MP3 is missing or cannot be decoded: synthesize a loop.
      this.demoBuffer = renderDemoBuffer(ctx, 24);
    }
    return this.demoBuffer;
  }

  async playDemo() {
    const ctx = await this.ensureContext();
    this._stopMic(true);
    this._stopSource();
    const buffer = await this.loadDemoBuffer();
    this.buffer = buffer;
    this.mode = 'demo';
    this.playing = true;
    this.pauseOffset = 0;
    this.track = {
      name: 'Neon Pulse',
      subtitle: 'Sound demo · generated track',
      kind: 'demo',
      duration: buffer.duration,
    };
    this.emitTrack();
    this._startBuffer(0);
    this.emitState();
    if (ctx.state === 'suspended') await ctx.resume();
    return true;
  }

  async openFile(file) {
    if (!file) return false;
    if (!this.ctx) await this.ensureContext();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(arrayBuffer);
    if (!buffer || !buffer.duration) throw new Error('Unreadable audio file.');
    this._stopMic(true);
    this._stopSource();
    this.buffer = buffer;
    this.mode = 'file';
    this.playing = true;
    this.pauseOffset = 0;
    this.track = {
      name: file.name.replace(/\.[^.]+$/, ''),
      subtitle: file.name,
      kind: 'file',
      duration: buffer.duration,
    };
    this.emitTrack();
    this._startBuffer(0);
    this.emitState();
    return true;
  }

  async startMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser.");
    }
    const ctx = await this.ensureContext();
    // Ask for permission before muting the current source, so a refusal or
    // missing device leaves playback exactly as it was.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
    this._stopSource();
    this._stopMic(true);
    this.playing = false;
    this.mode = 'mic';
    this.micStream = stream;
    this.micNativeRate = ctx.sampleRate;
    this.micQueue = [];
    this.micQueueLength = 0;
    this.micResamplePos = 0;
    this.micCarry = 0;
    this.micDropped = 0;

    if (!this.micProcessor) {
      this.micProcessor = ctx.createScriptProcessor(2048, 1, 1);
      this.micProcessor.onaudioprocess = (event) => this._onMicAudio(event);
      this.micProcessor.connect(this.micSilentGain);
    }
    this.micNode = ctx.createMediaStreamSource(stream);
    this.micNode.connect(this.micProcessor);

    this.mode = 'mic';
    this.playing = true;
    this.buffer = null;
    this.pauseOffset = 0;
    this.vizPos = 0;
    this.track = {
      name: 'Microphone',
      subtitle: 'Live audio input',
      kind: 'mic',
      duration: 0,
    };
    this.emitTrack();
    this.emitState();
    if (ctx.state === 'suspended') await ctx.resume();
    return true;
  }

  stopMic(silent = false) {
    this._stopMic(silent);
    if (!silent) {
      this.mode = 'synth';
      this.playing = false;
      this.track = { name: 'Neon Pulse — visual only', kind: 'synth', duration: 0 };
      this.emitTrack();
      this.emitState();
    }
  }

  _stopMic(silent = false) {
    if (this.micNode) {
      try { this.micNode.disconnect(); } catch { /* ignore */ }
      this.micNode = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      this.micStream = null;
    }
    this.micQueue = [];
    this.micQueueLength = 0;
    if (this.mode === 'mic' && silent) {
      this.mode = 'synth';
      this.playing = false;
      this.buffer = null;
    }
  }

  useSynthOnly() {
    this._stopSource();
    this._stopMic(true);
    this.mode = 'synth';
    this.playing = false;
    this.buffer = null;
    this.pauseOffset = 0;
    this.vizPos = 0;
    this.track = { name: 'Neon Pulse — visual only', kind: 'synth', duration: 0 };
    this.emitTrack();
    this.emitState();
  }

  pause() {
    if (!this.isAudible) return false;
    this.pauseOffset = this.currentPosition();
    this._stopSource();
    this.playing = false;
    this.vizPos = this.pauseOffset;
    this.emitState();
    return true;
  }

  async resume() {
    if (!this.isAudible || !this.buffer) return false;
    await this.ensureContext();
    const duration = this.buffer.duration || 1;
    let offset = this.pauseOffset || 0;
    if (offset >= duration - 0.05) offset = 0;
    this.playing = true;
    this._startBuffer(offset);
    this.emitState();
    return true;
  }

  seek(ratio) {
    if (!this.isAudible || !this.buffer) return;
    const duration = this.buffer.duration || 1;
    const offset = clamp(Number(ratio) || 0, 0, 0.999) * duration;
    this.pauseOffset = offset;
    if (this.playing) {
      this._startBuffer(offset);
    } else {
      this.vizPos = offset;
    }
    this.emitState();
  }

  _onMicAudio(event) {
    if (this.mode !== 'mic') return;
    const input = event.inputBuffer.getChannelData(0);
    if (!input.length) return;
    if (!this.micNativeRate) this.micNativeRate = this.ctx.sampleRate;
    const step = this.micNativeRate / OUT_RATE;

    if (Math.abs(step - 1) < 0.0005) {
      this._pushMicSamples(new Float32Array(input));
      return;
    }

    // One-sample carry keeps interpolation continuous across callbacks.
    const merged = new Float32Array(input.length + 1);
    merged[0] = this.micCarry;
    merged.set(input, 1);
    let pos = this.micResamplePos;
    const outLength = Math.max(0, Math.ceil((merged.length - 1) / step) + 1);
    const out = new Float32Array(outLength);
    let written = 0;
    const lastIndex = merged.length - 1;
    while (pos < lastIndex) {
      const index = Math.floor(pos);
      const frac = pos - index;
      const a = merged[index] || 0;
      const b = merged[Math.min(index + 1, lastIndex)] || 0;
      out[written++] = a + (b - a) * frac;
      pos += step;
    }
    this.micCarry = merged[lastIndex];
    this.micResamplePos = pos - lastIndex;
    if (written > 0) this._pushMicSamples(out.subarray(0, written));
  }

  _pushMicSamples(samples) {
    if (!samples.length) return;
    this.micQueue.push(samples);
    this.micQueueLength += samples.length;
    // Keep latency bounded to roughly half a second.
    const maxSamples = OUT_RATE * 0.5;
    while (this.micQueueLength > maxSamples && this.micQueue.length > 1) {
      const dropped = this.micQueue.shift();
      this.micQueueLength -= dropped.length;
      this.micDropped += dropped.length;
    }
  }

  _takeMicSamples(target, count) {
    let filled = 0;
    while (filled < count && this.micQueue.length) {
      const chunk = this.micQueue[0];
      const available = chunk.length - (chunk._offset || 0);
      const need = count - filled;
      if (available <= need) {
        target.set(chunk.subarray(chunk._offset || 0), filled);
        filled += available;
        this.micQueue.shift();
        this.micQueueLength -= available;
      } else {
        const off = chunk._offset || 0;
        target.set(chunk.subarray(off, off + need), filled);
        chunk._offset = off + need;
        this.micQueueLength -= need;
        filled += need;
      }
    }
    if (filled < count) {
      target.fill(0, filled, count);
    }
    return count;
  }

  _readBuffer(count) {
    const buffer = this.buffer;
    const target = this.out;
    if (!buffer) {
      target.fill(0, 0, count);
      return target.subarray(0, count);
    }
    const duration = buffer.duration;
    const rate = buffer.sampleRate || OUT_RATE;
    const channels = buffer.numberOfChannels;
    const left = buffer.getChannelData(0);
    const right = channels > 1 ? buffer.getChannelData(1) : left;
    const step = rate / OUT_RATE;
    const loop = this.mode === 'demo';

    // Keep the visual cursor close to the real audio clock.
    const actual = this.currentPosition();
    if (!loop) {
      if (Math.abs(this.vizPos - actual) > 0.18) this.vizPos = actual;
    } else if (duration > 0) {
      const diff = Math.abs(this.vizPos - actual);
      if (diff > 0.25 && diff < duration - 0.25) this.vizPos = actual;
    }

    let pos = this.vizPos * rate;
    const length = left.length;
    for (let i = 0; i < count; i++) {
      let index = Math.floor(pos);
      const frac = pos - index;
      if (loop) {
        index = ((index % length) + length) % length;
        const next = (index + 1) % length;
        target[i] = left[index] * (1 - frac) + left[next] * frac;
        if (channels > 1) {
          const r = right[index] * (1 - frac) + right[next] * frac;
          target[i] = target[i] * 0.72 + r * 0.28;
        }
      } else {
        if (index >= length) {
          target[i] = 0;
        } else {
          const next = Math.min(index + 1, length - 1);
          target[i] = left[index] * (1 - frac) + left[next] * frac;
          if (channels > 1) {
            const r = right[index] * (1 - frac) + right[next] * frac;
            target[i] = target[i] * 0.72 + r * 0.28;
          }
        }
      }
      pos += step;
    }
    this.vizPos += count / OUT_RATE;
    if (loop && duration > 0 && this.vizPos >= duration) {
      this.vizPos %= duration;
    }
    if (!loop && this.vizPos > duration) this.vizPos = duration;
    return target.subarray(0, count);
  }

  /**
   * Feed the engine for a frame. Always supplies exactly the number of samples
   * representing elapsed time, so the analyser clock never runs backwards.
   */
  pump(engines, dt) {
    const targets = Array.isArray(engines) ? engines.filter(Boolean) : (engines ? [engines] : []);
    if (!targets.length) return;
    const elapsed = clamp(Number(dt) || 0, 0, 0.1);
    this.acc += elapsed * OUT_RATE;
    let count = Math.floor(this.acc);
    this.acc -= count;
    count = Math.min(count, MAX_CHUNK);
    if (count <= 0) return;

    let samples;
    if (this.isAudible && this.playing) {
      samples = this._readBuffer(count);
    } else if (this.mode === 'mic' && this.playing) {
      samples = this.out.subarray(0, this._takeMicSamples(this.out, count));
    } else if (this.mode === 'synth') {
      this.synth.generate(this.out, count);
      samples = this.out.subarray(0, count);
    } else {
      samples = this.silence.subarray(0, count);
    }

    for (const target of targets) target.pump(samples);
    this._analyse(samples);
    this.beatFlash = Math.max(0, this.beatFlash - elapsed * 2.6);
  }

  _analyse(samples) {
    const n = samples.length;
    if (!n) return;
    let energy = 0;
    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;
    const lp1Coef = 0.024;
    const lp2Coef = 0.13;
    for (let i = 0; i < n; i++) {
      const x = samples[i] || 0;
      this.filterLp1 += (x - this.filterLp1) * lp1Coef;
      this.filterLp2 += (x - this.filterLp2) * lp2Coef;
      const low = this.filterLp1;
      const mid = this.filterLp2 - this.filterLp1;
      const high = x - this.filterLp2;
      energy += x * x;
      lowEnergy += low * low;
      midEnergy += mid * mid;
      highEnergy += high * high;
    }
    const rms = Math.sqrt(energy / n);
    const low = Math.sqrt(lowEnergy / n);
    const midLevel = Math.sqrt(midEnergy / n);
    const high = Math.sqrt(highEnergy / n);

    const targetLevel = clamp(rms * 3.2, 0, 1);
    const targetBass = clamp(low * 5.6, 0, 1);
    const targetMid = clamp(midLevel * 7.5, 0, 1);
    const targetTreble = clamp(high * 9, 0, 1);
    const smooth = 0.22;
    this.level += (targetLevel - this.level) * smooth;
    this.bass += (targetBass - this.bass) * 0.28;
    this.mid += (targetMid - this.mid) * 0.24;
    this.treble += (targetTreble - this.treble) * 0.3;
    this.bassAvg = this.bassAvg * 0.975 + this.bass * 0.025;

    const now = performance.now();
    if ((this.playing || this.mode === 'synth') && this.bass > Math.max(0.24, this.bassAvg * 1.22) && now - this.lastBeatAt > 230) {
      this.lastBeatAt = now;
      this.beatFlash = 1;
      this.dispatchEvent(new CustomEvent('beat', { detail: { bass: this.bass, at: now } }));
    }

    // Twelve bars for the dock equalizer, weighted by spectral content.
    for (let i = 0; i < 12; i++) {
      const p = i / 11;
      const bassW = Math.max(0, 1 - p * 2.3);
      const midW = Math.max(0, 1 - Math.abs(p - 0.52) * 3);
      const trebW = Math.max(0, p * 1.6 - 0.5);
      const clock = performance.now() * 0.001;
      const wobble = 0.72 + 0.28 * Math.sin(clock * (1.2 + i * 0.17) + i * 1.9);
      const value = clamp(
        (this.bass * bassW * 0.9 + this.mid * midW * 0.8 + this.treble * trebW * 0.75) * wobble,
        0,
        1,
      );
      this.meter[i] += (value - this.meter[i]) * 0.35;
    }
  }

  getMeter() {
    return this.meter;
  }

  destroy() {
    this._stopSource();
    this._stopMic(true);
    if (this.ctx) {
      try { this.ctx.close(); } catch { /* ignore */ }
    }
  }
}
