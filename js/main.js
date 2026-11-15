import { $, $$, clamp, downloadBlob, escapeHtml, formatNumber, formatTime, icon, isTextInput, presetLabel, safeFilename } from './util.js';
import { MilkDropEngine } from './engine.js';
import { AudioEngine } from './audio.js';
import { PresetLibrary } from './library.js';
import { PresetBrowser } from './browser.js';
import { Settings } from './settings.js';
import { isMilk2Text, parseMilk2 } from './milk2.js';

const LAST_PRESET_KEY = 'md3web.lastPreset.v1';
const QUALITY_FACTOR = {
  auto: 0.9,
  performance: 0.64,
  balanced: 0.82,
  quality: 1,
};

const canvas = $('#md-canvas');
const canvasB = $('#md-canvas-b');
const stage = $('#stage');
const boot = $('#boot');
const bootBar = $('#bootBar');
const bootStatus = $('#bootStatus');
const bootError = $('#bootError');
const bootErrorText = $('#bootErrorText');

const state = {
  current: -1,
  loading: false,
  locked: false,
  customPreset: false,
  shuffleRemaining: 45,
  lastBeatCut: 0,
  ready: false,
  displayFps: 0,
  wasmFps: 60,
  booted: false,
  dual: false,
  secondaryLoading: null,
  doubleInfo: null,
  doubleNoticeShown: false,
};

const engine = new MilkDropEngine(canvas, {
  onLog: (type, message) => {
    if (type === 'warn' && /error|failed|invalid/i.test(String(message))) {
      console.warn('[milkdrop]', message);
    }
  },
  onError: (error) => console.error('[milkdrop]', error),
});

const engineB = new MilkDropEngine(canvasB, {
  onLog: (type, message) => {
    if (type === 'warn' && /error|failed|invalid/i.test(String(message))) {
      console.warn('[milkdrop-b]', message);
    }
  },
  onError: (error) => console.error('[milkdrop-b]', error),
});

const library = new PresetLibrary();
const settings = new Settings();
const audio = new AudioEngine({ volume: settings.get('volume') });

let browser = null;
let nowPlayingTimer = 0;
let resizeTimer = 0;
let hideTimer = 0;
let pointerRaf = 0;
let lastFrame = 0;
let fpsFrames = 0;
let fpsElapsed = 0;
let uiAccumulator = 0;
let fpsSetAccumulator = 0;
let touchStart = null;
let dropCount = 0;
let loadToken = 0;
let progressDragging = false;

const els = {
  topbar: $('#topbar'),
  nowPreset: $('#nowPreset'),
  npCategory: $('#npCategory'),
  npNumber: $('#npNumber'),
  npTitle: $('#npTitle'),
  fpsValue: $('#fpsValue'),
  btnBrowser: $('#btnBrowser'),
  btnSettings: $('#btnSettings'),
  btnFullscreen: $('#btnFullscreen'),
  btnEdgePrev: $('#btnEdgePrev'),
  btnEdgeNext: $('#btnEdgeNext'),
  btnPrev: $('#btnPrev'),
  btnPlay: $('#btnPlay'),
  btnNext: $('#btnNext'),
  btnRandom: $('#btnRandom'),
  btnFavorite: $('#btnFavorite'),
  btnShuffle: $('#btnShuffle'),
  btnLock: $('#btnLock'),
  btnOpen: $('#btnOpen'),
  btnMic: $('#btnMic'),
  btnHelp: $('#btnHelp'),
  btnAbout: $('#btnAbout'),
  trackButton: $('#trackButton'),
  sourcePill: $('#sourcePill'),
  sourceName: $('#sourceName'),
  trackName: $('#trackName'),
  trackTime: $('#trackTime'),
  miniEq: $('#miniEq'),
  progressWrap: $('#progressWrap'),
  progressFill: $('#progressFill'),
  progressGlow: $('#progressGlow'),
  sourceMenu: $('#sourceMenu'),
  srcDemo: $('#srcDemo'),
  srcFile: $('#srcFile'),
  srcMic: $('#srcMic'),
  srcSynth: $('#srcSynth'),
  shufflePill: $('#shufflePill'),
  shuffleCountdown: $('#shuffleCountdown'),
  nowPlaying: $('#nowPlaying'),
  npmCategory: $('#npmCategory'),
  npmTitle: $('#npmTitle'),
  npmSub: $('#npmSub'),
  toasts: $('#toasts'),
  dropOverlay: $('#dropOverlay'),
  fileInput: $('#fileInput'),
  presetInput: $('#presetInput'),
  boot,
  bootBar,
  bootStatus,
  bootError,
  bootErrorText,
  settingsLayer: $('#settingsLayer'),
  helpLayer: $('#helpLayer'),
  aboutLayer: $('#aboutLayer'),
  browserLayer: $('#browserLayer'),
  engineVersion: $('#engineVersion'),
  engineVersionSide: $('#engineVersionSide'),
  aboutEngine: $('#aboutEngine'),
  brandMark: $('#brandMark'),
  btnScreenshot: $('#btnScreenshot'),
  btnResetSettings: $('#btnResetSettings'),
  btnDemoFromSettings: $('#btnDemoFromSettings'),
  btnFileFromSettings: $('#btnFileFromSettings'),
  btnMicFromSettings: $('#btnMicFromSettings'),
  btnAbout2: $('#btnAbout2'),
};

const bars = $$('#miniEq i');

function setBootProgress(percent, text) {
  if (bootBar) bootBar.style.width = `${clamp(percent, 2, 100)}%`;
  if (text && bootStatus) bootStatus.textContent = text;
}

function fatalError(error) {
  console.error('[milkdrop] fatal', error);
  const message = error?.message || String(error || 'Unknown error.');
  if (bootError) bootError.hidden = false;
  if (bootErrorText) bootErrorText.textContent = message;
  if (bootStatus) bootStatus.textContent = 'The engine is unavailable';
  if (bootBar) bootBar.style.background = 'linear-gradient(90deg,#ff5a6e,#ff47e0)';
  document.body.classList.add('booting');
}

function toast(message, type = 'info', duration = 3200) {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `${icon(type === 'error' ? 'about' : 'sparkle')}<span>${escapeHtml(message)}</span>`;
  els.toasts.appendChild(node);
  while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
  window.setTimeout(() => {
    node.classList.add('out');
    window.setTimeout(() => node.remove(), 320);
  }, duration);
}

function anyModalOpen() {
  return Boolean(
    (browser && browser.isOpen())
    || !els.settingsLayer.hidden
    || !els.helpLayer.hidden
    || !els.aboutLayer.hidden,
  );
}

function closePlainModals() {
  els.settingsLayer.hidden = true;
  els.helpLayer.hidden = true;
  els.aboutLayer.hidden = true;
}

function openModal(name) {
  closeSourceMenu();
  if (!name) return;
  if (name === 'browser') {
    closePlainModals();
    browser.open();
    return;
  }
  if (browser) browser.close();
  closePlainModals();
  const layer = name === 'settings' ? els.settingsLayer
    : name === 'help' ? els.helpLayer
      : name === 'about' ? els.aboutLayer
        : null;
  if (!layer) return;
  layer.hidden = false;
  const closeButton = layer.querySelector('.modal-close');
  if (closeButton) setTimeout(() => closeButton.focus({ preventScroll: true }), 40);
  document.body.classList.remove('hud-hidden');
}

function closeModals() {
  if (browser) browser.close();
  closePlainModals();
  state.modal = null;
  document.body.classList.remove('hud-hidden');
  scheduleHudHide();
}

function toggleModal(name) {
  if (name === 'browser') {
    if (browser.isOpen()) {
      browser.close();
    } else {
      openModal('browser');
    }
    return;
  }
  const layer = name === 'settings' ? els.settingsLayer
    : name === 'help' ? els.helpLayer
      : els.aboutLayer;
  if (layer && !layer.hidden) {
    closeModals();
  } else {
    openModal(name);
  }
}

function closeSourceMenu() {
  els.sourceMenu.hidden = true;
  els.trackButton.classList.remove('active');
}

function openSourceMenu() {
  if (!els.sourceMenu.hidden) {
    closeSourceMenu();
    return;
  }
  els.sourceMenu.hidden = false;
  els.trackButton.classList.add('active');
  renderSourceMenu();
}

function renderSourceMenu() {
  const activeSource = audio.isMicActive ? 'mic' : audio.mode;
  for (const node of [els.srcDemo, els.srcFile, els.srcMic, els.srcSynth]) {
    node.classList.toggle('active', node.dataset.source === activeSource);
  }
}

function setupBrowser() {
  browser = new PresetBrowser({
    library,
    getCurrent: () => state.current,
    getHistory: () => library.history,
    onSelect: (index) => loadPreset(index),
  });
  browser.build();
  els.browserLayer.addEventListener('click', (event) => {
    if (event.target === els.browserLayer) closeModals();
  });
}

function updateFavoriteButton() {
  const isFav = state.current >= 0 && library.isFavorite(state.current);
  els.btnFavorite.classList.toggle('favorited', isFav);
  els.btnFavorite.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
}

function updatePresetUI(preset) {
  if (!preset) return;
  const isDouble = preset.k === 'milk2';
  els.npCategory.textContent = isDouble ? `${preset.c || 'Preset'} · DOUBLE` : (preset.c || 'Preset');
  els.npNumber.textContent = `${formatNumber(preset.i + 1)} / ${formatNumber(library.count)}`;
  const displayName = isDouble ? presetLabel(preset) : (preset.n || preset.t || 'Preset');
  els.npTitle.textContent = displayName;
  els.npTitle.title = displayName;
  els.npTitle.classList.remove('loading');
  document.title = `${displayName} · MilkDrop 3 Web`;
  els.btnFavorite.disabled = false;
  updateFavoriteButton();
  if (browser) browser.setActive(preset.i);
  const params = new URLSearchParams(location.search);
  params.set('p', String(preset.i));
  params.delete('preset');
  try {
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  } catch {
    /* ignore */
  }
}

function showCustomPresetUI(name, isDouble = false) {
  els.npCategory.textContent = isDouble ? 'Local file · DOUBLE' : 'Local file';
  els.npNumber.textContent = isDouble ? '.milk2 · 2×' : '.milk';
  els.npTitle.textContent = name;
  els.npTitle.classList.remove('loading');
  document.title = `${name} · MilkDrop 3 Web`;
  els.btnFavorite.disabled = true;
  els.btnFavorite.classList.remove('favorited');
  if (browser) browser.setActive(-1);
  const params = new URLSearchParams(location.search);
  params.delete('p');
  params.delete('preset');
  const query = params.toString();
  try {
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  } catch {
    /* ignore */
  }
}

function showNowPlaying(preset) {
  clearTimeout(nowPlayingTimer);
  const isDouble = preset.k === 'milk2';
  els.nowPlaying.classList.toggle('double', isDouble);
  els.npmCategory.textContent = isDouble ? 'DOUBLE PRESET' : (preset.c || 'Preset');
  els.npmTitle.textContent = isDouble ? presetLabel(preset) : (preset.t || preset.n || 'Preset');
  els.npmSub.textContent = isDouble
    ? 'Two presets · two engines at once'
    : (preset.a ? `${preset.a} · ${preset.s || preset.c}` : (preset.s || 'MilkDrop · Cream of the Crop'));
  els.nowPlaying.classList.add('show');
  nowPlayingTimer = window.setTimeout(() => els.nowPlaying.classList.remove('show'), 3400);
}

function resetShuffleTimer() {
  state.shuffleRemaining = Number(settings.get('interval')) || 45;
  updateShufflePill();
}

function updateShufflePill(forceHide = false) {
  const active = settings.get('shuffle') && !state.locked && !forceHide;
  els.shufflePill.hidden = !active;
  els.shuffleCountdown.textContent = String(Math.max(0, Math.ceil(state.shuffleRemaining)));
  els.btnShuffle.setAttribute('aria-pressed', settings.get('shuffle') ? 'true' : 'false');
}

function updateLockButton() {
  els.btnLock.setAttribute('aria-pressed', state.locked ? 'true' : 'false');
  const use = els.btnLock.querySelector('use');
  if (use) use.setAttribute('href', state.locked ? '#i-lock' : '#i-unlock');
  els.btnLock.setAttribute('aria-label', state.locked ? 'Unlock preset' : 'Lock preset');
  updateShufflePill();
}

async function applyDoublePresetText(text, token) {
  const info = parseMilk2(text);
  if (!info) throw new Error('Invalid or incomplete .milk2 file.');
  const secondaryReady = await ensureSecondaryEngine();
  if (token !== loadToken) return null;

  const okFirst = engine.loadPreset(info.preset1, false);
  if (!okFirst) throw new Error('The first preset in this .milk2 file was rejected.');
  const okSecond = secondaryReady && engineB.loadPreset(info.preset2, false);

  state.dual = Boolean(okSecond);
  state.doubleInfo = info;
  document.body.classList.toggle('dual', state.dual);
  if (!okSecond) {
    toast('Second preset unavailable — showing the first one only.', 'error', 4500);
  }
  return info;
}

async function loadPreset(index, { smooth = true, record = true, showOverlay = true } = {}) {
  const preset = library.get(Number(index));
  if (!preset) return false;
  const token = ++loadToken;
  state.loading = true;
  els.npTitle.classList.add('loading');
  const previousTitle = els.npTitle.textContent;
  els.npTitle.textContent = preset.k === 'milk2' ? 'Loading double preset…' : 'Loading preset…';
  try {
    const response = await fetch(`presets/${preset.p}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Preset not found (${response.status}).`);
    const text = await response.text();
    if (token !== loadToken) return false;
    if (!text.trim()) throw new Error('Empty preset.');

    if (preset.k === 'milk2') {
      const info = await applyDoublePresetText(text, token);
      if (!info) return false;
    } else {
      state.doubleInfo = null;
      if (state.dual) {
        state.dual = false;
        document.body.classList.remove('dual');
      }
      let ok = engine.loadPreset(text, smooth && state.booted);
      if (!ok) {
        // A transient WebGL/shader incident can make one compilation fail.
        // Give the engine one clean, non-blended attempt before reporting it.
        console.warn('[milkdrop] retrying preset after engine rejection:', preset.n);
        await new Promise((resolve) => setTimeout(resolve, 140));
        if (token !== loadToken) return false;
        ok = engine.loadPreset(text, false);
      }
      if (!ok) throw new Error('The engine rejected this preset after a retry.');
      if (token !== loadToken) return false;
    }

    state.current = preset.i;
    state.customPreset = false;
    localStorage.setItem(LAST_PRESET_KEY, preset.p);
    updatePresetUI(preset);
    if (record) library.pushHistory(preset.i);
    if (browser) {
      browser.setActive(preset.i);
      browser.updateCounts();
    }
    resetShuffleTimer();
    if (showOverlay) showNowPlaying(preset);
    if (preset.k === 'milk2' && !state.doubleNoticeShown) {
      state.doubleNoticeShown = true;
      toast('Double mode: two graphics engines active.', 'info', 2800);
    }
    state.loading = false;
    return true;
  } catch (error) {
    console.warn('[milkdrop] preset', error);
    if (token === loadToken) {
      state.loading = false;
      els.npTitle.classList.remove('loading');
      els.npTitle.textContent = previousTitle;
      toast(`Could not load “${preset.t || preset.n}”: ${error.message} The previous preset is still displayed.`, 'error', 5200);
    }
    return false;
  }
}

function nextPreset() {
  if (!library.loaded) return;
  const count = library.count;
  if (!count) return;
  const next = state.current < 0 ? 0 : (state.current + 1) % count;
  loadPreset(next);
}

function previousPreset() {
  if (!library.loaded) return;
  const count = library.count;
  if (!count) return;
  const prev = state.current < 0 ? count - 1 : (state.current - 1 + count) % count;
  loadPreset(prev);
}

function normalPresetPool() {
  if (!library.loaded) return [];
  return library.presets.filter((preset) => preset.k !== 'milk2').map((preset) => preset.i);
}

function randomPreset() {
  if (!library.loaded) return;
  loadPreset(library.randomIndex(normalPresetPool(), state.current));
}

function loadByPath(path, options = {}) {
  const encoded = String(path || '').split('/').map(encodeURIComponent).join('/');
  const preset = library.byPath.get(path) || library.byPath.get(encoded);
  if (!preset) return false;
  return loadPreset(preset.i, options);
}

async function playDemoSafe() {
  closeSourceMenu();
  try {
    await audio.playDemo();
  } catch (error) {
    console.error(error);
    toast(`Playback failed: ${error.message}`, 'error', 4000);
  }
}

function openFilePicker() {
  closeSourceMenu();
  els.fileInput.click();
}

async function handleAudioFile(file) {
  if (!file) return;
  closeSourceMenu();
  const loadingToast = `Loading “${file.name}”…`;
  toast(loadingToast);
  try {
    await audio.openFile(file);
    toast(`Playing: ${file.name.replace(/\.[^.]+$/, '')}`, 'info', 2400);
  } catch (error) {
    console.error(error);
    toast(`Unreadable audio file: ${error.message}`, 'error', 4500);
  }
}

async function toggleMic() {
  closeSourceMenu();
  if (audio.isMicActive) {
    audio.stopMic();
    toast('Microphone off');
    return;
  }
  toast('Requesting microphone access…');
  try {
    await audio.startMic();
    toast('Microphone active — speak or play music', 'info', 2800);
  } catch (error) {
    console.warn('[milkdrop] microphone', error);
    const message = error?.name === 'NotAllowedError'
      ? 'Microphone access denied. Allow it in your browser.'
      : error.message;
    toast(message, 'error', 4500);
  }
}

async function togglePlay() {
  closeSourceMenu();
  if (audio.isMicActive) {
    audio.stopMic();
    toast('Microphone off', 'info', 1800);
    return;
  }
  if (audio.isAudible && audio.playing) {
    audio.pause();
    return;
  }
  if (audio.isAudible && !audio.playing) {
    try { await audio.resume(); } catch (error) { toast(error.message, 'error'); }
    return;
  }
  await playDemoSafe();
}

function updateAudioUI() {
  const track = audio.track || {};
  const audible = audio.isAudible;
  document.body.classList.toggle('playing', audio.playing && (audible || audio.isMicActive));
  document.body.classList.toggle('audio-active', audio.playing && (audible || audio.isMicActive));
  document.body.classList.toggle('no-audio-progress', !audible);
  els.btnPlay.disabled = false;

  const labels = {
    synth: 'SYNTHETIC DEMO',
    demo: 'SOUND DEMO',
    file: 'AUDIO FILE',
    mic: 'MICROPHONE',
  };
  els.sourceName.textContent = labels[audio.isMicActive ? 'mic' : audio.mode] || 'AUDIO';
  els.trackName.textContent = track.name || '—';
  if (audible && track.duration > 0) {
    const position = audio.currentPosition ? audio.currentPosition() : 0;
    els.trackTime.textContent = `${formatTime(position)} / ${formatTime(track.duration)}`;
  } else if (audio.isMicActive) {
    els.trackTime.textContent = 'LIVE';
  } else {
    els.trackTime.textContent = 'VISUAL';
  }
  els.btnMic.classList.toggle('active', audio.isMicActive);
  els.btnMic.setAttribute('aria-label', audio.isMicActive ? 'Disable microphone' : 'Enable microphone');
  renderSourceMenu();
  updateProgressUI();
}

function updateProgressUI() {
  if (progressDragging) return;
  const value = audio.getProgress ? audio.getProgress() : 0;
  const percent = `${(value * 100).toFixed(2)}%`;
  els.progressFill.style.width = percent;
  els.progressGlow.style.width = percent;
}

function updateMeter() {
  const meter = audio.getMeter ? audio.getMeter() : [];
  for (let i = 0; i < bars.length; i++) {
    const value = meter[i] || 0;
    bars[i].style.height = `${3 + Math.round(value * 12)}px`;
    bars[i].style.opacity = `${0.45 + value * 0.55}`;
  }
  document.body.classList.toggle('beat', audio.beatFlash > 0.3);
}

function scheduleHudHide() {
  clearTimeout(hideTimer);
  if (!document.fullscreenElement || !settings.get('autohide') || anyModalOpen()) return;
  hideTimer = window.setTimeout(() => {
    if (document.fullscreenElement && settings.get('autohide') && !anyModalOpen()) {
      document.body.classList.add('hud-hidden');
    }
  }, 4300);
}

function wakeHud() {
  if (document.body.classList.contains('hud-hidden')) {
    document.body.classList.remove('hud-hidden');
  }
  if (pointerRaf) return;
  pointerRaf = requestAnimationFrame(() => {
    pointerRaf = 0;
    scheduleHudHide();
  });
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    toast(`Fullscreen unavailable: ${error.message}`, 'error');
  }
}

function updateFullscreenUI() {
  const isFull = Boolean(document.fullscreenElement);
  const use = els.btnFullscreen.querySelector('use');
  if (use) use.setAttribute('href', isFull ? '#i-shrink' : '#i-expand');
  els.btnFullscreen.setAttribute('aria-label', isFull ? 'Exit fullscreen' : 'Fullscreen');
  if (!isFull) {
    document.body.classList.remove('hud-hidden');
    clearTimeout(hideTimer);
  } else {
    scheduleHudHide();
  }
}

function captureScreenshot() {
  try {
    engine.render();
    const dual = state.dual && engineB.ready;
    if (dual) engineB.render();

    let source = canvas;
    if (dual) {
      // Composite both WebGL canvases the same way the stage does (screen).
      const composed = document.createElement('canvas');
      composed.width = canvas.width;
      composed.height = canvas.height;
      const ctx = composed.getContext('2d');
      ctx.drawImage(canvas, 0, 0, composed.width, composed.height);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.72;
      ctx.drawImage(canvasB, 0, 0, composed.width, composed.height);
      source = composed;
    }

    const preset = state.current >= 0 ? library.get(state.current) : null;
    const base = safeFilename(preset ? presetLabel(preset) : 'milkdrop');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const done = (blob) => {
      if (!blob) {
        toast('Capture failed: empty image.', 'error');
        return;
      }
      downloadBlob(blob, `milkdrop-${base}-${stamp}.png`);
      toast(dual ? 'Double preset captured as PNG' : 'Image captured as PNG');
    };
    if (source.toBlob) {
      source.toBlob(done, 'image/png');
    } else {
      fetch(source.toDataURL('image/png')).then((r) => r.blob()).then(done).catch((error) => {
        toast(`Capture failed: ${error.message}`, 'error');
      });
    }
  } catch (error) {
    console.error(error);
    toast(`Capture failed: ${error.message}`, 'error');
  }
}

function computeCanvasSize() {
  const rect = stage.getBoundingClientRect();
  const cssW = Math.max(320, rect.width || window.innerWidth);
  const cssH = Math.max(180, rect.height || window.innerHeight);
  const quality = settings.get('quality');
  const factor = QUALITY_FACTOR[quality] || QUALITY_FACTOR.auto;
  const dpr = Math.min(window.devicePixelRatio || 1, quality === 'quality' ? 1.75 : 1.4);
  let width = Math.round(cssW * dpr * factor);
  let height = Math.round(cssH * dpr * factor);
  const maxPixels = quality === 'quality' ? 3_200_000 : 2_300_000;
  const pixels = width * height;
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  return {
    width: Math.max(320, Math.min(width, 2560)),
    height: Math.max(180, Math.min(height, 1440)),
  };
}

function computeSecondarySize() {
  const full = computeCanvasSize();
  let width = Math.round(full.width * 0.55);
  let height = Math.round(full.height * 0.55);
  const maxPixels = 1_450_000;
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  return {
    width: Math.max(256, width),
    height: Math.max(144, height),
  };
}

function configureSecondaryEngine() {
  const [meshW, meshH] = String(settings.get('mesh')).split('x').map(Number);
  engineB.setMesh(meshW, meshH);
  engineB.setAspectCorrection(settings.get('aspect'));
  engineB.setBeatSensitivity(settings.get('beatsens'));
  engineB.setSoftCut(0.9);
  engineB.setFps(state.displayFps || 60);
}

async function ensureSecondaryEngine(fresh = false) {
  if (engineB.ready) {
    if (!fresh) return true;
    try {
      // A fresh module releases the previous WASM heap, projectM caches and
      // WebGL context. This matters when a long session cycles through many
      // double presets under constrained GPUs.
      engineB.destroy();
      const size = computeSecondarySize();
      canvasB.width = size.width;
      canvasB.height = size.height;
      await engineB.init();
      configureSecondaryEngine();
      return true;
    } catch (error) {
      console.error('[milkdrop] second engine reset', error);
      engineB.ready = false;
      state.dual = false;
      document.body.classList.remove('dual');
      toast('Could not reset the second engine — double preset will use single mode.', 'error', 5000);
      return false;
    }
  }
  if (state.secondaryLoading) return state.secondaryLoading;
  state.secondaryLoading = (async () => {
    try {
      const size = computeSecondarySize();
      canvasB.width = size.width;
      canvasB.height = size.height;
      await engineB.init();
      configureSecondaryEngine();
      return true;
    } catch (error) {
      console.error('[milkdrop] second engine', error);
      toast('The second engine is unavailable: double preset will render in single mode.', 'error', 5000);
      return false;
    } finally {
      state.secondaryLoading = null;
    }
  })();
  return state.secondaryLoading;
}

function resizeCanvas() {
  if (!engine.ready) return;
  const size = computeCanvasSize();
  engine.resize(size.width, size.height);
  if (engineB.ready) {
    const secondary = computeSecondarySize();
    engineB.resize(secondary.width, secondary.height);
  }
}

function bindUI() {
  els.nowPreset.addEventListener('click', () => toggleModal('browser'));
  els.btnBrowser.addEventListener('click', () => toggleModal('browser'));
  els.btnSettings.addEventListener('click', () => toggleModal('settings'));
  els.btnFullscreen.addEventListener('click', toggleFullscreen);
  els.btnEdgePrev.addEventListener('click', previousPreset);
  els.btnEdgeNext.addEventListener('click', nextPreset);
  els.btnPrev.addEventListener('click', previousPreset);
  els.btnNext.addEventListener('click', nextPreset);
  els.btnRandom.addEventListener('click', randomPreset);
  els.btnPlay.addEventListener('click', togglePlay);
  els.btnOpen.addEventListener('click', openFilePicker);
  els.btnMic.addEventListener('click', toggleMic);
  els.btnHelp.addEventListener('click', () => toggleModal('help'));
  els.btnAbout2.addEventListener('click', () => openModal('about'));
  els.btnScreenshot.addEventListener('click', captureScreenshot);
  els.btnResetSettings.addEventListener('click', () => {
    settings.reset();
    toast('Settings reset');
  });
  els.btnDemoFromSettings.addEventListener('click', playDemoSafe);
  els.btnFileFromSettings.addEventListener('click', openFilePicker);
  els.btnMicFromSettings.addEventListener('click', toggleMic);

  els.btnFavorite.addEventListener('click', () => {
    if (state.current < 0) return;
    const added = library.toggleFavorite(state.current);
    updateFavoriteButton();
    toast(added ? 'Preset added to favorites ★' : 'Preset removed from favorites', 'info', 1800);
  });

  els.btnShuffle.addEventListener('click', () => {
    settings.set('shuffle', !settings.get('shuffle'));
    resetShuffleTimer();
    toast(settings.get('shuffle') ? 'Auto shuffle enabled' : 'Auto shuffle disabled', 'info', 1800);
  });

  els.btnLock.addEventListener('click', () => {
    state.locked = !state.locked;
    updateLockButton();
    toast(state.locked ? 'Preset locked' : 'Preset unlocked', 'info', 1600);
  });

  els.trackButton.addEventListener('click', openSourceMenu);
  els.srcDemo.addEventListener('click', playDemoSafe);
  els.srcFile.addEventListener('click', openFilePicker);
  els.srcMic.addEventListener('click', toggleMic);
  els.srcSynth.addEventListener('click', () => {
    audio.useSynthOnly();
    closeSourceMenu();
    toast('Visual-only mode — synthetic demo', 'info', 2000);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!els.sourceMenu.hidden
      && !els.sourceMenu.contains(event.target)
      && !els.trackButton.contains(event.target)) {
      closeSourceMenu();
    }
  });

  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (file) await handleAudioFile(file);
  });

  els.presetInput.addEventListener('change', async () => {
    const file = els.presetInput.files?.[0];
    els.presetInput.value = '';
    if (file) await loadPresetFile(file);
  });

  els.progressWrap.addEventListener('click', (event) => {
    if (!audio.isAudible) {
      openSourceMenu();
      return;
    }
    const rect = els.progressWrap.getBoundingClientRect();
    audio.seek((event.clientX - rect.left) / rect.width);
    updateProgressUI();
  });
  els.progressWrap.addEventListener('pointerdown', () => { progressDragging = true; });
  window.addEventListener('pointerup', () => { progressDragging = false; });

  for (const layer of [els.settingsLayer, els.helpLayer, els.aboutLayer]) {
    layer.addEventListener('click', (event) => {
      if (event.target === layer) closeModals();
      if (event.target.closest('[data-close]')) closeModals();
    });
  }

  document.addEventListener('open-modal', (event) => openModal(event.detail));
  document.addEventListener('fullscreenchange', updateFullscreenUI);
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resizeCanvas, 120);
  });

  document.addEventListener('pointermove', wakeHud, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.code === 'Space') wakeHud();
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', () => {
    lastFrame = performance.now();
  });

  canvas.addEventListener('dblclick', toggleFullscreen);
  canvas.addEventListener('click', () => {
    if (document.fullscreenElement) wakeHud();
  });
  canvas.addEventListener('touchstart', (event) => {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, time: performance.now() };
    }
  }, { passive: true });
  canvas.addEventListener('touchend', (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const dt = performance.now() - touchStart.time;
    touchStart = null;
    if (dt < 700 && Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) nextPreset();
      else previousPreset();
    }
  }, { passive: true });

  // Drag & drop.
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dropCount += 1;
    els.dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dropCount = Math.max(0, dropCount - 1);
    if (dropCount === 0) els.dropOverlay.hidden = true;
  });
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropCount = 0;
    els.dropOverlay.hidden = true;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.milk') || name.endsWith('.milk2')) {
      await loadPresetFile(file);
    } else if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(name)) {
      await handleAudioFile(file);
    } else {
      toast('Unrecognized format. Drop audio or a .milk preset.', 'error', 3500);
    }
  });

  // Mouse wheel volume over the dock.
  els.trackButton.addEventListener('wheel', (event) => {
    if (!audio.isAudible) return;
    event.preventDefault();
    const next = clamp(settings.get('volume') - Math.sign(event.deltaY) * 0.04, 0, 1);
    settings.set('volume', next);
    audio.setVolume(next);
    toast(`Volume ${Math.round(next * 100)}%`, 'info', 900);
  }, { passive: false });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.modal-layer') || anyModalOpen()) return;
    if (document.fullscreenElement && event.target.closest('button') === null) wakeHud();
  });

  window.addEventListener('beforeunload', () => {
    audio.destroy();
  });
}

async function loadPresetFile(file) {
  if (!file) return;
  const token = ++loadToken;
  state.loading = true;
  els.npTitle.classList.add('loading');
  els.npTitle.textContent = 'Loading local file…';
  try {
    const text = await file.text();
    if (!text.trim()) throw new Error('empty file');
    const isDouble = file.name.toLowerCase().endsWith('.milk2') || isMilk2Text(text);
    if (isDouble) {
      const info = await applyDoublePresetText(text, token);
      if (!info) return;
      state.customPreset = true;
      state.current = -1;
      const name = file.name.replace(/\.milk2$/i, '');
      const label = presetLabel({ k: 'milk2', d: [info.name1, info.name2], n: name });
      showCustomPresetUI(label, true);
      showNowPlaying({
        n: file.name,
        t: label,
        c: 'Local file',
        a: '',
        s: 'Double preset imported',
        k: 'milk2',
      });
      toast(`Local double preset loaded: ${file.name}`, 'info', 3500);
    } else {
      state.doubleInfo = null;
      if (state.dual) {
        state.dual = false;
        document.body.classList.remove('dual');
      }
      const ok = engine.loadPreset(text, true);
      if (!ok) throw new Error('the engine rejected the file');
      state.customPreset = true;
      state.current = -1;
      const name = file.name.replace(/\.milk$/i, '');
      showCustomPresetUI(name, false);
      showNowPlaying({
        n: file.name,
        t: name,
        c: 'Local file',
        a: '',
        s: 'Preset imported',
      });
      toast(`Local preset loaded: ${file.name}`, 'info', 3000);
    }
    state.loading = false;
    resetShuffleTimer();
  } catch (error) {
    console.error(error);
    state.loading = false;
    els.npTitle.classList.remove('loading');
    toast(`Invalid preset: ${error.message}`, 'error', 4500);
  }
}

function onKeyDown(event) {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') {
    if (!els.sourceMenu.hidden) {
      closeSourceMenu();
      return;
    }
    if (anyModalOpen()) {
      closeModals();
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
  }
  if (isTextInput(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (anyModalOpen()) return;

  const code = event.code;
  const key = event.key.toLowerCase();
  let handled = true;

  if (code === 'Space' || key === ' ') {
    nextPreset();
  } else if (code === 'ArrowRight') {
    nextPreset();
  } else if (code === 'ArrowLeft') {
    previousPreset();
  } else if (key === 'r') {
    randomPreset();
  } else if (key === 'b') {
    toggleModal('browser');
  } else if (key === 'f') {
    toggleFullscreen();
  } else if (key === 's') {
    settings.set('shuffle', !settings.get('shuffle'));
    resetShuffleTimer();
    toast(settings.get('shuffle') ? 'Auto shuffle enabled' : 'Auto shuffle disabled', 'info', 1700);
  } else if (key === 'l') {
    state.locked = !state.locked;
    updateLockButton();
    toast(state.locked ? 'Preset locked' : 'Preset unlocked', 'info', 1500);
  } else if (key === 'h' || key === '?') {
    toggleModal('help');
  } else if (key === 'o') {
    openFilePicker();
  } else if (key === 'm') {
    toggleMic();
  } else if (key === 'd') {
    playDemoSafe();
  } else if (key === 'c') {
    captureScreenshot();
  } else if (key === 'p') {
    togglePlay();
  } else if (key === '/') {
    openModal('browser');
    setTimeout(() => $('#presetSearch').focus({ preventScroll: true }), 80);
  } else if (key === 'a') {
    openModal('about');
  } else {
    handled = false;
  }

  if (handled) {
    event.preventDefault();
    wakeHud();
  }
}

function applySetting(key, value) {
  switch (key) {
    case 'mesh': {
      const [w, h] = String(value).split('x').map(Number);
      engine.setMesh(w, h);
      if (engineB.ready) engineB.setMesh(w, h);
      break;
    }
    case 'aspect':
      engine.setAspectCorrection(Boolean(value));
      if (engineB.ready) engineB.setAspectCorrection(Boolean(value));
      break;
    case 'transition':
      engine.setSoftCut(Number(value));
      if (engineB.ready) engineB.setSoftCut(Number(value));
      break;
    case 'beatsens':
      engine.setBeatSensitivity(Number(value));
      if (engineB.ready) engineB.setBeatSensitivity(Number(value));
      break;
    case 'volume':
      audio.setVolume(Number(value));
      break;
    case 'quality':
      resizeCanvas();
      break;
    case 'shuffle':
    case 'interval':
      resetShuffleTimer();
      updateShufflePill();
      break;
    case 'showfps':
      document.body.classList.toggle('no-fps', !value);
      break;
    default:
      break;
  }
}

function startLoop() {
  lastFrame = performance.now();
  requestAnimationFrame(function frame(now) {
    const rawDt = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    const dt = Math.min(rawDt, 0.1);

    if (engine.ready) {
      try {
        const dual = state.dual && engineB.ready;
        audio.pump(dual ? [engine, engineB] : engine, dt);
        engine.render();
        if (dual) {
          try {
            engineB.render();
          } catch (secondaryError) {
            console.error('[milkdrop] second frame', secondaryError);
            state.dual = false;
            document.body.classList.remove('dual');
            toast('The second engine stopped — double preset now in single mode.', 'error', 5000);
          }
        }
      } catch (error) {
        console.error('[milkdrop] frame', error);
        engine.ready = false;
        toast('Renderer error. Reload the page.', 'error', 6000);
      }
    }

    // FPS smoothing.
    fpsFrames += 1;
    fpsElapsed += rawDt;
    if (fpsElapsed >= 0.45) {
      state.displayFps = Math.round(fpsFrames / fpsElapsed);
      els.fpsValue.textContent = String(Math.max(0, state.displayFps));
      fpsFrames = 0;
      fpsElapsed = 0;
    }

    fpsSetAccumulator += rawDt;
    if (fpsSetAccumulator > 2.5 && engine.ready) {
      fpsSetAccumulator = 0;
      if (Math.abs(state.displayFps - state.wasmFps) > 3 && state.displayFps > 8) {
        state.wasmFps = state.displayFps;
        engine.setFps(state.displayFps);
        if (engineB.ready) engineB.setFps(state.displayFps);
      }
    }

    // Auto-shuffle countdown.
    if (settings.get('shuffle') && !state.locked && !state.loading && !anyModalOpen() && !document.hidden) {
      state.shuffleRemaining -= dt;
      if (state.shuffleRemaining <= 0) {
        resetShuffleTimer();
        loadPreset(library.randomIndex(normalPresetPool(), state.current));
      }
    }
    updateShufflePill(anyModalOpen() || state.locked);

    uiAccumulator += dt;
    if (uiAccumulator >= 0.08) {
      uiAccumulator = 0;
      updateMeter();
      updateProgressUI();
      if (audio.isAudible && audio.track?.duration > 0) {
        const position = audio.currentPosition();
        els.trackTime.textContent = `${formatTime(position)} / ${formatTime(audio.track.duration)}`;
      }
    }

    requestAnimationFrame(frame);
  });
}

async function init() {
  document.body.classList.add('booting');
  setBootProgress(6, 'Initializing engine…');
  bindUI();
  updateLockButton();
  updateShufflePill();
  resetShuffleTimer();
  audio.setVolume(settings.get('volume'));
  audio.addEventListener('state', updateAudioUI);
  audio.addEventListener('track', updateAudioUI);
  audio.addEventListener('beat', () => {
    if (!settings.get('beatcut') || state.locked || state.loading || anyModalOpen()) return;
    const now = performance.now();
    if (now - state.lastBeatCut < 4200) return;
    state.lastBeatCut = now;
    loadPreset(library.randomIndex(normalPresetPool(), state.current), { smooth: true });
  });
  settings.addEventListener('change', (event) => {
    const { key, value } = event.detail;
    if (key === '*') {
      for (const [k, v] of Object.entries(value)) applySetting(k, v);
      resetShuffleTimer();
      return;
    }
    applySetting(key, value);
  });

  const size = computeCanvasSize();
  canvas.width = size.width;
  canvas.height = size.height;
  setBootProgress(18, 'Loading preset manifest…');

  let manifestError = null;
  const manifestPromise = library.load().catch((error) => {
    manifestError = error;
    console.error('[milkdrop] manifest', error);
  });

  setBootProgress(32, 'Compiling MilkDrop engine (WebAssembly)…');
  try {
    await engine.init();
  } catch (error) {
    fatalError(error);
    return;
  }
  setBootProgress(62, 'Engine ready · preparing shaders…');
  els.engineVersion.textContent = `projectM ${engine.version}`;
  if (els.engineVersionSide) els.engineVersionSide.textContent = engine.version;
  if (els.aboutEngine) els.aboutEngine.textContent = `projectM ${engine.version} · WebAssembly`;
  await manifestPromise;
  if (manifestError || !library.loaded) {
    fatalError(manifestError || new Error('Preset manifest unavailable.'));
    return;
  }
  setupBrowser();
  browser.setHistoryCount(library.history.length);
  setBootProgress(82, `${formatNumber(library.count)} presets ready…`);

  // Apply all preferences.
  for (const [key, value] of Object.entries(settings.values)) applySetting(key, value);
  resizeCanvas();
  audio.startDemoPrefetch();

  // Choose the first preset: deep link, last session, then a featured preset.
  let initial = -1;
  const params = new URLSearchParams(location.search);
  if (params.has('preset')) {
    const raw = params.get('preset') || '';
    const encoded = raw.split('/').map(encodeURIComponent).join('/');
    const preset = library.byPath.get(raw) || library.byPath.get(encoded);
    if (preset) initial = preset.i;
  }
  if (initial < 0 && params.has('p')) {
    const index = Number(params.get('p'));
    if (Number.isInteger(index) && index >= 0 && index < library.count) initial = index;
  }
  if (initial < 0) {
    const lastPath = localStorage.getItem(LAST_PRESET_KEY);
    const lastPreset = lastPath ? library.byPath.get(lastPath) : null;
    if (lastPreset) initial = lastPreset.i;
  }
  if (initial < 0) initial = library.pickInitial();

  setBootProgress(90, 'Loading first preset…');
  let loaded = await loadPreset(initial, { smooth: false, record: true, showOverlay: false });
  if (!loaded) {
    for (const item of library.featured) {
      if (item.index === initial) continue;
      loaded = await loadPreset(item.index, { smooth: false, record: true, showOverlay: false });
      if (loaded) break;
    }
  }
  if (!loaded && library.count) {
    loaded = await loadPreset(library.randomIndex(null, initial), { smooth: false, record: true, showOverlay: false });
  }
  if (!loaded) {
    toast('No preset could be loaded. Check the presets folder.', 'error', 6000);
  }

  updateAudioUI();
  updateFavoriteButton();
  setBootProgress(100, 'Ready.');
  state.ready = true;
  state.booted = true;
  state.shuffleRemaining = Number(settings.get('interval')) || 45;
  startLoop();
  window.setTimeout(() => {
    boot.classList.add('done');
    document.body.classList.remove('booting');
    window.setTimeout(() => { boot.hidden = true; }, 900);
    if (!localStorage.getItem('md3web.visited.v1')) {
      localStorage.setItem('md3web.visited.v1', '1');
      toast('Welcome to MilkDrop 3 Web · Press Space to change preset', 'info', 5200);
    } else {
      toast('Drop an audio file or click Play for the sound demo', 'info', 3200);
    }
  }, 620);

  // Small debug/API surface for power users and automated checks.
  window.__md = {
    ready: true,
    engine,
    engineB,
    audio,
    library,
    settings,
    state,
    loadPreset,
    loadByPath,
    nextPreset,
    previousPreset,
    randomPreset,
    openBrowser: () => openModal('browser'),
    getFps: () => state.displayFps,
  };
}

window.addEventListener('error', (event) => {
  const message = String(event.message || '');
  if (/memory access out of bounds|abort\(|RuntimeError/i.test(message)) {
    console.error('[milkdrop] runtime', event.error || message);
    if (!state.ready) {
      fatalError(new Error('The WebAssembly engine encountered an error. Reload the page.'));
    } else {
      toast('Renderer error. Reload the page if the problem persists.', 'error', 5000);
    }
  }
});

init();
