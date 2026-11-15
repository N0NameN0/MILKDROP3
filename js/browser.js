import { $, debounce, escapeHtml, formatNumber, icon, presetLabel, rafThrottle } from './util.js';

const ROW_HEIGHT = 59;
const ROW_HEIGHT_MOBILE = 56;

const CATEGORY_ICONS = {
  Dancer: 'sparkle',
  Drawing: 'wave',
  Fractal: 'grid',
  Geometric: 'grid',
  Hypnotic: 'wave',
  Particles: 'sparkle',
  Reaction: 'wave',
  Sparkle: 'sparkle',
  Supernova: 'sparkle',
  Waveform: 'wave',
  '! Transition': 'shuffle',
};

export class PresetBrowser {
  constructor({ library, onSelect, getCurrent, getHistory }) {
    this.library = library;
    this.onSelect = onSelect;
    this.getCurrent = getCurrent;
    this.getHistory = getHistory;
    this.current = -1;
    this.state = { query: '', cat: '*', onlyFav: false };
    this.filtered = [];
    this.element = $('#browserLayer');
    this.list = $('#presetList');
    this.inner = $('#presetListInner');
    this.search = $('#presetSearch');
    this.resultCount = $('#resultCount');
    this.featuredBlock = $('#featuredBlock');
    this.featuredRail = $('#featuredRail');
    this.categoryList = $('#categoryListExtra');
    this.countAll = $('#countAll');
    this.countFav = $('#countFav');
    this.countHist = $('#countHist');
    this.onlyFavBtn = $('#btnOnlyFav');
    this.renderQueued = false;
    this._visible = false;
    this._rowHeight = this.computeRowHeight();
    this.bind();
    this.library.addEventListener('favorites', () => {
      this.updateCounts();
      if (this._visible) this.refresh({ keepScroll: true });
      this.updateFeaturedActive();
    });
  }

  computeRowHeight() {
    return window.innerWidth <= 760 ? ROW_HEIGHT_MOBILE : ROW_HEIGHT;
  }

  bind() {
    this.search.addEventListener('input', debounce(() => {
      this.state.query = this.search.value.trim();
      this.refresh();
    }, 100));

    this.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.search.value) {
          event.stopPropagation();
          this.search.value = '';
          this.state.query = '';
          this.refresh();
        } else {
          this.close();
        }
      }
      if (event.key === 'Enter') {
        const first = this.filtered[0];
        if (first !== undefined) this.choose(first);
      }
    });

    $('#categoryList').addEventListener('click', (event) => this.onCategoryClick(event));
    this.categoryList.addEventListener('click', (event) => this.onCategoryClick(event));

    this.list.addEventListener('scroll', rafThrottle(() => this.renderWindow()), { passive: true });
    this.list.addEventListener('click', (event) => this.onListClick(event));

    this.onlyFavBtn.addEventListener('click', () => {
      this.state.onlyFav = !this.state.onlyFav;
      this.onlyFavBtn.classList.toggle('active', this.state.onlyFav);
      this.refresh();
    });

    $('#btnShuffleList').addEventListener('click', () => this.pickRandom());
    $('#btnRandomBrowser').addEventListener('click', () => this.pickRandom());
    $('#btnAbout').addEventListener('click', () => {
      this.close();
      document.dispatchEvent(new CustomEvent('open-modal', { detail: 'about' }));
    });

    this.element.addEventListener('click', (event) => {
      if (event.target === this.element) this.close();
      if (event.target.closest('[data-close]')) this.close();
    });

    window.addEventListener('resize', debounce(() => {
      this._rowHeight = this.computeRowHeight();
      if (this._visible) this.refresh();
    }, 120));

    this.sourceMenu = $('#sourceMenu');
  }

  build() {
    this.updateCounts();
    this.renderCategories();
    this.renderFeatured();
  }

  updateCounts() {
    this.countAll.textContent = formatNumber(this.library.count);
    this.countFav.textContent = formatNumber(this.library.favorites.size);
    this.countHist.textContent = formatNumber(this.library.history.length);
  }

  renderCategories() {
    const html = this.library.categories
      .filter((cat) => cat.id !== '! Transition')
      .map((cat) => {
        const ic = CATEGORY_ICONS[cat.id] || 'grid';
        return `<button class="cat-link" data-cat="${escapeHtml(cat.id)}">
          <span class="cat-ic">${icon(ic)}</span>
          <span>${escapeHtml(cat.id)}</span>
          <b>${formatNumber(cat.count)}</b>
        </button>`;
      })
      .join('');
    this.categoryList.innerHTML = html;
    this.syncCategoryActive();
  }

  renderFeatured() {
    if (!this.library.featured.length) {
      this.featuredBlock.hidden = true;
      return;
    }
    this.featuredRail.innerHTML = this.library.featured
      .map((item) => {
        const preset = this.library.get(item.index);
        if (!preset) return '';
        const img = item.image
          ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : '';
        const badge = preset.k === 'milk2' ? '2× DOUBLE' : preset.c;
        return `<button class="featured-card tone-${item.tone || 'neon'}" data-featured="${item.index}" title="${escapeHtml(preset.n)}">
          <span class="fc-img">${img}</span>
          <span class="fc-grad"></span>
          <span class="fc-badge">${escapeHtml(badge)}</span>
          <span class="fc-text"><strong>${escapeHtml(item.title || preset.t)}</strong><small>${escapeHtml(item.author || preset.a || 'MilkDrop')}</small></span>
        </button>`;
      })
      .join('');

    this.featuredRail.querySelectorAll('.featured-card').forEach((card) => {
      card.addEventListener('click', () => {
        const index = Number(card.dataset.featured);
        this.choose(index);
      });
    });
    this.updateFeaturedActive();
  }

  updateFeaturedActive() {
    this.featuredRail.querySelectorAll('.featured-card').forEach((card) => {
      card.classList.toggle('active', Number(card.dataset.featured) === this.current);
    });
  }

  syncCategoryActive() {
    document.querySelectorAll('.cat-link').forEach((button) => {
      button.classList.toggle('active', button.dataset.cat === this.state.cat);
    });
  }

  onCategoryClick(event) {
    const button = event.target.closest('.cat-link');
    if (!button) return;
    this.state.cat = button.dataset.cat || '*';
    this.state.onlyFav = false;
    this.onlyFavBtn.classList.remove('active');
    this.syncCategoryActive();
    this.refresh();
  }

  updateVisibilityOfFeatured() {
    const shouldShow = this.state.cat === '*' && !this.state.query && !this.state.onlyFav;
    this.featuredBlock.hidden = !shouldShow;
  }

  refresh({ keepScroll = false } = {}) {
    const previousScroll = this.list.scrollTop;
    this.updateVisibilityOfFeatured();
    this.updateCounts();
    this.filtered = this.library.filter(this.state);
    const catLabel = this.state.cat === '*' ? 'All presets'
      : this.state.cat === '__favorites' ? 'Favorites'
        : this.state.cat === '__history' ? 'History'
          : this.state.cat;
    const suffix = this.filtered.length > 1 ? 'presets' : 'preset';
    const queryLabel = this.state.query ? ` for “${this.state.query}”` : '';
    this.resultCount.textContent = `${formatNumber(this.filtered.length)} ${suffix}${queryLabel} · ${catLabel}`;
    this.list.scrollTop = keepScroll ? previousScroll : 0;
    this.renderWindow(true);
  }

  renderWindow(force = false) {
    if (!this._visible && !force) return;
    const total = this.filtered.length;
    const rowH = this._rowHeight;
    this.inner.style.height = total ? `${total * rowH}px` : '100%';

    if (!total) {
      this.inner.innerHTML = `<div class="empty-state">
        ${icon('search')}
        <strong>No preset found</strong>
        <span>Try another keyword or category, or open a .milk file from your computer.</span>
        <button class="btn ghost" id="btnEmptyReset">Clear filters</button>
      </div>`;
      const reset = this.inner.querySelector('#btnEmptyReset');
      if (reset) {
        reset.addEventListener('click', () => {
          this.search.value = '';
          this.state = { query: '', cat: '*', onlyFav: false };
          this.onlyFavBtn.classList.remove('active');
          this.syncCategoryActive();
          this.refresh();
        });
      }
      return;
    }

    const scrollTop = this.list.scrollTop;
    const viewport = this.list.clientHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / rowH) - 4);
    const end = Math.min(total, start + Math.ceil(viewport / rowH) + 9);
    let html = '';
    for (let pos = start; pos < end; pos++) {
      const index = this.filtered[pos];
      const preset = this.library.get(index);
      if (!preset) continue;
      const fav = this.library.isFavorite(index);
      const active = index === this.current;
      const author = preset.a && preset.a !== preset.n
        ? `<em>${escapeHtml(preset.a)}</em>`
        : '';
      const isDouble = preset.k === 'milk2';
      const meta = [isDouble ? 'Double preset' : null, preset.s, preset.c].filter(Boolean).join(' · ');
      html += `<button class="preset-row${active ? ' active' : ''}" data-index="${index}" style="top:${pos * rowH}px">
        <span class="pr-index">${String(pos + 1).padStart(4, '0')}</span>
        <span class="pr-body">
          <span class="pr-name"><strong>${escapeHtml(isDouble ? presetLabel(preset) : (preset.t || preset.n))}</strong>${author}</span>
          <span class="pr-meta">${escapeHtml(meta)}</span>
        </span>
        <span class="pr-badge${isDouble ? ' double' : ''}">${isDouble ? '2× DOUBLE' : escapeHtml(preset.c)}</span>
        <span class="pr-fav${fav ? ' on' : ''}" data-fav="${index}" role="button" tabindex="-1" title="Favorite">
          ${icon('star', 'off-ic')}${icon('star-fill', 'on-ic')}
        </span>
      </button>`;
    }
    this.inner.innerHTML = html;
    this.updateFeaturedActive();
  }

  onListClick(event) {
    const fav = event.target.closest('[data-fav]');
    if (fav) {
      event.preventDefault();
      event.stopPropagation();
      this.library.toggleFavorite(Number(fav.dataset.fav));
      return;
    }
    const row = event.target.closest('.preset-row');
    if (row) {
      this.choose(Number(row.dataset.index));
    }
  }

  choose(index) {
    if (!Number.isFinite(index)) return;
    this.onSelect(index);
    this.close();
  }

  pickRandom() {
    if (!this.filtered.length) this.refresh();
    if (!this.filtered.length) return;
    const index = this.library.randomIndex(this.filtered, this.current);
    this.choose(index);
  }

  setActive(index) {
    this.current = index;
    if (!this._visible) return;
    this.updateFeaturedActive();
    const pos = this.filtered.indexOf(index);
    if (pos >= 0) {
      const rowH = this._rowHeight;
      const top = pos * rowH;
      const viewTop = this.list.scrollTop;
      const viewBottom = viewTop + this.list.clientHeight;
      if (top < viewTop || top + rowH > viewBottom) {
        this.list.scrollTop = Math.max(0, top - this.list.clientHeight / 2);
      }
    }
    this.renderWindow();
  }

  open(category = null) {
    if (!this.library.loaded) return;
    if (category) this.state.cat = category;
    this._visible = true;
    this.element.hidden = false;
    this._rowHeight = this.computeRowHeight();
    this.syncCategoryActive();
    this.refresh();
    this.setActive(this.getCurrent());
    if (window.innerWidth > 980) {
      setTimeout(() => this.search.focus({ preventScroll: true }), 60);
    }
  }

  close() {
    this._visible = false;
    this.element.hidden = true;
    if (document.activeElement === this.search) this.search.blur();
  }

  isOpen() {
    return this._visible;
  }

  setHistoryCount(n) {
    this.countHist.textContent = formatNumber(n || 0);
  }
}
