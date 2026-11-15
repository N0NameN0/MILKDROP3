import { normalize, storage } from './util.js';

const FAV_KEY = 'md3web.favorites.v1';
const HISTORY_KEY = 'md3web.history.v1';

export const FEATURED = [
  {
    path: 'Sparkle/Glimmer Tunnel/martin - disco mix 2.milk',
    title: 'Disco Mix 2',
    author: 'Martin',
    image: 'assets/previews/disco.jpg',
    tone: 'gold',
  },
  {
    path: 'MilkDrop 3/000.milk2',
    title: 'CyberPunk Rain × My Little Forest',
    author: 'MilkDrop2077',
    image: 'assets/previews/double-000.jpg',
    tone: 'aero',
  },
  {
    path: 'Supernova/Gas/Waltra - Heaven.milk',
    title: 'Heaven',
    author: 'Waltra',
    image: 'assets/previews/heaven.jpg',
    tone: 'aero',
  },
  {
    path: 'Reaction/Liquid Ripples/Tripgnosis - Psychotropic Overload.milk',
    title: 'Psychotropic Overload',
    author: 'Tripgnosis',
    image: 'assets/previews/psychotropic.jpg',
    tone: 'liquid',
  },
  {
    path: 'Sparkle/Mass Circles/ORB - Acid Bubbles.milk',
    title: 'Acid Bubbles',
    author: 'ORB',
    image: 'assets/previews/acid-bubbles.jpg',
    tone: 'rings',
  },
  {
    path: 'Reaction/Liquid Windy/ORB - Stahl - Tentacle Eyeball - horror glamour.milk',
    title: 'Tentacle Eyeball',
    author: 'ORB + Stahl',
    image: 'assets/previews/tentacle.jpg',
    tone: 'ink',
  },
  {
    path: 'Fractal/Nested Dancer/martin + stahlregen - martin in da mash 14.milk',
    title: 'Martin in da Mash 14',
    author: 'Martin + Stahlregen',
    image: 'assets/previews/mash.jpg',
    tone: 'fire',
  },
  {
    path: 'Waveform/Wire Circular/Geiss - Confetti (Jelly).milk',
    title: 'Confetti (Jelly)',
    author: 'Geiss',
    image: 'assets/previews/confetti.jpg',
    tone: 'violet',
  },
  {
    path: 'Dancer/Glowsticks/EoS + Geiss - glowsticks v2 03 music shifter edit b (Psychedelic Mix).milk',
    title: 'Glowsticks v2',
    author: 'EoS + Geiss',
    image: 'assets/previews/glowsticks.jpg',
    tone: 'neon',
  },
];

export class PresetLibrary extends EventTarget {
  constructor() {
    super();
    this.presets = [];
    this.categories = [];
    this.byPath = new Map();
    this.favorites = new Set(storage.get(FAV_KEY, []));
    this.history = storage.get(HISTORY_KEY, []);
    if (!Array.isArray(this.history)) this.history = [];
    this.featured = [];
    this.loaded = false;
  }

  async load() {
    const response = await fetch('manifest.json', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Manifest unavailable (${response.status}).`);
    const data = await response.json();
    this.presets = data.presets || [];
    this.categories = data.categories || [];
    this.byPath.clear();
    for (const preset of this.presets) {
      preset._search = normalize(`${preset.n} ${preset.a || ''} ${preset.c || ''} ${preset.s || ''} ${preset.k === 'milk2' ? 'double milk2' : ''} ${(preset.d || []).join(' ')}`);
      this.byPath.set(preset.p, preset);
    }
    this._pruneHistory();
    this._resolveFeatured();
    this.loaded = true;
    this.dispatchEvent(new CustomEvent('ready'));
    return this;
  }

  _resolveFeatured() {
    this.featured = FEATURED
      .map((item) => {
        const encodedPath = item.path.split('/').map(encodeURIComponent).join('/');
        const preset = this.byPath.get(encodedPath) || this.byPath.get(item.path);
        return preset ? { ...item, index: preset.i } : null;
      })
      .filter(Boolean);
    if (this.featured.length < 4) {
      // Fallback: pick a few recognizable presets across categories.
      const picks = ['Dancer', 'Drawing', 'Fractal', 'Geometric', 'Hypnotic', 'Particles', 'Sparkle', 'Waveform'];
      for (const cat of picks) {
        const found = this.presets.find((p) => p.c === cat);
        if (found && !this.featured.some((f) => f.index === found.i)) {
          this.featured.push({
            index: found.i,
            title: found.t,
            author: found.a,
            image: '',
            path: found.p,
          });
        }
      }
    }
  }

  _pruneHistory() {
    const valid = [];
    for (const path of this.history) {
      if (this.byPath.has(path) && !valid.includes(path)) valid.push(path);
    }
    this.history = valid.slice(0, 60);
    storage.set(HISTORY_KEY, this.history);
  }

  get(i) {
    return this.presets[i] || null;
  }

  get count() {
    return this.presets.length;
  }

  isFavorite(i) {
    const preset = this.get(i);
    return preset ? this.favorites.has(preset.p) : false;
  }

  toggleFavorite(i) {
    const preset = this.get(i);
    if (!preset) return false;
    if (this.favorites.has(preset.p)) {
      this.favorites.delete(preset.p);
    } else {
      this.favorites.add(preset.p);
    }
    storage.set(FAV_KEY, [...this.favorites]);
    this.dispatchEvent(new CustomEvent('favorites'));
    return this.favorites.has(preset.p);
  }

  favoritesIndices() {
    const result = [];
    for (const preset of this.presets) {
      if (this.favorites.has(preset.p)) result.push(preset.i);
    }
    return result;
  }

  pushHistory(i) {
    const preset = this.get(i);
    if (!preset) return;
    this.history = [preset.p, ...this.history.filter((path) => path !== preset.p)].slice(0, 60);
    storage.set(HISTORY_KEY, this.history);
  }

  historyIndices(excludeCurrent = true) {
    const current = this.history[0];
    const result = [];
    for (const path of this.history) {
      const preset = this.byPath.get(path);
      if (!preset) continue;
      if (excludeCurrent && path === current) continue;
      if (!result.includes(preset.i)) result.push(preset.i);
    }
    return result;
  }

  /**
   * @param {{query?:string, cat?:string, onlyFav?:boolean}} state
   * @returns {number[]} preset indices
   */
  filter(state = {}) {
    const query = normalize(state.query || '');
    const cat = state.cat || '*';
    let source;
    if (cat === '__favorites') {
      source = this.favoritesIndices();
    } else if (cat === '__history') {
      source = this.history
        .map((path) => this.byPath.get(path))
        .filter(Boolean)
        .map((p) => p.i);
    } else if (cat && cat !== '*') {
      source = this.presets.filter((p) => p.c === cat).map((p) => p.i);
    } else {
      source = this.presets.map((p) => p.i);
    }
    const onlyFav = Boolean(state.onlyFav);
    const result = [];
    for (const i of source) {
      const preset = this.get(i);
      if (!preset) continue;
      if (onlyFav && !this.favorites.has(preset.p)) continue;
      if (query && !preset._search.includes(query)) continue;
      result.push(i);
    }
    return result;
  }

  randomIndex(pool = null, exclude = -1) {
    let candidates = pool;
    if (!candidates || !candidates.length) {
      candidates = this.presets.map((p) => p.i);
    }
    if (candidates.length === 1) return candidates[0];
    let pick = candidates[Math.floor(Math.random() * candidates.length)];
    let guard = 0;
    while (pick === exclude && guard++ < 12) {
      pick = candidates[Math.floor(Math.random() * candidates.length)];
    }
    return pick;
  }

  pickInitial() {
    if (this.featured.length) return this.featured[0].index;
    return this.presets.length ? 0 : 0;
  }

  categoryCount(cat) {
    const found = this.categories.find((item) => item.id === cat);
    return found ? found.count : 0;
  }
}
