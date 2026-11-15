import { clamp } from './util.js';

const SCRATCH_SAMPLES = 8192;

/**
 * Thin, defensive JavaScript bridge around the projectM/MilkDrop WebAssembly
 * renderer. The module owns a WebGL 2 context attached to #md-canvas.
 */
export class MilkDropEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.module = null;
    this.ready = false;
    this.version = '';
    this.width = 0;
    this.height = 0;
    this.pcmPtr = 0;
    this.pcmCapacity = 0;
    this.onLog = options.onLog || (() => {});
    this.onError = options.onError || (() => {});
  }

  static webgl2Available() {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2'));
    } catch {
      return false;
    }
  }

  async init() {
    if (!MilkDropEngine.webgl2Available()) {
      throw new Error("WebGL 2 is not available in this browser. Try a recent Chrome, Edge, or Firefox.");
    }
    if (typeof window.MilkDropWasm !== 'function') {
      throw new Error("The WebAssembly engine could not be loaded (milkdrop.js not found).");
    }

    const base = new URL('assets/wasm/', document.baseURI).href;
    const assetVersion = '20261116';
    const module = await window.MilkDropWasm({
      locateFile: (file) => `${base}${file}?v=${assetVersion}`,
      print: (text) => this.onLog('log', text),
      printErr: (text) => this.onLog('warn', text),
    });

    this.module = module;
    this._init = module.cwrap('mdw_init', 'number', ['string', 'number', 'number']);
    this._load = module.cwrap('mdw_load_preset', null, ['string', 'number']);
    this._addPcm = module.cwrap('mdw_add_pcm', null, ['number', 'number']);
    this._render = module.cwrap('mdw_render', null, []);
    this._resize = module.cwrap('mdw_resize', null, ['number', 'number']);
    this._softCut = module.cwrap('mdw_set_soft_cut', null, ['number']);
    this._fps = module.cwrap('mdw_set_fps', null, ['number']);
    this._mesh = module.cwrap('mdw_set_mesh', null, ['number', 'number']);
    this._aspect = module.cwrap('mdw_set_aspect_correction', null, ['number']);
    this._beat = module.cwrap('mdw_set_beat_sensitivity', null, ['number']);
    this._version = module.cwrap('mdw_version', 'string', []);
    this._destroy = module.cwrap('mdw_destroy', null, []);

    const width = Math.max(320, Math.round(this.canvas.width || 1280));
    const height = Math.max(180, Math.round(this.canvas.height || 720));
    this.canvas.width = width;
    this.canvas.height = height;

    const selector = `#${this.canvas.id}`;
    const result = this._init(selector, width, height);
    if (result === -1) {
      throw new Error("Could not create the WebGL 2 context. Check hardware acceleration in your browser.");
    }
    if (result === -2) {
      throw new Error("The projectM engine could not be initialized.");
    }
    if (result !== 0) {
      throw new Error(`The engine returned error code ${result}.`);
    }

    this.width = width;
    this.height = height;
    this.version = this._version() || '4.x';
    this.pcmCapacity = SCRATCH_SAMPLES;
    this.pcmPtr = module._malloc(this.pcmCapacity * 4);
    if (!this.pcmPtr) {
      throw new Error("Could not allocate the engine audio buffer.");
    }

    this._fps(60);
    this._mesh(48, 36);
    this._aspect(1);
    this._softCut(2.5);
    this._beat(1);
    this.ready = true;
    return this;
  }


  /**
   * Rebuilds the projectM instance and its WebGL context on the same canvas.
   * Used by the second renderer between .milk2 files to release shader/texture
   * caches and keep long double-preset sessions stable.
   */
  reinit(width, height) {
    if (!this.module) return this.init();
    try {
      if (this.ready) this._destroy();
    } catch (error) {
      this.onError(error);
    }
    this.ready = false;
    const w = Math.max(160, Math.round(width || this.width || 640));
    const h = Math.max(120, Math.round(height || this.height || 360));
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const result = this._init(`#${this.canvas.id}`, w, h);
    if (result !== 0) {
      throw new Error(`Engine reset failed (${result}).`);
    }
    this._fps(60);
    this.ready = true;
    return this;
  }

  destroy() {
    if (!this.ready) return;
    try {
      this._destroy();
    } catch (error) {
      this.onError(error);
    }
    this.ready = false;
  }

  loadPreset(text, smooth = true) {
    if (!this.ready || !text) return false;
    try {
      this._load(text, smooth ? 1 : 0);
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  pump(samples) {
    if (!this.ready || !samples || samples.length === 0) return;
    const total = samples.length;
    let offset = 0;
    while (offset < total) {
      const count = Math.min(total - offset, this.pcmCapacity);
      const heap = this.module.HEAPF32;
      if (!heap) return;
      heap.set(samples.subarray(offset, offset + count), this.pcmPtr >> 2);
      this._addPcm(this.pcmPtr, count);
      offset += count;
    }
  }

  render() {
    if (!this.ready) return;
    this._render();
  }

  resize(width, height) {
    if (!this.ready) return false;
    const w = Math.max(160, Math.round(width));
    const h = Math.max(120, Math.round(height));
    if (w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    try {
      this._resize(w, h);
    } catch (error) {
      this.onError(error);
    }
    return true;
  }

  setSoftCut(seconds) {
    if (!this.ready) return;
    this._softCut(clamp(Number(seconds) || 2.5, 0, 12));
  }

  setFps(fps) {
    if (!this.ready) return;
    this._fps(clamp(Math.round(fps), 10, 240));
  }

  setMesh(width, height) {
    if (!this.ready) return;
    this._mesh(clamp(Math.round(width), 8, 128), clamp(Math.round(height), 6, 128));
  }

  setAspectCorrection(enabled) {
    if (!this.ready) return;
    this._aspect(enabled ? 1 : 0);
  }

  setBeatSensitivity(value) {
    if (!this.ready) return;
    this._beat(clamp(Number(value) || 1, 0.1, 4));
  }
}
