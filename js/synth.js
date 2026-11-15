/**
 * A tiny procedural backing track used before any real audio is available.
 * It is fed straight to the MilkDrop engine as PCM — no sound is produced —
 * so the visualizer always has a living, beat-driven signal to dance to.
 */
const TWO_PI = Math.PI * 2;

const CHORDS = [
  [110.0, 130.81, 164.81, 220.0], // Am
  [87.31, 110.0, 130.81, 174.61], // F
  [130.81, 164.81, 196.0, 261.63], // C
  [98.0, 123.47, 146.83, 196.0], // G
];

export class DemoSynth {
  constructor(sampleRate = 44100) {
    this.rate = sampleRate;
    this.time = 0;
    this.noiseLast = 0;
    this.bpm = 122;
    this.beat = 60 / this.bpm;
    this.bar = this.beat * 4;
    this.loopBars = 24;
    this.loopSeconds = this.bar * this.loopBars;
    this.seed = 0x1a2b3c4d;
  }

  random() {
    // xorshift — cheap, deterministic, good enough for hats.
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed / 4294967296) * 2 - 1;
  }

  generate(target, count = target.length) {
    const invRate = 1 / this.rate;
    for (let i = 0; i < count; i++) {
      target[i] = this.sample(this.time + i * invRate);
    }
    this.time += count * invRate;
    if (this.time > this.loopSeconds * 64) {
      this.time %= this.loopSeconds;
    }
    return target;
  }

  sample(t) {
    const cycle = t % this.loopSeconds;
    const barIndex = Math.floor(cycle / this.bar);
    const bar = barIndex % this.loopBars;
    const beat = this.beat;
    const beatIndex = Math.floor(t / beat);
    const beatPos = t - beatIndex * beat;
    const barPos = t - Math.floor(t / this.bar) * this.bar;
    const stepDur = beat / 4;
    const step = Math.floor(t / stepDur);
    const stepPos = t - step * stepDur;
    const eighthDur = beat / 2;
    const eighth = Math.floor(t / eighthDur);
    const eighthPos = t - eighth * eighthDur;

    // -------- arrangement --------
    let energy = 1;
    let drums = 1;
    let bassGain = 1;
    let arpGain = 1;
    let padGain = 1;
    let fade = 1;
    if (bar < 2) {
      energy = 0.34;
      drums = 0.42;
      bassGain = 0;
      arpGain = 0.15;
      padGain = 0.82;
      fade = 0.55 + bar * 0.2;
    } else if (bar < 4) {
      energy = 0.66;
      drums = 0.72;
      bassGain = 0.8;
      arpGain = 0.62;
      padGain = 0.9;
      fade = 0.75 + (bar - 2) * 0.12;
    } else if (bar >= 12 && bar < 14) {
      energy = 0.66;
      drums = 0.16;
      bassGain = 0.22;
      arpGain = 0.85;
      padGain = 1;
      fade = 0.9;
    } else if (bar >= 22) {
      energy = 0.72;
      drums = 0.55;
      bassGain = 0.6;
      arpGain = 0.5;
      padGain = 1;
      fade = 0.85 - (bar - 22) * 0.3;
    }

    // Sidechain pump after every kick.
    const sidechain = 1 - 0.5 * Math.exp(-beatPos * 11);
    const chord = CHORDS[bar % 4];
    const chordShift = bar >= 16 && bar < 22 ? 2 : 0;

    // -------- kick --------
    let kick = 0;
    if (drums > 0.05) {
      const k = beatPos;
      const pitch = 47 + 92 * Math.exp(-k * 33);
      const phase = TWO_PI * (47 * k + (92 / 33) * (1 - Math.exp(-33 * k)));
      kick = Math.sin(phase) * Math.exp(-k * 7.8) * 0.9 * drums;
      kick += Math.exp(-k * 90) * 0.12 * drums * this.random();
    }

    // -------- clap / snare on 2 & 4 --------
    let clap = 0;
    const withinBarBeat = Math.floor(barPos / beat) % 4;
    if (drums > 0.2 && (withinBarBeat === 1 || withinBarBeat === 3)) {
      const local = barPos - withinBarBeat * beat;
      const env = Math.exp(-local * 19);
      clap = (this.random() * 0.6 + Math.sin(TWO_PI * 185 * local) * 0.18) * env * 0.28 * drums;
    }

    // -------- hi-hats --------
    let hat = 0;
    if (drums > 0.1) {
      const accent = step % 2 === 0 ? 1 : 0.65;
      const open = step % 8 === 6 ? 2.4 : 1;
      const noise = this.random();
      const bright = noise - this.noiseLast * 0.62;
      this.noiseLast = noise;
      hat = bright * Math.exp(-stepPos * (58 / open)) * 0.075 * accent * drums;
    }

    // -------- bass --------
    let bass = 0;
    if (bassGain > 0.03) {
      const pattern = [0, 0, 2, 0, 1, 0, 2, 3];
      const note = chord[(pattern[eighth % 8] + chordShift) % 4] * 0.5;
      const env = Math.exp(-eighthPos * 5.2) * (0.7 + 0.3 * Math.exp(-eighthPos * 1.5));
      const x = TWO_PI * note * eighthPos;
      const wave = Math.sin(x) + 0.32 * Math.sin(2 * x) + 0.13 * Math.sin(3 * x);
      bass = wave * env * 0.24 * bassGain * sidechain;
    }

    // -------- pad / chords --------
    let pad = 0;
    if (padGain > 0.02) {
      const slow = 0.82 + 0.18 * Math.sin(TWO_PI * t / 12.7);
      for (let i = 0; i < 3; i++) {
        const f = chord[(i + chordShift) % 4] * 2.01;
        pad += Math.sin(TWO_PI * f * t + i * 1.7) * 0.042;
        pad += Math.sin(TWO_PI * f * 1.004 * t + 0.8) * 0.016;
      }
      pad *= slow * padGain * sidechain;
    }

    // -------- arpeggio (with a short ping-pong style echo) --------
    let arp = 0;
    if (arpGain > 0.03) {
      const arpStep = step % 16;
      const idx = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2][arpStep];
      const f = chord[(idx + chordShift) % 4] * 4;
      const env = Math.exp(-stepPos * 11);
      arp = Math.sin(TWO_PI * f * stepPos + Math.sin(TWO_PI * f * 2 * stepPos) * 0.22) * env * 0.075 * arpGain;
      // Echo, a dotted sixteenth later.
      const echoPos = t - stepDur * 3;
      const echoStepPos = ((echoPos % stepDur) + stepDur) % stepDur;
      const echoStep = Math.floor(echoPos / stepDur);
      if (echoStep >= 0) {
        const eidx = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2][echoStep % 16];
        const ef = chord[(eidx + chordShift) % 4] * 4;
        arp += Math.sin(TWO_PI * ef * echoStepPos) * Math.exp(-echoStepPos * 9) * 0.026 * arpGain;
      }
    }

    // -------- air / noise sweep --------
    let air = 0;
    if (bar % 8 === 7 && barPos > this.bar * 0.72) {
      const p = (barPos - this.bar * 0.72) / (this.bar * 0.28);
      air = this.random() * p * p * 0.03;
    }

    // Gentle saturation and section fade. The peak stays under 1.
    const mix = (kick + clap + hat + bass + pad + arp + air) * (0.9 + energy * 0.25);
    const saturated = Math.tanh(mix * 1.35) * 0.82;
    return saturated * fade;
  }
}
