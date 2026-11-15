import { $, $$, storage } from './util.js';

const KEY = 'md3web.settings.v1';

export const DEFAULT_SETTINGS = {
  quality: 'auto',
  mesh: '48x36',
  aspect: true,
  shuffle: true,
  interval: 45,
  transition: 2.5,
  beatcut: false,
  beatsens: 1,
  volume: 0.8,
  showfps: true,
  autohide: true,
};

function coerce(key, value) {
  switch (key) {
    case 'aspect':
    case 'shuffle':
    case 'beatcut':
    case 'showfps':
    case 'autohide':
      return Boolean(value);
    case 'interval':
      return Math.max(5, Number(value) || DEFAULT_SETTINGS.interval);
    case 'transition':
      return Math.max(0, Number(value) || DEFAULT_SETTINGS.transition);
    case 'beatsens':
      return Math.min(2, Math.max(0.5, Number(value) || 1));
    case 'volume':
      return Math.min(1, Math.max(0, Number(value) || 0));
    case 'quality':
      return ['auto', 'performance', 'balanced', 'quality'].includes(value) ? value : 'auto';
    case 'mesh':
      return ['32x24', '48x36', '64x48'].includes(value) ? value : '48x36';
    default:
      return value;
  }
}

export class Settings extends EventTarget {
  constructor() {
    super();
    const stored = storage.get(KEY, {});
    this.values = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (stored && Object.prototype.hasOwnProperty.call(stored, key)) {
        this.values[key] = coerce(key, stored[key]);
      }
    }
    this.controls = $$('[data-setting]');
    this.bind();
    this.applyUI();
  }

  get(key) {
    return this.values[key];
  }

  set(key, value, { persist = true, emit = true } = {}) {
    if (!(key in DEFAULT_SETTINGS)) return;
    const next = coerce(key, value);
    if (this.values[key] === next) {
      this.applyKey(key);
      return;
    }
    this.values[key] = next;
    if (persist) storage.set(KEY, this.values);
    this.applyKey(key);
    if (emit) {
      this.dispatchEvent(new CustomEvent('change', { detail: { key, value: next } }));
    }
  }

  toggle(key) {
    this.set(key, !this.values[key]);
  }

  bind() {
    for (const control of this.controls) {
      const key = control.dataset.setting;
      const tag = control.tagName;
      if (control.classList.contains('segmented')) {
        control.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-value]');
          if (!button) return;
          let value = button.dataset.value;
          if (key === 'interval' || key === 'transition') value = Number(value);
          this.set(key, value);
        });
      } else if (control.classList.contains('switch')) {
        control.addEventListener('click', () => this.toggle(key));
      } else if (tag === 'INPUT' && control.type === 'range') {
        const output = control.parentElement.querySelector('output');
        const updater = () => {
          if (output) {
            output.textContent = key === 'volume'
              ? `${Math.round(Number(control.value) * 100)}%`
              : Number(control.value).toFixed(1);
          }
        };
        control.addEventListener('input', () => {
          updater();
          this.set(key, Number(control.value));
        });
        updater();
      }
    }
  }

  applyKey(key) {
    const value = this.values[key];
    if (key === 'showfps') {
      document.body.classList.toggle('no-fps', !value);
    }
    if (key === 'aspect') {
      // Applied by the app to the engine.
    }
    const controls = this.controls.filter((control) => control.dataset.setting === key);
    for (const control of controls) {
      if (control.classList.contains('segmented')) {
        control.querySelectorAll('button').forEach((button) => {
          button.classList.toggle('active', button.dataset.value === String(value));
        });
      } else if (control.classList.contains('switch')) {
        control.setAttribute('aria-checked', value ? 'true' : 'false');
      } else if (control.tagName === 'INPUT' && control.type === 'range') {
        control.value = value;
        const output = control.parentElement.querySelector('output');
        if (output) {
          output.textContent = key === 'volume'
            ? `${Math.round(Number(value) * 100)}%`
            : Number(value).toFixed(1);
        }
      }
    }
  }

  applyUI() {
    for (const key of Object.keys(this.values)) this.applyKey(key);
    document.body.classList.toggle('no-fps', !this.values.showfps);
  }

  reset() {
    storage.remove(KEY);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      this.values[key] = value;
    }
    this.applyUI();
    storage.set(KEY, this.values);
    this.dispatchEvent(new CustomEvent('change', { detail: { key: '*', value: this.values } }));
  }
}
