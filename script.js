'use strict';

const VIEW_W = 1280;
const VIEW_H = 720;
const SAVE_KEY = 'lingmao-starfire-save-v1';
const GROUND_TOP = 620;
const PLAYER_W = 40;
const PLAYER_H = 62;
const MAX_HEALTH = 5;
const LEVEL_NAMES = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三']
  .map((number) => `第${number}关`);

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const dom = {
  stage: $('gameStage'),
  hud: $('hud'),
  hearts: $('hearts'),
  hudLevel: $('hudLevel'),
  hudLevelName: $('hudLevelName'),
  hudShards: $('hudShards'),
  hudScore: $('hudScore'),
  pauseButton: $('pauseButton'),
  muteButton: $('muteButton'),
  bossBar: $('bossBar'),
  bossPhase: $('bossPhase'),
  bossBarFill: $('bossBarFill'),
  toast: $('toast'),
  touchControls: $('touchControls'),
  screenMenu: $('screenMenu'),
  screenIntro: $('screenIntro'),
  screenPause: $('screenPause'),
  screenLevelClear: $('screenLevelClear'),
  screenGameOver: $('screenGameOver'),
  screenVictory: $('screenVictory'),
  startButton: $('startButton'),
  continueButton: $('continueButton'),
  helpButton: $('helpButton'),
  helpPanel: $('helpPanel'),
  bestScore: $('bestScore'),
  menuSoundButton: $('menuSoundButton'),
  introKicker: $('introKicker'),
  introTitle: $('introTitle'),
  introHint: $('introHint'),
  pauseScore: $('pauseScore'),
  resumeButton: $('resumeButton'),
  retryPauseButton: $('retryPauseButton'),
  menuPauseButton: $('menuPauseButton'),
  clearCopy: $('clearCopy'),
  clearShards: $('clearShards'),
  clearHealth: $('clearHealth'),
  clearScore: $('clearScore'),
  nextButton: $('nextButton'),
  menuClearButton: $('menuClearButton'),
  overScore: $('overScore'),
  retryButton: $('retryButton'),
  menuOverButton: $('menuOverButton'),
  victoryScore: $('victoryScore'),
  victoryBest: $('victoryBest'),
  againButton: $('againButton'),
  menuVictoryButton: $('menuVictoryButton')
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch-device', isTouchDevice);

let viewScaleX = 1;
let viewScaleY = 1;
let mode = 'menu';
let currentLevelIndex = 0;
let currentScore = 0;
let levelEntryScore = 0;
let level = null;
let player = null;
let platforms = [];
let enemies = [];
let shards = [];
let hazards = [];
let projectiles = [];
let shockwaves = [];
let particles = [];
let floaters = [];
let boss = null;
let checkpoint = null;
let gate = null;
let camera = { x: 0 };
let worldTime = 0;
let gameTime = 0;
let demoTime = 0;
let introTimer = 0;
let shakeTime = 0;
let shakeStrength = 0;
let flashTime = 0;
let pendingTransition = null;
let nextEntityId = 1;
let toastTimeout = 0;
let lastTimestamp = 0;
let accumulator = 0;
let fixedStep = 1 / 60;

const input = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpBuffer: 0,
  attackBuffer: 0,
  dashBuffer: 0
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function approach(value, target, amount) {
  if (value < target) return Math.min(value + amount, target);
  if (value > target) return Math.max(value - amount, target);
  return target;
}

function rectsOverlap(a, b, pad = 0) {
  return a.x < b.x + b.w - pad &&
    a.x + a.w > b.x + pad &&
    a.y < b.y + b.h - pad &&
    a.y + a.h > b.y + pad;
}

function centerOf(entity) {
  return { x: entity.x + entity.w / 2, y: entity.y + entity.h / 2 };
}

function makeId(prefix) {
  nextEntityId += 1;
  return `${prefix}-${nextEntityId}`;
}

function loadSave() {
  const fallback = { unlockedLevel: 1, bestScore: 0, muted: false };
  try {
    const stored = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!stored || typeof stored !== 'object') return fallback;
    const unlockedLevel = clamp(Number(stored.unlockedLevel) || 1, 1, LEVEL_NAMES.length);
    const bestScore = Number.isFinite(Number(stored.bestScore)) ? Math.max(0, Number(stored.bestScore)) : 0;
    return { unlockedLevel, bestScore, muted: Boolean(stored.muted) };
  } catch (error) {
    return fallback;
  }
}

let saveData = loadSave();

function persistSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch (error) {
    return false;
  }
  return true;
}

function updateBestScore(score) {
  if (score > saveData.bestScore) {
    saveData.bestScore = score;
    persistSave();
  }
  dom.bestScore.textContent = String(saveData.bestScore);
}

class GameAudio {
  constructor() {
    this.audioContext = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = saveData.muted;
    this.theme = null;
    this.musicTimer = 0;
    this.step = 0;
  }

  unlock() {
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.audioContext = new AudioContextClass();
      this.master = this.audioContext.createGain();
      this.musicGain = this.audioContext.createGain();
      this.sfxGain = this.audioContext.createGain();
      this.master.gain.value = 0.72;
      this.musicGain.gain.value = 0.42;
      this.sfxGain.gain.value = 0.82;
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.connect(this.audioContext.destination);
      this.applyMuteGain();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return true;
  }

  applyMuteGain() {
    if (!this.master || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, now, 0.02);
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.applyMuteGain();
    if (this.muted) {
      this.stopMusic();
    } else if (this.theme) {
      this.startMusic();
    }
  }

  setTheme(theme) {
    this.theme = theme;
    this.stopMusic();
    if (theme && !this.muted && this.audioContext) this.startMusic();
  }

  startMusic() {
    this.stopMusic();
    if (!this.audioContext || !this.theme || this.muted) return;
    const tempos = {
      menu: 540, forest: 430, cave: 490, sky: 390, victory: 300,
      bamboo: 470, frost: 520, desert: 440, fungi: 560, storm: 380,
      ruins: 500, mirror: 580, ember: 350, void: 330, celestial: 360
    };
    this.step = 0;
    this.playMusicStep();
    this.musicTimer = window.setInterval(() => this.playMusicStep(), tempos[this.theme] || 440);
  }

  stopMusic() {
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }

  playMusicStep() {
    if (!this.audioContext || this.muted || !this.theme) return;
    const patterns = {
      menu: [0, null, 4, 7, null, 4, 2, null],
      forest: [0, 2, 4, null, 7, 4, 2, null],
      cave: [0, null, 3, 5, 3, null, -2, 0],
      sky: [0, 4, 7, 9, null, 7, 4, 2],
      bamboo: [0, 3, 5, 7, 5, 3, 2, null],
      frost: [0, 5, 7, 12, 9, 7, 5, 4],
      desert: [0, 2, 3, 7, 5, 3, -2, 0],
      fungi: [0, 1, 5, 6, 5, 1, -4, 0],
      storm: [0, -1, 3, 2, 7, 3, -5, 0],
      ruins: [0, 4, 2, 7, 5, 9, 7, 4],
      mirror: [0, 7, 9, 12, 7, 4, 2, 7],
      ember: [0, -2, 3, 1, 5, 3, -4, 0],
      void: [0, -3, 1, 6, 4, -1, -5, 0],
      celestial: [0, 4, 7, 12, 16, 12, 7, 4],
      victory: [0, 4, 7, 12, 9, 7, 4, 7]
    };
    const roots = {
      menu: 261.63, forest: 293.66, cave: 196, sky: 246.94, victory: 329.63,
      bamboo: 220, frost: 277.18, desert: 246.94, fungi: 185, storm: 164.81,
      ruins: 233.08, mirror: 311.13, ember: 174.61, void: 146.83, celestial: 349.23
    };
    const pattern = patterns[this.theme] || patterns.menu;
    const root = roots[this.theme] || 261.63;
    const semitone = Math.pow(2, 1 / 12);
    const index = this.step % pattern.length;
    const note = pattern[index];
    if (note !== null) {
      this.tone(root * Math.pow(semitone, note), 0.24, 'sine', 0.024, 0, this.musicGain);
    }
    if (this.step % 4 === 0) {
      this.tone(root / 2, 0.42, 'triangle', 0.018, 0, this.musicGain);
    }
    if (this.theme === 'victory' && index === 0) {
      this.tone(root * 2, 0.32, 'sine', 0.018, 0, this.musicGain);
    }
    this.step += 1;
  }

  tone(freq, duration, type, volume, delay, destination, endFreq = null) {
    if (!this.audioContext || this.muted) return;
    const now = this.audioContext.currentTime + delay;
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(30, freq), now);
    if (endFreq) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + duration);
    }
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gainNode);
    gainNode.connect(destination || this.sfxGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  sfx(name) {
    if (!this.audioContext || this.muted) return;
    if (name === 'jump') {
      this.tone(260, 0.16, 'sine', 0.07, 0, this.sfxGain, 520);
    } else if (name === 'attack') {
      this.tone(220, 0.09, 'square', 0.045, 0, this.sfxGain, 110);
      this.tone(660, 0.07, 'triangle', 0.025, 0.015, this.sfxGain, 330);
    } else if (name === 'hit') {
      this.tone(150, 0.09, 'square', 0.055, 0, this.sfxGain, 72);
    } else if (name === 'hurt') {
      this.tone(190, 0.24, 'sawtooth', 0.065, 0, this.sfxGain, 68);
    } else if (name === 'dash') {
      this.tone(120, 0.13, 'triangle', 0.04, 0, this.sfxGain, 390);
    } else if (name === 'pickup') {
      [0, 0.065, 0.13].forEach((delay, index) => {
        this.tone([660, 880, 1320][index], 0.16, 'sine', 0.055, delay, this.sfxGain);
      });
    } else if (name === 'checkpoint') {
      this.tone(440, 0.28, 'sine', 0.04, 0, this.sfxGain);
      this.tone(660, 0.3, 'sine', 0.03, 0.08, this.sfxGain);
    } else if (name === 'enemy') {
      this.tone(210, 0.12, 'triangle', 0.05, 0, this.sfxGain, 410);
    } else if (name === 'boss') {
      this.tone(90, 0.5, 'sawtooth', 0.07, 0, this.sfxGain, 45);
    } else if (name === 'clear') {
      [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
        this.tone(note, 0.28, 'sine', 0.05, index * 0.11, this.sfxGain);
      });
    } else if (name === 'gameover') {
      [330, 277, 220, 165].forEach((note, index) => {
        this.tone(note, 0.4, 'triangle', 0.045, index * 0.14, this.sfxGain);
      });
    } else if (name === 'victory') {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((note, index) => {
        this.tone(note, 0.5, 'sine', 0.055, index * 0.15, this.sfxGain);
      });
    }
  }
}

const audio = new GameAudio();

const LEVELS = [
  {
    id: 1,
    name: '晨曦森林',
    kicker: '第一关',
    hint: '收集三枚星火，唤醒终点星门',
    clearCopy: '晨曦森林的星火已经归位，林间的风重新歌唱。',
    theme: 'forest',
    width: 5200,
    spawn: { x: 160, y: GROUND_TOP },
    checkpoint: { x: 2940, y: GROUND_TOP },
    gate: { x: 4980, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 900, h: 100, type: 'ground' },
      { x: 1020, y: 620, w: 460, h: 100, type: 'ground' },
      { x: 1170, y: 500, w: 180, h: 26, type: 'wood' },
      { x: 1600, y: 620, w: 550, h: 100, type: 'ground' },
      { x: 1760, y: 500, w: 170, h: 24, type: 'wood' },
      { x: 1980, y: 390, w: 160, h: 24, type: 'wood' },
      { x: 2210, y: 500, w: 150, h: 24, type: 'wood' },
      { x: 2300, y: 620, w: 460, h: 100, type: 'ground' },
      { x: 2860, y: 620, w: 840, h: 100, type: 'ground' },
      {
        x: 3390,
        y: 470,
        w: 160,
        h: 24,
        type: 'wood',
        move: { axis: 'y', range: 76, speed: 1.15, phase: 0 }
      },
      { x: 3920, y: 620, w: 440, h: 100, type: 'ground' },
      { x: 3970, y: 490, w: 160, h: 24, type: 'wood' },
      { x: 4500, y: 620, w: 700, h: 100, type: 'ground' },
      { x: 4700, y: 485, w: 170, h: 24, type: 'wood' }
    ],
    hazards: [
      { x: 650, y: 598, w: 130, h: 22, type: 'thorn' },
      { x: 2480, y: 598, w: 140, h: 22, type: 'thorn' },
      { x: 4560, y: 598, w: 120, h: 22, type: 'thorn' }
    ],
    enemies: [
      { type: 'mushroom', x: 440, ground: 620, range: 78 },
      { type: 'moth', x: 1320, y: 460, range: 72 },
      { type: 'mushroom', x: 1900, ground: 620, range: 88 },
      { type: 'moth', x: 2440, y: 455, range: 92 },
      { type: 'mushroom', x: 3230, ground: 620, range: 96 }
    ],
    shards: [
      { x: 1260, y: 445 },
      { x: 2055, y: 335 },
      { x: 4050, y: 430 }
    ]
  },
  {
    id: 2,
    name: '熔岩洞窟',
    kicker: '第二关',
    hint: '避开熔岩，借移动石台穿过断层',
    clearCopy: '灼热的洞窟恢复了平静，星火在岩壁上留下温暖的光。',
    theme: 'cave',
    width: 5400,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2790, y: GROUND_TOP },
    gate: { x: 5240, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 780, h: 100, type: 'ground' },
      {
        x: 820,
        y: 505,
        w: 155,
        h: 24,
        type: 'stone',
        move: { axis: 'x', range: 58, speed: 1.35, phase: 0.4 }
      },
      { x: 980, y: 620, w: 620, h: 100, type: 'ground' },
      { x: 1200, y: 500, w: 180, h: 24, type: 'stone' },
      {
        x: 1660,
        y: 500,
        w: 150,
        h: 24,
        type: 'stone',
        move: { axis: 'x', range: 72, speed: 1.2, phase: 2.2 }
      },
      { x: 1860, y: 620, w: 640, h: 100, type: 'ground' },
      { x: 2010, y: 480, w: 170, h: 24, type: 'stone' },
      { x: 2680, y: 620, w: 700, h: 100, type: 'ground' },
      { x: 2760, y: 440, w: 170, h: 24, type: 'stone' },
      {
        x: 3420,
        y: 470,
        w: 172,
        h: 24,
        type: 'stone',
        move: { axis: 'x', range: 98, speed: 1.05, phase: 1.1 }
      },
      { x: 3720, y: 620, w: 760, h: 100, type: 'ground' },
      { x: 3900, y: 470, w: 170, h: 24, type: 'stone' },
      { x: 4200, y: 390, w: 160, h: 24, type: 'stone' },
      { x: 4510, y: 510, w: 160, h: 24, type: 'stone' },
      { x: 4680, y: 620, w: 720, h: 100, type: 'ground' },
      { x: 4820, y: 490, w: 170, h: 24, type: 'stone' }
    ],
    hazards: [
      { x: 780, y: 650, w: 200, h: 70, type: 'lava' },
      { x: 1600, y: 650, w: 260, h: 70, type: 'lava' },
      { x: 1120, y: 600, w: 150, h: 20, type: 'spike' },
      { x: 2160, y: 600, w: 150, h: 20, type: 'spike' },
      { x: 3380, y: 650, w: 340, h: 70, type: 'lava' },
      { x: 4010, y: 600, w: 150, h: 20, type: 'spike' },
      { x: 4480, y: 650, w: 200, h: 70, type: 'lava' }
    ],
    enemies: [
      { type: 'beetle', x: 520, ground: 620, range: 112 },
      { type: 'spirit', x: 1280, y: 458, range: 32 },
      { type: 'beetle', x: 1990, ground: 620, range: 104 },
      { type: 'spirit', x: 2300, y: 435, range: 38 },
      { type: 'beetle', x: 2950, ground: 620, range: 100 },
      { type: 'spirit', x: 3850, y: 425, range: 34 },
      { type: 'beetle', x: 4080, ground: 620, range: 96 },
      { type: 'beetle', x: 5000, ground: 620, range: 120 }
    ],
    shards: [
      { x: 1290, y: 445 },
      { x: 2845, y: 385 },
      { x: 4270, y: 335 }
    ]
  },
  {
    id: 3,
    name: '云端神殿',
    kicker: '第三关',
    hint: '收集神殿星火，循着天穹的微光继续前行',
    clearCopy: '云端神殿的星火归位，天空深处仍有新的回响。',
    theme: 'sky',
    width: 6000,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2810, y: GROUND_TOP },
    gate: { x: 4520, y: 500, w: 140, h: 120, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 900, h: 100, type: 'cloud' },
      { x: 1040, y: 540, w: 180, h: 24, type: 'cloud' },
      { x: 1300, y: 460, w: 180, h: 24, type: 'cloud' },
      { x: 1580, y: 520, w: 180, h: 24, type: 'cloud' },
      { x: 1900, y: 620, w: 620, h: 100, type: 'cloud' },
      {
        x: 2540,
        y: 500,
        w: 160,
        h: 24,
        type: 'cloud',
        move: { axis: 'y', range: 64, speed: 1.25, phase: 0.8 }
      },
      { x: 2700, y: 620, w: 680, h: 100, type: 'cloud' },
      {
        x: 3260,
        y: 455,
        w: 165,
        h: 24,
        type: 'cloud',
        move: { axis: 'x', range: 42, speed: 1.0, phase: 2.4 }
      },
      { x: 3460, y: 500, w: 170, h: 24, type: 'cloud' },
      { x: 3720, y: 410, w: 180, h: 24, type: 'cloud' },
      { x: 3990, y: 500, w: 170, h: 24, type: 'cloud' },
      { x: 4240, y: 620, w: 1760, h: 100, type: 'cloud' }
    ],
    hazards: [],
    enemies: [
      { type: 'wisp', x: 1140, y: 380, range: 48 },
      { type: 'wisp', x: 2070, y: 425, range: 56 },
      { type: 'wisp', x: 3010, y: 375, range: 52 },
      { type: 'wisp', x: 3880, y: 320, range: 44 }
    ],
    shards: [
      { x: 1125, y: 480 },
      { x: 1665, y: 460 },
      { x: 3810, y: 345 }
    ]
  },
  {
    id: 4,
    name: '月影竹海',
    kicker: '第四关',
    hint: '踏过月下竹影，别惊动林间的幽影',
    clearCopy: '竹海重新漾起清辉，月光将星火送向下一段旅程。',
    theme: 'bamboo',
    width: 5300,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2740, y: GROUND_TOP },
    gate: { x: 5070, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 820, h: 100, type: 'ground' },
      { x: 980, y: 620, w: 530, h: 100, type: 'ground' },
      { x: 1140, y: 500, w: 170, h: 24, type: 'wood' },
      { x: 1620, y: 620, w: 580, h: 100, type: 'ground' },
      { x: 1810, y: 500, w: 160, h: 24, type: 'wood' },
      { x: 2020, y: 395, w: 165, h: 24, type: 'wood' },
      { x: 2320, y: 620, w: 600, h: 100, type: 'ground' },
      { x: 3200, y: 620, w: 620, h: 100, type: 'ground' },
      { x: 3320, y: 500, w: 170, h: 24, type: 'wood' },
      { x: 3540, y: 405, w: 170, h: 24, type: 'wood' },
      { x: 3940, y: 620, w: 520, h: 100, type: 'ground' },
      { x: 4090, y: 500, w: 165, h: 24, type: 'wood' },
      { x: 4580, y: 620, w: 720, h: 100, type: 'ground' },
      { x: 4790, y: 500, w: 170, h: 24, type: 'wood' }
    ],
    hazards: [
      { x: 610, y: 598, w: 115, h: 22, type: 'thorn' },
      { x: 3380, y: 598, w: 125, h: 22, type: 'thorn' },
      { x: 4620, y: 598, w: 110, h: 22, type: 'thorn' }
    ],
    enemies: [
      { type: 'slime', x: 420, ground: 620, range: 72 },
      { type: 'hornet', x: 1210, y: 428, range: 62 },
      { type: 'cultist', x: 1880, ground: 620, range: 20 },
      { type: 'scarab', x: 2510, ground: 620, range: 92 },
      { type: 'hornet', x: 3420, y: 410, range: 70 },
      { type: 'slime', x: 3710, ground: 620, range: 84 },
      { type: 'cultist', x: 4340, ground: 620, range: 18 }
    ],
    shards: [
      { x: 1270, y: 445 },
      { x: 3410, y: 350 },
      { x: 4830, y: 445 }
    ]
  },
  {
    id: 5,
    name: '霜雪山径',
    kicker: '第五关',
    hint: '冰阶湿滑，借高处的寒光继续攀登',
    clearCopy: '霜风渐渐停歇，冰晶把星火映成温柔的光点。',
    theme: 'frost',
    width: 5500,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2850, y: GROUND_TOP },
    gate: { x: 5280, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 760, h: 100, type: 'ice' },
      { x: 920, y: 620, w: 580, h: 100, type: 'ice' },
      { x: 1010, y: 500, w: 170, h: 24, type: 'ice' },
      { x: 1320, y: 405, w: 165, h: 24, type: 'ice' },
      { x: 1660, y: 620, w: 600, h: 100, type: 'ice' },
      { x: 1810, y: 500, w: 160, h: 24, type: 'ice' },
      { x: 2420, y: 620, w: 600, h: 100, type: 'ice' },
      { x: 2500, y: 475, w: 160, h: 24, type: 'ice', move: { axis: 'y', range: 42, speed: 1.1, phase: 0.6 } },
      { x: 3180, y: 620, w: 580, h: 100, type: 'ice' },
      { x: 3260, y: 420, w: 170, h: 24, type: 'ice' },
      { x: 3480, y: 505, w: 165, h: 24, type: 'ice' },
      { x: 3920, y: 620, w: 620, h: 100, type: 'ice' },
      { x: 4040, y: 485, w: 165, h: 24, type: 'ice' },
      { x: 4700, y: 620, w: 800, h: 100, type: 'ice' },
      { x: 4780, y: 500, w: 170, h: 24, type: 'ice' }
    ],
    hazards: [
      { x: 650, y: 600, w: 140, h: 20, type: 'spike' },
      { x: 1720, y: 600, w: 135, h: 20, type: 'spike' },
      { x: 3340, y: 600, w: 145, h: 20, type: 'spike' },
      { x: 4720, y: 600, w: 130, h: 20, type: 'spike' }
    ],
    enemies: [
      { type: 'slime', x: 380, ground: 620, range: 68 },
      { type: 'raven', x: 1190, y: 400, range: 62 },
      { type: 'scarab', x: 1930, ground: 620, range: 92 },
      { type: 'spore', x: 2590, y: 385, range: 22 },
      { type: 'raven', x: 3390, y: 385, range: 70 },
      { type: 'scarab', x: 4200, ground: 620, range: 110 },
      { type: 'spore', x: 4890, y: 405, range: 20 }
    ],
    shards: [
      { x: 1370, y: 350 },
      { x: 3300, y: 355 },
      { x: 4110, y: 420 }
    ]
  },
  {
    id: 6,
    name: '琥珀沙丘',
    kicker: '第六关',
    hint: '流沙会吞没脚步，踩着遗迹石阶前进',
    clearCopy: '沙海恢复了平静，琥珀色的星火在古城上方闪耀。',
    theme: 'desert',
    width: 5600,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2860, y: GROUND_TOP },
    gate: { x: 5380, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 820, h: 100, type: 'sand' },
      { x: 1000, y: 620, w: 560, h: 100, type: 'sand' },
      { x: 1120, y: 500, w: 170, h: 24, type: 'sand' },
      { x: 1720, y: 620, w: 600, h: 100, type: 'sand' },
      { x: 1820, y: 480, w: 165, h: 24, type: 'sand' },
      { x: 2480, y: 620, w: 580, h: 100, type: 'sand' },
      { x: 2600, y: 400, w: 170, h: 24, type: 'sand' },
      { x: 3220, y: 620, w: 580, h: 100, type: 'sand' },
      { x: 3350, y: 475, w: 165, h: 24, type: 'sand', move: { axis: 'x', range: 52, speed: 1.2, phase: 1.2 } },
      { x: 3980, y: 620, w: 600, h: 100, type: 'sand' },
      { x: 4080, y: 500, w: 170, h: 24, type: 'sand' },
      { x: 4760, y: 620, w: 840, h: 100, type: 'sand' },
      { x: 4850, y: 480, w: 170, h: 24, type: 'sand' }
    ],
    hazards: [
      { x: 820, y: 645, w: 180, h: 75, type: 'sand' },
      { x: 2300, y: 645, w: 180, h: 75, type: 'sand' },
      { x: 4580, y: 645, w: 180, h: 75, type: 'sand' }
    ],
    enemies: [
      { type: 'scarab', x: 430, ground: 620, range: 100 },
      { type: 'cultist', x: 1260, ground: 620, range: 18 },
      { type: 'hornet', x: 1900, y: 410, range: 72 },
      { type: 'scarab', x: 2690, ground: 620, range: 115 },
      { type: 'slime', x: 3520, ground: 620, range: 82 },
      { type: 'cultist', x: 4210, ground: 620, range: 20 },
      { type: 'hornet', x: 5000, y: 395, range: 78 }
    ],
    shards: [
      { x: 1170, y: 440 },
      { x: 2680, y: 335 },
      { x: 4130, y: 440 }
    ]
  },
  {
    id: 7,
    name: '幽光菌谷',
    kicker: '第七关',
    hint: '孢子会爆开暗芒，借菌盖跃过深谷',
    clearCopy: '菌谷的幽光重新连成星带，潮湿的空气也变得温暖。',
    theme: 'fungi',
    width: 5800,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 3000, y: GROUND_TOP },
    gate: { x: 5580, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 780, h: 100, type: 'ground' },
      { x: 940, y: 620, w: 600, h: 100, type: 'ground' },
      { x: 1080, y: 500, w: 170, h: 24, type: 'wood' },
      { x: 1700, y: 620, w: 600, h: 100, type: 'ground' },
      { x: 1800, y: 480, w: 165, h: 24, type: 'wood' },
      { x: 2460, y: 620, w: 640, h: 100, type: 'ground' },
      { x: 2540, y: 400, w: 165, h: 24, type: 'wood', move: { axis: 'y', range: 38, speed: 1.35, phase: 1.4 } },
      { x: 3260, y: 620, w: 640, h: 100, type: 'ground' },
      { x: 3320, y: 470, w: 165, h: 24, type: 'wood' },
      { x: 4060, y: 620, w: 640, h: 100, type: 'ground' },
      { x: 4140, y: 500, w: 165, h: 24, type: 'wood' },
      { x: 4860, y: 620, w: 940, h: 100, type: 'ground' },
      { x: 4940, y: 480, w: 170, h: 24, type: 'wood' }
    ],
    hazards: [
      { x: 600, y: 600, w: 130, h: 20, type: 'spike' },
      { x: 1740, y: 600, w: 125, h: 20, type: 'spike' },
      { x: 3350, y: 600, w: 135, h: 20, type: 'spike' },
      { x: 4890, y: 600, w: 120, h: 20, type: 'spike' }
    ],
    enemies: [
      { type: 'spore', x: 1190, y: 390, range: 20 },
      { type: 'cultist', x: 1860, ground: 620, range: 18 },
      { type: 'slime', x: 2190, ground: 620, range: 82 },
      { type: 'spore', x: 2680, y: 345, range: 22 },
      { type: 'slime', x: 3490, ground: 620, range: 92 },
      { type: 'cultist', x: 4320, ground: 620, range: 20 },
      { type: 'spore', x: 5010, y: 390, range: 24 }
    ],
    shards: [
      { x: 1130, y: 440 },
      { x: 2620, y: 330 },
      { x: 4210, y: 440 }
    ]
  },
  {
    id: 8,
    name: '雷鸣高塔',
    kicker: '第八关',
    hint: '云阶之间雷光交错，抓住空隙向上跃迁',
    clearCopy: '雷塔的轰鸣渐渐远去，星火穿过云层继续前行。',
    theme: 'storm',
    width: 5900,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2920, y: GROUND_TOP },
    gate: { x: 5680, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 760, h: 100, type: 'cloud' },
      { x: 920, y: 620, w: 560, h: 100, type: 'cloud' },
      { x: 1040, y: 500, w: 170, h: 24, type: 'cloud' },
      { x: 1640, y: 620, w: 600, h: 100, type: 'cloud' },
      { x: 1800, y: 450, w: 165, h: 24, type: 'cloud' },
      { x: 2400, y: 620, w: 600, h: 100, type: 'cloud' },
      { x: 2520, y: 380, w: 170, h: 24, type: 'cloud', move: { axis: 'x', range: 46, speed: 1.05, phase: 0.2 } },
      { x: 3160, y: 620, w: 620, h: 100, type: 'cloud' },
      { x: 3300, y: 450, w: 165, h: 24, type: 'cloud' },
      { x: 3940, y: 620, w: 600, h: 100, type: 'cloud' },
      { x: 4020, y: 400, w: 170, h: 24, type: 'cloud' },
      { x: 4700, y: 620, w: 1200, h: 100, type: 'cloud' },
      { x: 4800, y: 500, w: 170, h: 24, type: 'cloud' }
    ],
    hazards: [
      { x: 620, y: 600, w: 120, h: 20, type: 'spike' },
      { x: 2460, y: 600, w: 140, h: 20, type: 'spike' },
      { x: 4010, y: 600, w: 125, h: 20, type: 'spike' }
    ],
    enemies: [
      { type: 'hornet', x: 400, y: 420, range: 60 },
      { type: 'raven', x: 1160, y: 360, range: 72 },
      { type: 'scarab', x: 1930, ground: 620, range: 100 },
      { type: 'spore', x: 2630, y: 315, range: 20 },
      { type: 'raven', x: 3410, y: 360, range: 80 },
      { type: 'cultist', x: 4300, ground: 620, range: 18 },
      { type: 'hornet', x: 4980, y: 385, range: 82 }
    ],
    shards: [
      { x: 1110, y: 440 },
      { x: 2590, y: 310 },
      { x: 4080, y: 340 }
    ]
  },
  {
    id: 9,
    name: '星落遗迹',
    kicker: '第九关',
    hint: '沉睡的巨石在移动，古殿仍守着最后的星火',
    clearCopy: '遗迹的符文重新亮起，坠落的星光找到了归途。',
    theme: 'ruins',
    width: 6000,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 3000, y: GROUND_TOP },
    gate: { x: 5780, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 800, h: 100, type: 'stone' },
      { x: 960, y: 620, w: 580, h: 100, type: 'stone' },
      { x: 1080, y: 500, w: 170, h: 24, type: 'stone' },
      { x: 1700, y: 620, w: 600, h: 100, type: 'stone' },
      { x: 1830, y: 475, w: 165, h: 24, type: 'stone', move: { axis: 'y', range: 44, speed: 1.0, phase: 1.8 } },
      { x: 2460, y: 620, w: 660, h: 100, type: 'stone' },
      { x: 2580, y: 390, w: 170, h: 24, type: 'stone' },
      { x: 3280, y: 620, w: 620, h: 100, type: 'stone' },
      { x: 3380, y: 485, w: 165, h: 24, type: 'stone' },
      { x: 4060, y: 620, w: 620, h: 100, type: 'stone' },
      { x: 4140, y: 410, w: 170, h: 24, type: 'stone', move: { axis: 'x', range: 54, speed: 1.15, phase: 0.9 } },
      { x: 4840, y: 620, w: 1160, h: 100, type: 'stone' },
      { x: 4930, y: 490, w: 170, h: 24, type: 'stone' }
    ],
    hazards: [
      { x: 650, y: 600, w: 130, h: 20, type: 'spike' },
      { x: 2530, y: 600, w: 125, h: 20, type: 'spike' },
      { x: 4120, y: 600, w: 135, h: 20, type: 'spike' }
    ],
    enemies: [
      { type: 'scarab', x: 430, ground: 620, range: 110 },
      { type: 'cultist', x: 1190, ground: 620, range: 20 },
      { type: 'spore', x: 1900, y: 390, range: 22 },
      { type: 'raven', x: 2670, y: 330, range: 70 },
      { type: 'scarab', x: 3500, ground: 620, range: 120 },
      { type: 'cultist', x: 4300, ground: 620, range: 20 },
      { type: 'hornet', x: 5010, y: 390, range: 82 }
    ],
    shards: [
      { x: 1130, y: 440 },
      { x: 2670, y: 320 },
      { x: 4220, y: 340 }
    ]
  },
  {
    id: 10,
    name: '镜湖秘境',
    kicker: '第十关',
    hint: '湖面倒映着另一片天空，踏准浮冰别坠入镜渊',
    clearCopy: '镜湖重新映出完整的星河，水面泛起一圈圈金色涟漪。',
    theme: 'mirror',
    width: 5400,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2850, y: GROUND_TOP },
    gate: { x: 5180, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 780, h: 100, type: 'ice' },
      { x: 940, y: 620, w: 580, h: 100, type: 'ice' },
      { x: 1080, y: 500, w: 170, h: 24, type: 'ice' },
      { x: 1680, y: 620, w: 580, h: 100, type: 'ice' },
      { x: 1800, y: 445, w: 165, h: 24, type: 'ice', move: { axis: 'x', range: 48, speed: 1.1, phase: 0.8 } },
      { x: 2440, y: 620, w: 580, h: 100, type: 'ice' },
      { x: 2560, y: 390, w: 170, h: 24, type: 'ice' },
      { x: 3200, y: 620, w: 600, h: 100, type: 'ice' },
      { x: 3330, y: 470, w: 165, h: 24, type: 'ice' },
      { x: 3960, y: 620, w: 600, h: 100, type: 'ice' },
      { x: 4050, y: 410, w: 170, h: 24, type: 'ice', move: { axis: 'y', range: 38, speed: 1.25, phase: 2.0 } },
      { x: 4720, y: 620, w: 680, h: 100, type: 'ice' },
      { x: 4800, y: 500, w: 170, h: 24, type: 'ice' }
    ],
    hazards: [
      { x: 770, y: 645, w: 180, h: 75, type: 'abyss' },
      { x: 1500, y: 645, w: 190, h: 75, type: 'abyss' },
      { x: 3000, y: 645, w: 210, h: 75, type: 'abyss' },
      { x: 4540, y: 645, w: 190, h: 75, type: 'abyss' }
    ],
    enemies: [
      { type: 'raven', x: 400, y: 410, range: 70 },
      { type: 'spore', x: 1180, y: 390, range: 20 },
      { type: 'cultist', x: 1880, ground: 620, range: 18 },
      { type: 'raven', x: 2670, y: 340, range: 82 },
      { type: 'scarab', x: 3430, ground: 620, range: 110 },
      { type: 'spirit', x: 4140, y: 455, range: 34 }
    ],
    shards: [
      { x: 1140, y: 440 },
      { x: 2640, y: 330 },
      { x: 4130, y: 345 }
    ]
  },
  {
    id: 11,
    name: '赤霞火山',
    kicker: '第十一关',
    hint: '熔岩正在苏醒，借黑曜石台穿过火海',
    clearCopy: '赤霞火山冷却成沉默的岩壁，星火带着暖意飞向夜空。',
    theme: 'ember',
    width: 6100,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2920, y: GROUND_TOP },
    gate: { x: 5860, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 760, h: 100, type: 'obsidian' },
      { x: 920, y: 620, w: 580, h: 100, type: 'obsidian' },
      { x: 1060, y: 500, w: 170, h: 24, type: 'obsidian' },
      { x: 1660, y: 620, w: 620, h: 100, type: 'obsidian' },
      { x: 1800, y: 455, w: 165, h: 24, type: 'obsidian', move: { axis: 'x', range: 52, speed: 1.2, phase: 2.6 } },
      { x: 2440, y: 620, w: 620, h: 100, type: 'obsidian' },
      { x: 2600, y: 390, w: 170, h: 24, type: 'obsidian' },
      { x: 3220, y: 620, w: 620, h: 100, type: 'obsidian' },
      { x: 3340, y: 470, w: 165, h: 24, type: 'obsidian' },
      { x: 4000, y: 620, w: 640, h: 100, type: 'obsidian' },
      { x: 4140, y: 420, w: 170, h: 24, type: 'obsidian', move: { axis: 'y', range: 40, speed: 1.35, phase: 1.0 } },
      { x: 4800, y: 620, w: 1300, h: 100, type: 'obsidian' },
      { x: 4880, y: 500, w: 170, h: 24, type: 'obsidian' }
    ],
    hazards: [
      { x: 760, y: 645, w: 170, h: 75, type: 'lava' },
      { x: 1500, y: 645, w: 170, h: 75, type: 'lava' },
      { x: 3060, y: 645, w: 170, h: 75, type: 'lava' },
      { x: 4640, y: 645, w: 170, h: 75, type: 'lava' }
    ],
    enemies: [
      { type: 'scarab', x: 420, ground: 620, range: 110 },
      { type: 'hornet', x: 1160, y: 390, range: 78 },
      { type: 'spirit', x: 1900, y: 445, range: 34 },
      { type: 'scarab', x: 2710, ground: 620, range: 118 },
      { type: 'hornet', x: 3450, y: 395, range: 84 },
      { type: 'cultist', x: 4300, ground: 620, range: 20 },
      { type: 'spirit', x: 5020, y: 440, range: 38 }
    ],
    shards: [
      { x: 1120, y: 440 },
      { x: 2680, y: 330 },
      { x: 4220, y: 350 }
    ]
  },
  {
    id: 12,
    name: '永夜回廊',
    kicker: '第十二关',
    hint: '暗影在回廊里低语，最后的星门就在前方',
    clearCopy: '永夜回廊被星火劈开一道裂口，天穹尽头传来巨兽的咆哮。',
    theme: 'void',
    width: 6200,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 3000, y: GROUND_TOP },
    gate: { x: 5980, y: 510, w: 130, h: 110, bossGate: false },
    platforms: [
      { x: 0, y: 620, w: 800, h: 100, type: 'obsidian' },
      { x: 960, y: 620, w: 620, h: 100, type: 'obsidian' },
      { x: 1100, y: 500, w: 170, h: 24, type: 'obsidian' },
      { x: 1740, y: 620, w: 620, h: 100, type: 'obsidian' },
      { x: 1880, y: 450, w: 165, h: 24, type: 'obsidian', move: { axis: 'x', range: 58, speed: 1.2, phase: 0.4 } },
      { x: 2520, y: 620, w: 620, h: 100, type: 'obsidian' },
      { x: 2680, y: 385, w: 170, h: 24, type: 'obsidian' },
      { x: 3300, y: 620, w: 640, h: 100, type: 'obsidian' },
      { x: 3420, y: 470, w: 165, h: 24, type: 'obsidian' },
      { x: 4100, y: 620, w: 640, h: 100, type: 'obsidian' },
      { x: 4210, y: 415, w: 170, h: 24, type: 'obsidian', move: { axis: 'y', range: 42, speed: 1.1, phase: 2.0 } },
      { x: 4900, y: 620, w: 1300, h: 100, type: 'obsidian' },
      { x: 5000, y: 500, w: 170, h: 24, type: 'obsidian' }
    ],
    hazards: [
      { x: 790, y: 645, w: 180, h: 75, type: 'abyss' },
      { x: 1560, y: 645, w: 190, h: 75, type: 'abyss' },
      { x: 3120, y: 645, w: 180, h: 75, type: 'abyss' },
      { x: 4720, y: 645, w: 180, h: 75, type: 'abyss' }
    ],
    enemies: [
      { type: 'raven', x: 410, y: 400, range: 80 },
      { type: 'cultist', x: 1200, ground: 620, range: 20 },
      { type: 'spore', x: 1980, y: 380, range: 24 },
      { type: 'scarab', x: 2720, ground: 620, range: 120 },
      { type: 'raven', x: 3500, y: 365, range: 88 },
      { type: 'cultist', x: 4310, ground: 620, range: 20 },
      { type: 'spore', x: 5100, y: 400, range: 24 }
    ],
    shards: [
      { x: 1160, y: 440 },
      { x: 2760, y: 325 },
      { x: 4300, y: 355 }
    ]
  },
  {
    id: 13,
    name: '天穹圣域',
    kicker: '第十三关',
    hint: '三十九枚星火即将齐聚，迎战暗影巨兽·夜嚎',
    clearCopy: '天穹重新亮起，长夜终于迎来真正的黎明。',
    theme: 'celestial',
    width: 6200,
    spawn: { x: 150, y: GROUND_TOP },
    checkpoint: { x: 2800, y: GROUND_TOP },
    gate: { x: 4520, y: 500, w: 140, h: 120, bossGate: true },
    platforms: [
      { x: 0, y: 620, w: 900, h: 100, type: 'cloud' },
      { x: 1050, y: 620, w: 590, h: 100, type: 'cloud' },
      { x: 1160, y: 500, w: 170, h: 24, type: 'cloud' },
      { x: 1480, y: 410, w: 165, h: 24, type: 'cloud' },
      { x: 1800, y: 620, w: 620, h: 100, type: 'cloud' },
      { x: 1910, y: 500, w: 165, h: 24, type: 'cloud' },
      { x: 2600, y: 620, w: 620, h: 100, type: 'cloud' },
      { x: 2700, y: 430, w: 170, h: 24, type: 'cloud', move: { axis: 'y', range: 36, speed: 1.2, phase: 0.8 } },
      { x: 3380, y: 620, w: 620, h: 100, type: 'cloud' },
      { x: 3470, y: 450, w: 165, h: 24, type: 'cloud' },
      { x: 3710, y: 380, w: 165, h: 24, type: 'cloud' },
      { x: 4050, y: 470, w: 170, h: 24, type: 'cloud' },
      { x: 4200, y: 620, w: 2000, h: 100, type: 'cloud' }
    ],
    hazards: [],
    enemies: [
      { type: 'hornet', x: 480, y: 420, range: 68 },
      { type: 'cultist', x: 1250, ground: 620, range: 20 },
      { type: 'spore', x: 1960, y: 390, range: 22 },
      { type: 'raven', x: 2760, y: 350, range: 82 },
      { type: 'scarab', x: 3560, ground: 620, range: 120 },
      { type: 'hornet', x: 4100, y: 340, range: 72 }
    ],
    shards: [
      { x: 1210, y: 440 },
      { x: 2780, y: 350 },
      { x: 4140, y: 390 }
    ]
  }
];

function createPlatform(config, index) {
  const platform = {
    ...config,
    id: `platform-${currentLevelIndex}-${index}`,
    baseX: config.x,
    baseY: config.y,
    previousX: config.x,
    previousY: config.y,
    deltaX: 0,
    deltaY: 0
  };
  return platform;
}

function createEnemy(config, index) {
  const sizes = {
    mushroom: { w: 48, h: 44, hp: 2, speed: 58 },
    moth: { w: 46, h: 36, hp: 1, speed: 64 },
    beetle: { w: 56, h: 38, hp: 3, speed: 48 },
    spirit: { w: 42, h: 56, hp: 2, speed: 18 },
    wisp: { w: 48, h: 58, hp: 2, speed: 52 },
    slime: { w: 50, h: 36, hp: 2, speed: 38 },
    hornet: { w: 50, h: 34, hp: 2, speed: 90 },
    cultist: { w: 42, h: 66, hp: 3, speed: 0 },
    scarab: { w: 62, h: 40, hp: 3, speed: 52 },
    spore: { w: 52, h: 52, hp: 2, speed: 0 },
    raven: { w: 58, h: 42, hp: 2, speed: 70 }
  };
  const size = sizes[config.type] || sizes.mushroom;
  const y = Number.isFinite(config.y) ? config.y : config.ground - size.h;
  return {
    id: `${config.type}-${currentLevelIndex}-${index}`,
    type: config.type,
    x: config.x,
    y,
    w: size.w,
    h: size.h,
    baseX: config.x,
    baseY: y,
    hp: size.hp,
    maxHp: size.hp,
    speed: size.speed,
    range: config.range || 70,
    direction: index % 2 === 0 ? 1 : -1,
    phase: index * 0.9 + 0.7,
    shootTimer: 1.2 + (index % 3) * 0.55,
    castWindup: 0,
    chargeWindup: 0,
    chargeTimer: 0,
    hopCooldown: 0.8 + (index % 3) * 0.45,
    vy: 0,
    onGround: true,
    hitFlash: 0,
    hitStun: 0,
    knockbackX: 0,
    alive: true,
    contactCooldown: 0
  };
}

function createBoss() {
  return {
    id: makeId('boss'),
    x: 5380,
    y: 468,
    w: 178,
    h: 152,
    vx: 0,
    vy: 0,
    hp: 12,
    maxHp: 12,
    phase: 1,
    state: 'wake',
    timer: 1.6,
    direction: -1,
    hitFlash: 0,
    onGround: true,
    alive: true,
    deathTimer: 0,
    attackCount: 0,
    lastHitAttack: -1
  };
}

function resetPlayerAt(x, groundY) {
  player.x = x;
  player.y = groundY - player.h;
  player.vx = 0;
  player.vy = 0;
  player.facing = 1;
  player.onGround = false;
  player.standingPlatform = null;
  player.coyoteTimer = 0;
  player.dashTimer = 0;
  player.dashCooldown = 0;
  player.attackTimer = 0;
  player.attackQueued = false;
  player.comboStep = 0;
  player.comboReset = 0;
  player.invulnTime = 1.1;
  player.hurtFlash = 0;
  player.pitGuard = 0;
  player.landSquash = 0;
  player.walkPhase = 0;
}

function loadLevel(index) {
  currentLevelIndex = clamp(index, 0, LEVELS.length - 1);
  pendingTransition = null;
  const config = LEVELS[currentLevelIndex];
  level = {
    ...config,
    cleared: false
  };
  worldTime = 0;
  gameTime = 0;
  camera.x = 0;
  projectiles = [];
  shockwaves = [];
  particles = [];
  floaters = [];
  boss = null;
  platforms = config.platforms.map((platform, platformIndex) => createPlatform(platform, platformIndex));
  enemies = config.enemies.map((enemy, enemyIndex) => createEnemy(enemy, enemyIndex));
  shards = config.shards.map((shard, shardIndex) => ({
    id: `shard-${currentLevelIndex}-${shardIndex}`,
    x: shard.x - 18,
    y: shard.y - 18,
    w: 36,
    h: 36,
    collected: false,
    phase: shardIndex * 1.7
  }));
  hazards = config.hazards.map((hazard, hazardIndex) => ({
    ...hazard,
    id: `hazard-${currentLevelIndex}-${hazardIndex}`
  }));
  checkpoint = {
    x: config.checkpoint.x,
    y: config.checkpoint.y,
    active: false,
    glow: 0
  };
  gate = {
    ...config.gate,
    open: false,
    bossTriggered: false
  };
  player = {
    id: 'player',
    x: config.spawn.x,
    y: config.spawn.y - PLAYER_H,
    w: PLAYER_W,
    h: PLAYER_H,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: false,
    standingPlatform: null,
    coyoteTimer: 0,
    dashTimer: 0,
    dashCooldown: 0,
    attackTimer: 0,
    attackDuration: 0.24,
    attackQueued: false,
    attackId: 0,
    hitTargets: new Set(),
    comboStep: 0,
    comboReset: 0,
    health: MAX_HEALTH,
    invulnTime: 1.1,
    hurtFlash: 0,
    pitGuard: 0,
    landSquash: 0,
    walkPhase: 0,
    lastPlatform: null,
    dustTimer: 0,
    trail: [],
    gateMessageTimer: 0
  };
  resetPlayerAt(config.spawn.x, config.spawn.y);
  currentScore = levelEntryScore;
  dom.introKicker.textContent = config.kicker;
  dom.introTitle.textContent = config.name;
  dom.introHint.textContent = config.hint;
  dom.bossBar.hidden = true;
  dom.hud.hidden = false;
  clearInput();
  updateHearts(true);
  updateHud();
  updateGateState();
  mode = 'intro';
  introTimer = 2.05;
  showScreen(dom.screenIntro);
  setTouchControlsVisible(false);
  audio.unlock();
  audio.setTheme(config.theme);
}

function startLevel(index, score) {
  audio.unlock();
  levelEntryScore = Math.max(0, Number(score) || 0);
  currentScore = levelEntryScore;
  loadLevel(index);
}

function startNewRun() {
  audio.unlock();
  startLevel(0, 0);
}

function continueRun() {
  audio.unlock();
  startLevel(saveData.unlockedLevel - 1, 0);
}

function retryLevel() {
  audio.unlock();
  startLevel(currentLevelIndex, levelEntryScore);
}

function nextLevel() {
  if (currentLevelIndex < LEVELS.length - 1) {
    startLevel(currentLevelIndex + 1, currentScore);
  }
}

function showScreen(screen) {
  [dom.screenMenu, dom.screenIntro, dom.screenPause, dom.screenLevelClear, dom.screenGameOver, dom.screenVictory].forEach((item) => {
    item.classList.toggle('is-active', item === screen);
  });
}

function setTouchControlsVisible(visible) {
  const active = Boolean(visible && isTouchDevice);
  dom.touchControls.classList.toggle('is-active', active);
  dom.touchControls.setAttribute('aria-hidden', String(!active));
}

function updateHearts(force = false) {
  if (force || dom.hearts.childElementCount !== MAX_HEALTH) {
    dom.hearts.innerHTML = '';
    for (let index = 0; index < MAX_HEALTH; index += 1) {
      const heart = document.createElement('span');
      heart.className = 'heart';
      heart.textContent = '♥';
      dom.hearts.appendChild(heart);
    }
  }
  Array.from(dom.hearts.children).forEach((heart, index) => {
    heart.classList.toggle('is-lost', index >= player.health);
  });
  dom.hearts.setAttribute('aria-label', `生命值 ${player.health} / ${MAX_HEALTH}`);
}

function animateHeartLoss() {
  const hearts = Array.from(dom.hearts.children);
  const heart = hearts[player.health];
  if (!heart) return;
  heart.classList.remove('is-hit');
  void heart.offsetWidth;
  heart.classList.add('is-hit');
}

function collectedShardCount() {
  return shards.filter((shard) => shard.collected).length;
}

function updateHud() {
  if (!level || !player) return;
  dom.hudLevel.textContent = LEVEL_NAMES[currentLevelIndex];
  dom.hudLevelName.textContent = level.name;
  dom.hudShards.textContent = `${collectedShardCount()} / 3`;
  dom.hudScore.textContent = String(currentScore);
  dom.bestScore.textContent = String(saveData.bestScore);
}

function updateGateState() {
  if (!gate) return;
  gate.open = collectedShardCount() === 3;
}

function addScore(amount) {
  currentScore += amount;
  updateBestScore(currentScore);
  updateHud();
}

function showToast(text, duration = 1700) {
  window.clearTimeout(toastTimeout);
  dom.toast.textContent = text;
  dom.toast.classList.add('is-visible');
  toastTimeout = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, duration);
}

function updateMuteUi() {
  dom.muteButton.classList.toggle('is-muted', saveData.muted);
  dom.muteButton.setAttribute('aria-label', saveData.muted ? '开启音效' : '关闭音效');
  dom.menuSoundButton.textContent = saveData.muted ? '音效：关' : '音效：开';
  dom.menuSoundButton.setAttribute('aria-pressed', String(!saveData.muted));
}

function toggleMute() {
  audio.unlock();
  saveData.muted = !saveData.muted;
  audio.setMuted(saveData.muted);
  persistSave();
  updateMuteUi();
  if (!saveData.muted && mode === 'menu') audio.setTheme('menu');
}

function syncMenu() {
  dom.bestScore.textContent = String(saveData.bestScore);
  if (saveData.unlockedLevel > 1) {
    dom.continueButton.hidden = false;
    dom.continueButton.textContent = `继续第${saveData.unlockedLevel}关`;
  } else {
    dom.continueButton.hidden = true;
  }
  updateMuteUi();
}

function returnToMenu() {
  mode = 'menu';
  pendingTransition = null;
  player = null;
  level = null;
  boss = null;
  projectiles = [];
  shockwaves = [];
  clearInput();
  dom.hud.hidden = true;
  dom.bossBar.hidden = true;
  dom.toast.classList.remove('is-visible');
  setTouchControlsVisible(false);
  showScreen(dom.screenMenu);
  syncMenu();
  audio.setTheme('menu');
}

function pauseGame() {
  if (mode !== 'playing') return;
  mode = 'paused';
  clearInput();
  dom.pauseScore.textContent = String(currentScore);
  setTouchControlsVisible(false);
  showScreen(dom.screenPause);
  audio.stopMusic();
}

function resumeGame() {
  if (mode !== 'paused') return;
  audio.unlock();
  mode = 'playing';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  showScreen(null);
  setTouchControlsVisible(true);
  audio.setTheme(level.theme);
}

function togglePause() {
  if (mode === 'playing') pauseGame();
  else if (mode === 'paused') resumeGame();
}

function finishLevel() {
  if (mode !== 'playing' || !level || level.cleared) return;
  level.cleared = true;
  mode = 'levelClear';
  const bonus = 500 + player.health * 100;
  currentScore += bonus;
  updateBestScore(currentScore);
  const nextUnlocked = Math.min(LEVELS.length, currentLevelIndex + 2);
  if (nextUnlocked > saveData.unlockedLevel) {
    saveData.unlockedLevel = nextUnlocked;
  }
  persistSave();
  updateHud();
  setTouchControlsVisible(false);
  dom.bossBar.hidden = true;
  dom.clearCopy.textContent = level.clearCopy;
  dom.clearShards.textContent = '3 / 3';
  dom.clearHealth.textContent = String(player.health);
  dom.clearScore.textContent = String(currentScore);
  dom.nextButton.textContent = currentLevelIndex < LEVELS.length - 1 ? '前往下一关' : '继续冒险';
  showScreen(dom.screenLevelClear);
  audio.sfx('clear');
  audio.setTheme(null);
}

function gameOver() {
  if (mode === 'gameOver' || mode === 'victory') return;
  mode = 'gameOver';
  player.health = 0;
  updateHearts();
  updateBestScore(currentScore);
  updateHud();
  setTouchControlsVisible(false);
  dom.bossBar.hidden = true;
  dom.overScore.textContent = String(currentScore);
  showScreen(dom.screenGameOver);
  audio.sfx('gameover');
  audio.setTheme(null);
}

function winGame() {
  if (mode === 'victory') return;
  mode = 'victory';
  currentScore += 500 + player.health * 100;
  updateBestScore(currentScore);
  persistSave();
  updateHud();
  setTouchControlsVisible(false);
  dom.bossBar.hidden = true;
  dom.victoryScore.textContent = String(currentScore);
  dom.victoryBest.textContent = String(saveData.bestScore);
  showScreen(dom.screenVictory);
  audio.sfx('victory');
  audio.setTheme('victory');
  createVictoryBurst();
}

function clearInput() {
  input.left = false;
  input.right = false;
  input.jumpHeld = false;
  input.jumpBuffer = 0;
  input.attackBuffer = 0;
  input.dashBuffer = 0;
  if (typeof resetAllInputSources === 'function') resetAllInputSources();
}

function shakeScreen(strength = 6, duration = 0.24) {
  if (prefersReducedMotion) return;
  shakeStrength = Math.max(shakeStrength, strength);
  shakeTime = Math.max(shakeTime, duration);
}

function flashScreen(duration = 0.12) {
  if (prefersReducedMotion) return;
  flashTime = Math.max(flashTime, duration);
}

function spawnBurst(x, y, color, count = 12, power = 190, size = 4) {
  const total = prefersReducedMotion ? Math.ceil(count / 3) : count;
  for (let index = 0; index < total; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = power * (0.35 + Math.random() * 0.9);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      gravity: 540,
      life: 0.35 + Math.random() * 0.45,
      maxLife: 0.8,
      size: size * (0.55 + Math.random()),
      color,
      spin: Math.random() * Math.PI
    });
  }
  if (particles.length > 190) particles.splice(0, particles.length - 190);
}

function spawnDust(x, y, color = '#f7dfad') {
  if (prefersReducedMotion) return;
  for (let index = 0; index < 5; index += 1) {
    particles.push({
      x: x + (Math.random() - 0.5) * 24,
      y,
      vx: (Math.random() - 0.5) * 80,
      vy: -25 - Math.random() * 55,
      gravity: 140,
      life: 0.24 + Math.random() * 0.22,
      maxLife: 0.46,
      size: 2 + Math.random() * 3,
      color,
      spin: 0
    });
  }
}

function addFloater(x, y, text, color = '#ffd36e') {
  floaters.push({ x, y, text, color, life: 0.95, maxLife: 0.95 });
}

function createVictoryBurst() {
  const colors = ['#ffd166', '#ffeab1', '#73e2d0', '#ffffff', '#ff9a66'];
  for (let index = 0; index < 42; index += 1) {
    const x = camera.x + 180 + Math.random() * 920;
    const y = 80 + Math.random() * 380;
    const color = colors[index % colors.length];
    spawnBurst(x, y, color, 4, 150, 3.4);
  }
}

function updateEffects(dt) {
  shakeTime = Math.max(0, shakeTime - dt);
  if (shakeTime <= 0) shakeStrength = 0;
  flashTime = Math.max(0, flashTime - dt);
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.life -= dt;
    if (particle.life <= 0) {
      particles.splice(index, 1);
      continue;
    }
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.985;
    particle.spin += dt * 5;
  }
  for (let index = floaters.length - 1; index >= 0; index -= 1) {
    const floater = floaters[index];
    floater.life -= dt;
    floater.y -= 42 * dt;
    if (floater.life <= 0) floaters.splice(index, 1);
  }
  if (player) {
    if (player.trail) {
      for (let index = player.trail.length - 1; index >= 0; index -= 1) {
        player.trail[index].life -= dt;
        if (player.trail[index].life <= 0) player.trail.splice(index, 1);
      }
    }
    player.landSquash = Math.max(0, player.landSquash - dt * 4);
  }
}

function beginPlayerAttack() {
  const p = player;
  if (!p) return;
  if (p.comboReset <= 0) p.comboStep = 0;
  p.comboStep = p.comboStep >= 3 ? 1 : p.comboStep + 1;
  p.attackTimer = p.attackDuration;
  p.attackId += 1;
  p.hitTargets.clear();
  p.attackQueued = false;
  p.comboReset = 0.52;
  p.vx += p.facing * (p.comboStep === 3 ? 95 : 58);
  audio.sfx('attack');
}

function playerAttackBox() {
  const reach = 69 + player.comboStep * 8;
  return {
    x: player.facing > 0 ? player.x + player.w - 7 : player.x - reach + 7,
    y: player.y + 8 - (player.comboStep === 3 ? 6 : 0),
    w: reach,
    h: player.h - 10 + (player.comboStep === 3 ? 12 : 0)
  };
}

function updatePlayer(dt) {
  const p = player;
  if (!p || mode !== 'playing') return;
  p.invulnTime = Math.max(0, p.invulnTime - dt);
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.pitGuard = Math.max(0, p.pitGuard - dt);
  p.gateMessageTimer = Math.max(0, p.gateMessageTimer - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  p.coyoteTimer = p.onGround ? 0.105 : Math.max(0, p.coyoteTimer - dt);

  if (p.attackTimer > 0) {
    p.attackTimer = Math.max(0, p.attackTimer - dt);
    if (p.attackTimer === 0 && p.attackQueued) beginPlayerAttack();
  }
  if (p.comboReset > 0) {
    p.comboReset = Math.max(0, p.comboReset - dt);
    if (p.comboReset === 0 && p.attackTimer === 0) p.comboStep = 0;
  }

  if (input.dashBuffer > 0) {
    input.dashBuffer = 0;
    if (p.dashCooldown <= 0 && p.dashTimer <= 0) {
      p.dashTimer = 0.17;
      p.dashCooldown = 0.7;
      p.vy = 0;
      p.invulnTime = Math.max(p.invulnTime, 0.2);
      p.trail = [];
      audio.sfx('dash');
      spawnBurst(p.x + p.w / 2, p.y + p.h / 2, '#9ffff0', 7, 95, 3);
    }
  }

  let direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (p.attackTimer > 0 && p.dashTimer <= 0) direction *= 0.52;
  if (direction !== 0 && p.dashTimer <= 0) p.facing = direction;

  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.vx = p.facing * 790;
    p.vy = 0;
    p.trail.push({ x: p.x, y: p.y, facing: p.facing, life: 0.22, maxLife: 0.22 });
    if (p.trail.length > 12) p.trail.shift();
    if (Math.random() < 0.7) {
      particles.push({
        x: p.x + p.w / 2,
        y: p.y + p.h * (0.35 + Math.random() * 0.5),
        vx: -p.facing * (40 + Math.random() * 90),
        vy: (Math.random() - 0.5) * 40,
        gravity: 0,
        life: 0.16 + Math.random() * 0.12,
        maxLife: 0.28,
        size: 2 + Math.random() * 3,
        color: '#72eadb',
        spin: 0
      });
    }
  } else {
    const speed = p.attackTimer > 0 ? 165 : 342;
    const targetVelocity = direction * speed;
    const acceleration = p.onGround ? 2900 : 1900;
    p.vx = approach(p.vx, targetVelocity, acceleration * dt);
    if (direction === 0) {
      const friction = p.onGround ? 2600 : 540;
      p.vx = approach(p.vx, 0, friction * dt);
    }
  }

  if (input.jumpBuffer > 0 && (p.onGround || p.coyoteTimer > 0) && p.dashTimer <= 0) {
    p.vy = -930;
    p.onGround = false;
    p.coyoteTimer = 0;
    input.jumpBuffer = 0;
    audio.sfx('jump');
    spawnDust(p.x + p.w / 2, p.y + p.h, '#f6e3b5');
  }

  if (p.dashTimer <= 0) {
    let gravity = 2320;
    if (p.vy < -240 && !input.jumpHeld) gravity *= 1.85;
    if (p.vy > 0) gravity *= 1.08;
    p.vy = Math.min(1240, p.vy + gravity * dt);
  }

  p.walkPhase += Math.abs(p.vx) * dt * 0.032;
  const wasFalling = p.vy > 300;
  const previousBottom = p.y + p.h;
  const previousTop = p.y;
  p.x += p.vx * dt;

  for (const platform of platforms) {
    if (!rectsOverlap(p, platform)) continue;
    const feetAbove = previousBottom <= platform.y + 6;
    if (feetAbove && p.vy >= 0) continue;
    if (p.vx > 0) {
      p.x = platform.x - p.w - 0.01;
      p.vx = 0;
    } else if (p.vx < 0) {
      p.x = platform.x + platform.w + 0.01;
      p.vx = 0;
    }
  }
  p.x = clamp(p.x, 0, level.width - p.w);

  p.y += p.vy * dt;
  p.onGround = false;
  p.standingPlatform = null;
  for (const platform of platforms) {
    if (!rectsOverlap(p, platform)) continue;
    const topPenetration = p.y + p.h - platform.y;
    const bottomPenetration = platform.y + platform.h - p.y;
    const landedFromAbove = p.vy >= 0 && previousBottom <= platform.y + 18;
    const bumpedFromBelow = p.vy < 0 && previousTop >= platform.y + platform.h - 16;
    if (landedFromAbove || (topPenetration <= bottomPenetration && p.vy >= 0)) {
      p.y = platform.y - p.h;
      if (wasFalling) {
        p.landSquash = Math.min(0.14, Math.abs(p.vy) / 8000);
        spawnDust(p.x + p.w / 2, p.y + p.h, '#f8e5b8');
      }
      p.vy = 0;
      p.onGround = true;
      p.standingPlatform = platform;
    } else if (bumpedFromBelow || p.vy < 0) {
      p.y = platform.y + platform.h;
      p.vy = Math.max(0, p.vy);
    }
  }

  if (input.attackBuffer > 0) {
    input.attackBuffer = 0;
    if (p.attackTimer > 0) p.attackQueued = true;
    else beginPlayerAttack();
  }

  if (p.onGround && Math.abs(p.vx) > 155) {
    p.dustTimer -= dt;
    if (p.dustTimer <= 0) {
      p.dustTimer = 0.13;
      spawnDust(p.x + p.w / 2 - p.facing * 12, p.y + p.h, '#ead8a5');
    }
  }

  input.jumpBuffer = Math.max(0, input.jumpBuffer - dt);
  input.attackBuffer = Math.max(0, input.attackBuffer - dt);
  input.dashBuffer = Math.max(0, input.dashBuffer - dt);

  if (p.y > VIEW_H + 120) handleFall();
}

function hurtPlayer(amount = 1, sourceX = null) {
  if (!player || mode !== 'playing') return;
  if (player.invulnTime > 0 || player.dashTimer > 0) return;
  const oldHealth = player.health;
  player.health = Math.max(0, player.health - amount);
  player.invulnTime = 1.25;
  player.hurtFlash = 0.24;
  const away = sourceX === null ? -player.facing : (player.x + player.w / 2 < sourceX ? -1 : 1);
  player.vx = away * 360;
  player.vy = -330;
  player.onGround = false;
  player.comboStep = 0;
  player.attackTimer = 0;
  shakeScreen(9, 0.3);
  flashScreen(0.16);
  audio.sfx('hurt');
  spawnBurst(player.x + player.w / 2, player.y + player.h / 2, '#ff7e8c', 13, 180, 4);
  updateHearts();
  animateHeartLoss();
  if (oldHealth > player.health && player.health > 0) addFloater(player.x + player.w / 2, player.y, '受伤', '#ff9ca7');
  if (player.health <= 0) gameOver();
}

function handleFall() {
  if (!player || mode !== 'playing' || player.pitGuard > 0) return;
  player.health = Math.max(0, player.health - 1);
  player.pitGuard = 0.8;
  updateHearts();
  animateHeartLoss();
  audio.sfx('hurt');
  flashScreen(0.18);
  if (player.health <= 0) {
    gameOver();
    return;
  }
  const respawnX = checkpoint.active ? checkpoint.x : level.spawn.x;
  const respawnY = checkpoint.active ? checkpoint.y : level.spawn.y;
  resetPlayerAt(respawnX, respawnY);
  player.pitGuard = 0.9;
  player.invulnTime = 1.6;
  camera.x = clamp(respawnX - VIEW_W * 0.4, 0, level.width - VIEW_W);
  showToast('小心脚下 · 已回到灯笼旁');
  spawnBurst(respawnX + PLAYER_W / 2, respawnY - PLAYER_H / 2, '#ffe199', 15, 155, 4);
}

function updatePlatforms(dt) {
  for (const platform of platforms) {
    platform.previousX = platform.x;
    platform.previousY = platform.y;
    if (platform.move) {
      const offset = Math.sin(worldTime * platform.move.speed + platform.move.phase) * platform.move.range;
      if (platform.move.axis === 'x') platform.x = platform.baseX + offset;
      else platform.y = platform.baseY + offset;
    }
    platform.deltaX = platform.x - platform.previousX;
    platform.deltaY = platform.y - platform.previousY;
    if (mode === 'playing' && player && player.standingPlatform === platform) {
      player.x += platform.deltaX;
      player.y += platform.deltaY;
    }
  }
}

function shootProjectile(x, y, targetX, targetY, speed, type, radius = 8) {
  const dx = targetX - x;
  const dy = targetY - y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  projectiles.push({
    id: makeId('projectile'),
    x,
    y,
    vx: (dx / distance) * speed,
    vy: (dy / distance) * speed,
    radius,
    type,
    life: 4.2,
    spin: 0
  });
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.hitStun = Math.max(0, enemy.hitStun - dt);
    enemy.contactCooldown = Math.max(0, enemy.contactCooldown - dt);
    const playerCenterX = player.x + player.w / 2;
    const playerCenterY = player.y + player.h / 2;
    const enemyCenterX = enemy.x + enemy.w / 2;
    const enemyCenterY = enemy.y + enemy.h / 2;
    const distanceToPlayer = Math.hypot(playerCenterX - enemyCenterX, playerCenterY - enemyCenterY);

    if (enemy.type === 'mushroom' || enemy.type === 'beetle') {
      if (enemy.hitStun > 0) {
        enemy.x += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 1200 * dt);
      } else {
        enemy.x += enemy.direction * enemy.speed * dt;
        if (enemy.x < enemy.baseX - enemy.range) {
          enemy.x = enemy.baseX - enemy.range;
          enemy.direction = 1;
        } else if (enemy.x > enemy.baseX + enemy.range) {
          enemy.x = enemy.baseX + enemy.range;
          enemy.direction = -1;
        }
      }
    } else if (enemy.type === 'slime') {
      enemy.hopCooldown = Math.max(0, enemy.hopCooldown - dt);
      if (enemy.hitStun > 0) {
        enemy.x += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 1200 * dt);
      } else {
        if (enemy.onGround && enemy.hopCooldown <= 0) {
          enemy.vy = -330;
          enemy.onGround = false;
          enemy.hopCooldown = 1.35 + (enemy.phase % 0.65);
        }
        if (!enemy.onGround) {
          enemy.vy += 1050 * dt;
          enemy.y += enemy.vy * dt;
          if (enemy.y >= enemy.baseY) {
            enemy.y = enemy.baseY;
            enemy.vy = 0;
            enemy.onGround = true;
          }
        }
        enemy.x += enemy.direction * enemy.speed * dt;
        if (enemy.x < enemy.baseX - enemy.range) {
          enemy.x = enemy.baseX - enemy.range;
          enemy.direction = 1;
        } else if (enemy.x > enemy.baseX + enemy.range) {
          enemy.x = enemy.baseX + enemy.range;
          enemy.direction = -1;
        }
      }
    } else if (enemy.type === 'spirit') {
      enemy.y = enemy.baseY + Math.sin(worldTime * 2.1 + enemy.phase) * 9;
      if (enemy.hitStun > 0) {
        enemy.x += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 900 * dt);
      } else {
        enemy.x = enemy.baseX + Math.sin(worldTime * 0.8 + enemy.phase) * (enemy.range * 0.4);
      }
      enemy.shootTimer -= dt;
      if (enemy.shootTimer <= 0 && distanceToPlayer < 690) {
        enemy.shootTimer = enemy.hp > 1 ? 2.35 : 2.8;
        shootProjectile(
          enemy.x + enemy.w / 2,
          enemy.y + enemy.h * 0.42,
          player.x + player.w / 2,
          player.y + player.h / 2,
          210,
          'spirit',
          9
        );
        spawnBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h * 0.4, '#ff9a6d', 5, 55, 2.5);
      }
    } else if (enemy.type === 'moth' || enemy.type === 'wisp') {
      if (enemy.type === 'wisp') {
        enemy.diveTimer = Math.max(0, (enemy.diveTimer || 0) - dt);
        enemy.diveCooldown = Math.max(0, (enemy.diveCooldown || 2.6) - dt);
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        if (enemy.diveCooldown <= 0 && enemy.hitStun <= 0 && Math.hypot(dx, dy) < 510 && Math.abs(dx) > 70) {
          enemy.diveTimer = 0.52;
          enemy.diveCooldown = 3.2;
          enemy.diveTargetX = player.x + player.w / 2 - enemy.w / 2;
          enemy.diveTargetY = player.y + player.h / 2 - enemy.h / 2;
          spawnBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, '#8d7af0', 6, 60, 2.5);
        }
      }
      if (enemy.hitStun > 0) {
        enemy.baseX += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 1100 * dt);
      }
      if (enemy.type === 'wisp' && enemy.diveTimer > 0) {
        enemy.diveTimer -= dt;
        enemy.x = approach(enemy.x, enemy.diveTargetX, 550 * dt);
        enemy.y = approach(enemy.y, enemy.diveTargetY, 550 * dt);
      } else {
        enemy.x = enemy.baseX + Math.sin(worldTime * 1.25 + enemy.phase) * enemy.range;
        enemy.y = enemy.baseY + Math.sin(worldTime * 2.2 + enemy.phase * 1.4) * (enemy.type === 'wisp' ? 34 : 24);
      }
    } else if (enemy.type === 'hornet' || enemy.type === 'raven') {
      enemy.diveCooldown = Math.max(0, (enemy.diveCooldown ?? (1.6 + enemy.phase * 0.3)) - dt);
      const hoverX = enemy.baseX + Math.sin(worldTime * (enemy.type === 'raven' ? 0.72 : 1.18) + enemy.phase) * enemy.range;
      const hoverY = enemy.baseY + Math.sin(worldTime * (enemy.type === 'raven' ? 1.6 : 2.3) + enemy.phase * 1.3) * (enemy.type === 'raven' ? 24 : 18);
      if (enemy.hitStun > 0) {
        enemy.x += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 1000 * dt);
      } else if (enemy.diveWindup > 0) {
        enemy.diveWindup = Math.max(0, enemy.diveWindup - dt);
        enemy.x = approach(enemy.x, hoverX, 80 * dt);
        enemy.y = approach(enemy.y, hoverY - 10, 80 * dt);
        if (enemy.diveWindup <= 0) {
          enemy.diveTimer = enemy.type === 'raven' ? 0.62 : 0.48;
          enemy.diveTargetX = player.x + player.w / 2 - enemy.w / 2;
          enemy.diveTargetY = player.y + player.h * 0.58 - enemy.h / 2;
          enemy.direction = enemy.diveTargetX < enemy.x ? -1 : 1;
          spawnBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, enemy.type === 'raven' ? '#bca3ff' : '#ffe18c', 7, 80, 2.8);
        }
      } else if (enemy.diveTimer > 0) {
        enemy.diveTimer = Math.max(0, enemy.diveTimer - dt);
        const diveSpeed = enemy.type === 'raven' ? 670 : 600;
        enemy.x = approach(enemy.x, enemy.diveTargetX, diveSpeed * dt);
        enemy.y = approach(enemy.y, enemy.diveTargetY, diveSpeed * dt);
      } else {
        enemy.x = approach(enemy.x, hoverX, enemy.speed * 1.6 * dt);
        enemy.y = approach(enemy.y, hoverY, enemy.speed * 1.4 * dt);
        if (enemy.diveCooldown <= 0 && distanceToPlayer < (enemy.type === 'raven' ? 650 : 560)) {
          enemy.diveWindup = enemy.type === 'raven' ? 0.46 : 0.34;
          enemy.diveCooldown = enemy.type === 'raven' ? 3.1 : 2.65;
          enemy.direction = playerCenterX < enemyCenterX ? -1 : 1;
        }
      }
    } else if (enemy.type === 'cultist') {
      enemy.y = enemy.baseY;
      enemy.direction = playerCenterX < enemyCenterX ? -1 : 1;
      if (enemy.hitStun > 0) {
        enemy.x += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 950 * dt);
      } else if (enemy.castWindup > 0) {
        enemy.castWindup = Math.max(0, enemy.castWindup - dt);
        if (enemy.castWindup === 0) {
          const originX = enemy.x + enemy.w / 2 + enemy.direction * 16;
          const originY = enemy.y + 18;
          const targetX = player.x + player.w / 2;
          const targetY = player.y + player.h / 2;
          const count = enemy.hp > 1 ? 3 : 2;
          const baseAngle = Math.atan2(targetY - originY, targetX - originX);
          for (let shot = 0; shot < count; shot += 1) {
            const spread = (shot - (count - 1) / 2) * 0.15;
            shootProjectile(
              originX,
              originY,
              originX + Math.cos(baseAngle + spread) * 280,
              originY + Math.sin(baseAngle + spread) * 280,
              235,
              'dark',
              9
            );
          }
          spawnBurst(originX, originY, '#dc8bff', 9, 95, 3);
        }
      } else {
        enemy.shootTimer -= dt;
        if (enemy.shootTimer <= 0 && distanceToPlayer < 730) {
          enemy.castWindup = 0.56;
          enemy.shootTimer = 3.05;
        }
      }
    } else if (enemy.type === 'scarab') {
      enemy.chargeCooldown = Math.max(0, (enemy.chargeCooldown ?? 1.1) - dt);
      if (enemy.hitStun > 0) {
        enemy.x += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 1100 * dt);
      } else if (enemy.chargeWindup > 0) {
        enemy.chargeWindup = Math.max(0, enemy.chargeWindup - dt);
        enemy.direction = playerCenterX < enemyCenterX ? -1 : 1;
        if (enemy.chargeWindup === 0) {
          enemy.chargeTimer = 0.62;
          enemy.chargeCooldown = 2.8;
        }
      } else if (enemy.chargeTimer > 0) {
        enemy.chargeTimer = Math.max(0, enemy.chargeTimer - dt);
        enemy.x += enemy.direction * enemy.speed * 4.4 * dt;
      } else {
        enemy.x += enemy.direction * enemy.speed * dt;
        if (enemy.x < enemy.baseX - enemy.range) {
          enemy.x = enemy.baseX - enemy.range;
          enemy.direction = 1;
        } else if (enemy.x > enemy.baseX + enemy.range) {
          enemy.x = enemy.baseX + enemy.range;
          enemy.direction = -1;
        }
        if (enemy.chargeCooldown <= 0 && Math.abs(playerCenterX - enemyCenterX) < 300) {
          enemy.chargeWindup = 0.38;
          enemy.direction = playerCenterX < enemyCenterX ? -1 : 1;
        }
      }
      enemy.x = clamp(enemy.x, enemy.baseX - enemy.range * 1.5, enemy.baseX + enemy.range * 1.5);
    } else if (enemy.type === 'spore') {
      enemy.x = enemy.baseX + Math.sin(worldTime * 0.8 + enemy.phase) * enemy.range * 0.45;
      enemy.y = enemy.baseY + Math.sin(worldTime * 1.7 + enemy.phase) * 13;
      if (enemy.hitStun > 0) {
        enemy.x += enemy.knockbackX * dt;
        enemy.knockbackX = approach(enemy.knockbackX, 0, 850 * dt);
      } else {
        enemy.shootTimer -= dt;
        if (enemy.shootTimer <= 0 && distanceToPlayer < 660) {
          enemy.shootTimer = 3.15;
          for (let shot = 0; shot < 8; shot += 1) {
            const angle = worldTime * 0.45 + (shot / 8) * Math.PI * 2;
            shootProjectile(
              enemy.x + enemy.w / 2,
              enemy.y + enemy.h / 2,
              enemy.x + enemy.w / 2 + Math.cos(angle) * 260,
              enemy.y + enemy.h / 2 + Math.sin(angle) * 260,
              145,
              'spore',
              8
            );
          }
          spawnBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, '#9bf0bd', 12, 100, 3);
        }
      }
    }

    if (rectsOverlap(player, enemy) && player.invulnTime <= 0 && player.dashTimer <= 0) {
      hurtPlayer(1, enemy.x + enemy.w / 2);
    }
  }
}

function damageEnemy(enemy, direction) {
  enemy.hp -= 1;
  enemy.hitFlash = 0.14;
  enemy.hitStun = 0.2;
  enemy.knockbackX = direction * 260;
  spawnBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, '#ffe6a8', 7, 125, 3);
  if (enemy.hp <= 0) {
    enemy.alive = false;
    addScore(50);
    addFloater(enemy.x + enemy.w / 2, enemy.y - 4, '+50', '#ffe07d');
    spawnBurst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, enemy.type === 'wisp' ? '#a18cf4' : '#ffb869', 18, 230, 4.5);
    audio.sfx('enemy');
    shakeScreen(4, 0.14);
  } else {
    audio.sfx('hit');
  }
}

function damageBoss() {
  if (!boss || !boss.alive) return;
  boss.hp -= 1;
  boss.hitFlash = 0.14;
  spawnBurst(boss.x + boss.w * 0.42, boss.y + boss.h * 0.55, '#ffcf7b', 10, 155, 4);
  audio.sfx('hit');
  shakeScreen(5, 0.15);
  const nextPhase = boss.hp <= 4 ? 3 : boss.hp <= 8 ? 2 : 1;
  if (nextPhase > boss.phase) {
    boss.phase = nextPhase;
    showToast(nextPhase === 2 ? '暗影巨兽开始召唤暗星！' : '暗影巨兽进入狂暴状态！', 2100);
    shakeScreen(12, 0.42);
    flashScreen(0.2);
    audio.sfx('boss');
  }
  updateBossBar();
  if (boss.hp <= 0) defeatBoss();
}

function defeatBoss() {
  if (!boss || !boss.alive) return;
  boss.alive = false;
  boss.state = 'dying';
  boss.deathTimer = 2.1;
  boss.hp = 0;
  addScore(1000);
  addFloater(boss.x + boss.w / 2, boss.y, '+1000', '#ffd166');
  updateBossBar();
  spawnBurst(boss.x + boss.w / 2, boss.y + boss.h / 2, '#ffce70', 34, 340, 6);
  spawnBurst(boss.x + boss.w / 2, boss.y + boss.h / 2, '#8e79ee', 26, 280, 5);
  shakeScreen(16, 0.7);
  flashScreen(0.32);
  showToast('三十九枚星火汇聚，暗影正在消散……', 2300);
  dom.bossBar.hidden = true;
  pendingTransition = { type: 'victory', timer: 2.1 };
  audio.sfx('boss');
}

function updateBossBar() {
  if (!boss) {
    dom.bossBar.hidden = true;
    return;
  }
  dom.bossBar.hidden = !boss.alive || boss.hp <= 0;
  dom.bossBarFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
  dom.bossPhase.textContent = boss.phase === 1 ? '第一阶段' : boss.phase === 2 ? '第二阶段' : '狂暴阶段';
}

function chooseBossAttack() {
  const choices = boss.phase === 1 ? ['charge', 'slam'] : boss.phase === 2 ? ['slam', 'volley', 'charge'] : ['charge', 'volley', 'slam', 'charge'];
  const attack = choices[boss.attackCount % choices.length];
  boss.attackCount += 1;
  boss.direction = player.x + player.w / 2 < boss.x + boss.w / 2 ? -1 : 1;
  boss.state = `${attack}Windup`;
  boss.timer = boss.phase === 3 ? 0.43 : 0.58;
  if (attack === 'charge') audio.sfx('boss');
}

function updateBoss(dt) {
  if (!boss) return;
  boss.hitFlash = Math.max(0, boss.hitFlash - dt);
  if (!boss.alive) {
    boss.deathTimer = Math.max(0, boss.deathTimer - dt);
    return;
  }
  boss.timer -= dt;
  if (boss.state === 'wake') {
    if (boss.timer <= 0) {
      boss.state = 'idle';
      boss.timer = 0.7;
    }
  } else if (boss.state === 'idle') {
    if (boss.timer <= 0) chooseBossAttack();
  } else if (boss.state === 'chargeWindup') {
    if (boss.timer <= 0) {
      boss.state = 'charge';
      boss.timer = boss.phase === 3 ? 0.58 : 0.5;
      boss.vx = boss.direction * (boss.phase === 3 ? 850 : 690);
    }
  } else if (boss.state === 'charge') {
    boss.x += boss.vx * dt;
    if (boss.x < 4680) {
      boss.x = 4680;
      boss.timer = 0;
    } else if (boss.x > 5822) {
      boss.x = 5822;
      boss.timer = 0;
    }
    if (boss.timer <= 0) {
      boss.state = 'recovery';
      boss.timer = 0.78;
      boss.vx = 0;
      shakeScreen(6, 0.2);
    }
  } else if (boss.state === 'slamWindup') {
    if (boss.timer <= 0) {
      boss.state = 'slamAir';
      boss.vy = -880;
      boss.vx = boss.direction * 120;
      boss.timer = 1.2;
    }
  } else if (boss.state === 'slamAir') {
    boss.vy += 2450 * dt;
    boss.y += boss.vy * dt;
    boss.x += boss.vx * dt;
    boss.x = clamp(boss.x, 4680, 5822);
    if (boss.y + boss.h >= GROUND_TOP && boss.vy > 0) {
      boss.y = GROUND_TOP - boss.h;
      boss.vy = 0;
      boss.vx = 0;
      boss.state = 'recovery';
      boss.timer = boss.phase === 3 ? 0.72 : 1.05;
      shakeScreen(14, 0.5);
      flashScreen(0.14);
      audio.sfx('boss');
      shockwaves.push({ x: boss.x + 20, y: GROUND_TOP - 40, w: 66, h: 40, vx: -420, life: 2.1 });
      shockwaves.push({ x: boss.x + boss.w - 86, y: GROUND_TOP - 40, w: 66, h: 40, vx: 420, life: 2.1 });
      spawnBurst(boss.x + boss.w / 2, GROUND_TOP, '#ffad68', 22, 250, 5);
    }
  } else if (boss.state === 'volleyWindup') {
    if (boss.timer <= 0) {
      const originX = boss.x + boss.w * 0.38;
      const originY = boss.y + boss.h * 0.3;
      const targetX = player.x + player.w / 2;
      const targetY = player.y + player.h / 2;
      const count = boss.phase === 3 ? 5 : 3;
      const baseAngle = Math.atan2(targetY - originY, targetX - originX);
      for (let index = 0; index < count; index += 1) {
        const spread = (index - (count - 1) / 2) * 0.16;
        const distance = 260;
        shootProjectile(
          originX,
          originY,
          originX + Math.cos(baseAngle + spread) * distance,
          originY + Math.sin(baseAngle + spread) * distance,
          250,
          'boss',
          12
        );
      }
      boss.state = 'recovery';
      boss.timer = 0.85;
      shakeScreen(5, 0.2);
    }
  } else if (boss.state === 'recovery') {
    if (boss.timer <= 0) {
      boss.state = 'idle';
      boss.timer = boss.phase === 3 ? 0.3 : 0.55;
    }
  }

  boss.y = Math.min(boss.y, GROUND_TOP - boss.h);
  if (rectsOverlap(player, boss) && player.invulnTime <= 0 && player.dashTimer <= 0) {
    hurtPlayer(1, boss.x + boss.w / 2);
  }
}

function updateProjectiles(dt) {
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    projectile.life -= dt;
    projectile.spin += dt * 6;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    if (projectile.life <= 0 || projectile.y > VIEW_H + 80 || projectile.x < camera.x - 1500 || projectile.x > camera.x + VIEW_W + 1500) {
      projectiles.splice(index, 1);
      continue;
    }
    if (rectsOverlap(player, { x: projectile.x - projectile.radius, y: projectile.y - projectile.radius, w: projectile.radius * 2, h: projectile.radius * 2 })) {
      hurtPlayer(1, projectile.x);
      projectiles.splice(index, 1);
    }
  }
}

function updateShockwaves(dt) {
  for (let index = shockwaves.length - 1; index >= 0; index -= 1) {
    const wave = shockwaves[index];
    wave.life -= dt;
    wave.x += wave.vx * dt;
    if (wave.life <= 0 || wave.x < 4400 || wave.x > 6000) {
      shockwaves.splice(index, 1);
      continue;
    }
    if (rectsOverlap(player, wave)) hurtPlayer(1, wave.x + wave.w / 2);
  }
}

function updateCombatHits() {
  const active = player.attackTimer > 0.045 && player.attackTimer < 0.19;
  if (!active) return;
  const hitbox = playerAttackBox();
  for (const enemy of enemies) {
    if (!enemy.alive || player.hitTargets.has(enemy.id)) continue;
    if (rectsOverlap(hitbox, enemy)) {
      player.hitTargets.add(enemy.id);
      damageEnemy(enemy, player.facing);
    }
  }
  if (boss && boss.alive && !player.hitTargets.has(boss.id) && rectsOverlap(hitbox, boss)) {
    player.hitTargets.add(boss.id);
    damageBoss();
  }
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    const box = { x: projectile.x - projectile.radius, y: projectile.y - projectile.radius, w: projectile.radius * 2, h: projectile.radius * 2 };
    if (rectsOverlap(hitbox, box) && !player.hitTargets.has(projectile.id)) {
      player.hitTargets.add(projectile.id);
      const burstColor = projectile.type === 'boss' ? '#c4a7ff'
        : projectile.type === 'dark' ? '#df9aff'
          : projectile.type === 'spore' ? '#9ff0b9' : '#ffb187';
      spawnBurst(projectile.x, projectile.y, burstColor, 10, 130, 3);
      projectiles.splice(index, 1);
      audio.sfx('hit');
    }
  }
}

function updateShards() {
  for (const shard of shards) {
    if (shard.collected) continue;
    if (rectsOverlap(player, shard, 4)) {
      shard.collected = true;
      addScore(100);
      addFloater(shard.x + shard.w / 2, shard.y, '+100', '#ffe17b');
      spawnBurst(shard.x + shard.w / 2, shard.y + shard.h / 2, '#ffe483', 19, 210, 4);
      audio.sfx('pickup');
      updateHud();
      updateGateState();
      if (collectedShardCount() === 3) {
        showToast('三枚星火已集齐，星门开启！', 2200);
        spawnBurst(gate.x + gate.w / 2, gate.y + gate.h / 2, '#9effea', 22, 230, 4);
      }
    }
  }
}

function updateHazards() {
  for (const hazard of hazards) {
    if (!rectsOverlap(player, hazard, 2)) continue;
    if (hazard.type === 'lava' || hazard.type === 'sand' || hazard.type === 'abyss') {
      handleFall();
      return;
    }
    if (hazard.type === 'thorn' || hazard.type === 'spike') {
      hurtPlayer(1, hazard.x + hazard.w / 2);
      return;
    }
  }
}

function updateCheckpointAndGate(dt) {
  if (!checkpoint.active && player.x + player.w / 2 >= checkpoint.x) {
    checkpoint.active = true;
    checkpoint.glow = 1;
    spawnBurst(checkpoint.x, checkpoint.y - 52, '#ffd36e', 18, 150, 4);
    audio.sfx('checkpoint');
    showToast('灯笼已点亮 · 此处为检查点', 1900);
  }

  if (!gate || gate.bossTriggered) return;
  const nearGate = player.x + player.w >= gate.x - 6;
  if (!nearGate) return;
  if (!gate.open) {
    player.x = gate.x - player.w - 7;
    player.vx = Math.min(0, player.vx);
    if (player.gateMessageTimer <= 0) {
      player.gateMessageTimer = 1.5;
      const missing = 3 - collectedShardCount();
      showToast(`星门尚未开启 · 还需 ${missing} 枚星火`, 1500);
    }
    return;
  }
  if (gate.bossGate) {
    activateBoss();
  } else if (player.x + player.w > gate.x + 8) {
    finishLevel();
  }
}

function activateBoss() {
  if (!gate || !gate.bossGate || boss) return;
  gate.bossTriggered = true;
  boss = createBoss();
  player.x = Math.max(player.x, 4580);
  camera.x = clamp(player.x - 160, 4240, level.width - VIEW_W);
  dom.bossBar.hidden = false;
  updateBossBar();
  shakeScreen(10, 0.45);
  flashScreen(0.2);
  audio.sfx('boss');
  showToast('暗影巨兽 · 夜嚎 现身了！', 2200);
  spawnBurst(boss.x + boss.w / 2, boss.y + boss.h / 2, '#8b75e7', 28, 270, 5);
}

function updateCamera(dt) {
  let target = player.x + player.w / 2 + player.facing * 74 - VIEW_W * 0.44;
  if (boss) {
    const midpoint = (player.x + player.w / 2 + boss.x + boss.w / 2) / 2;
    target = clamp(midpoint - VIEW_W / 2, 4240, level.width - VIEW_W);
  }
  target = clamp(target, 0, Math.max(0, level.width - VIEW_W));
  const smooth = 1 - Math.exp(-7.5 * dt);
  camera.x = lerp(camera.x, target, smooth);
  if (Math.abs(camera.x - target) < 0.15) camera.x = target;
}

function beginPlaying() {
  if (!level) return;
  mode = 'playing';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  showScreen(null);
  setTouchControlsVisible(true);
  audio.unlock();
  audio.setTheme(level.theme);
}

function updateGame(dt) {
  if (!level || !player) return;
  if (mode === 'paused') return;
  worldTime += dt;
  updateEffects(dt);

  if (mode === 'intro') {
    introTimer -= dt;
    updatePlatforms(dt);
    if (introTimer <= 0) beginPlaying();
    return;
  }

  if (mode !== 'playing') return;
  gameTime += dt;
  updatePlatforms(dt);
  updatePlayer(dt);
  if (mode !== 'playing') return;
  if (gate && gate.bossTriggered) {
    player.x = Math.max(player.x, 4590);
  }
  updateEnemies(dt);
  if (mode !== 'playing') return;
  updateBoss(dt);
  if (mode !== 'playing') return;
  updateCombatHits();
  updateProjectiles(dt);
  updateShockwaves(dt);
  if (mode !== 'playing') return;
  updateShards();
  updateHazards();
  if (mode !== 'playing') return;
  updateCheckpointAndGate(dt);
  updateCamera(dt);
  updateBossBar();

  if (pendingTransition) {
    pendingTransition.timer -= dt;
    if (pendingTransition.timer <= 0) {
      const transition = pendingTransition.type;
      pendingTransition = null;
      if (transition === 'victory') winGame();
    }
  }
}

function roundRectPath(x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrap(value, span) {
  return ((value % span) + span) % span;
}

function drawCloudShape(x, y, scale, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff9e9';
  ctx.beginPath();
  ctx.arc(x, y, 28 * scale, Math.PI, Math.PI * 1.8);
  ctx.arc(x + 34 * scale, y - 14 * scale, 40 * scale, Math.PI * 1.05, Math.PI * 1.9);
  ctx.arc(x + 78 * scale, y - 3 * scale, 31 * scale, Math.PI * 1.15, Math.PI * 2.05);
  ctx.arc(x + 112 * scale, y + 5 * scale, 21 * scale, Math.PI * 1.3, Math.PI * 2.1);
  ctx.lineTo(x + 110 * scale, y + 22 * scale);
  ctx.lineTo(x + 4 * scale, y + 22 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRidge(offset, baseY, height, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-80, VIEW_H);
  ctx.lineTo(-80, baseY);
  for (let x = -80; x <= VIEW_W + 80; x += 46) {
    const wx = x + offset;
    const wave = Math.sin(wx * 0.0042) * 0.5 + Math.sin(wx * 0.0091 + 1.7) * 0.3;
    ctx.lineTo(x, baseY - height * (0.42 + wave * 0.58));
  }
  ctx.lineTo(VIEW_W + 80, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

function drawForestBackground(cam, isMenu = false) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#72cdf1');
  sky.addColorStop(0.42, '#b9e7e3');
  sky.addColorStop(0.74, '#f8e7b3');
  sky.addColorStop(1, '#dfb977');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const sunX = 1035;
  const sunY = 130;
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 190);
  sunGlow.addColorStop(0, 'rgba(255, 251, 206, 0.95)');
  sunGlow.addColorStop(0.28, 'rgba(255, 227, 143, 0.48)');
  sunGlow.addColorStop(1, 'rgba(255, 220, 145, 0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(sunX - 200, sunY - 200, 400, 400);
  ctx.fillStyle = 'rgba(255, 250, 208, 0.9)';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 42, 0, Math.PI * 2);
  ctx.fill();

  for (let index = 0; index < 5; index += 1) {
    const x = wrap(index * 310 - cam * 0.045, 1600) - 190;
    drawCloudShape(x, 108 + (index % 3) * 54, 0.65 + (index % 2) * 0.22, 0.55);
  }

  drawRidge(cam * 0.06, 470, 155, 'rgba(88, 133, 139, 0.27)');
  drawRidge(cam * 0.12 + 90, 520, 125, 'rgba(57, 109, 106, 0.38)');

  const distantOffset = cam * 0.2;
  for (let index = 0; index < 18; index += 1) {
    const x = wrap(index * 112 - distantOffset, 2200) - 260;
    const height = 120 + (index % 4) * 34;
    ctx.fillStyle = index % 2 ? 'rgba(34, 91, 78, 0.34)' : 'rgba(49, 111, 88, 0.28)';
    ctx.beginPath();
    ctx.moveTo(x, 610);
    ctx.lineTo(x + 34, 610 - height);
    ctx.lineTo(x + 68, 610);
    ctx.closePath();
    ctx.fill();
  }

  const treeOffset = cam * 0.4;
  for (let index = 0; index < 10; index += 1) {
    const x = wrap(index * 196 - treeOffset, 2100) - 260;
    ctx.strokeStyle = 'rgba(28, 70, 57, 0.46)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(x, 640);
    ctx.quadraticCurveTo(x + 18, 520, x + 2, 420);
    ctx.stroke();
    ctx.fillStyle = 'rgba(34, 93, 67, 0.44)';
    ctx.beginPath();
    ctx.arc(x + 2, 414, 54, 0, Math.PI * 2);
    ctx.arc(x - 34, 450, 39, 0, Math.PI * 2);
    ctx.arc(x + 42, 455, 36, 0, Math.PI * 2);
    ctx.fill();
  }

  const light = ctx.createLinearGradient(0, 250, 0, VIEW_H);
  light.addColorStop(0, 'rgba(255, 244, 194, 0)');
  light.addColorStop(1, isMenu ? 'rgba(42, 91, 66, 0.24)' : 'rgba(42, 91, 66, 0.12)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  for (let index = 0; index < 22; index += 1) {
    const x = wrap(index * 157 + Math.sin(demoTime * 0.7 + index) * 34 - cam * 0.32, 1450) - 85;
    const y = 190 + ((index * 93) % 340) + Math.sin(demoTime * 1.3 + index * 1.7) * 16;
    const pulse = 0.25 + (Math.sin(demoTime * 2 + index) * 0.5 + 0.5) * 0.55;
    ctx.fillStyle = `rgba(255, 235, 151, ${pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.8 + (index % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCaveBackground(cam) {
  const cave = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  cave.addColorStop(0, '#1c122b');
  cave.addColorStop(0.5, '#3b1c2e');
  cave.addColorStop(1, '#1a0d19');
  ctx.fillStyle = cave;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const glow = ctx.createRadialGradient(650, 690, 10, 650, 690, 460);
  glow.addColorStop(0, 'rgba(255, 113, 58, 0.38)');
  glow.addColorStop(0.5, 'rgba(217, 70, 47, 0.15)');
  glow.addColorStop(1, 'rgba(126, 31, 46, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 200, VIEW_W, 520);

  ctx.fillStyle = 'rgba(14, 9, 25, 0.62)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(VIEW_W, 0);
  ctx.lineTo(VIEW_W, 58);
  for (let x = VIEW_W; x >= 0; x -= 42) {
    const length = 22 + (Math.sin((x + cam * 0.16) * 0.05) * 0.5 + 0.5) * 54;
    ctx.lineTo(x, 48 + length);
    ctx.lineTo(x - 21, 48);
  }
  ctx.closePath();
  ctx.fill();

  const offset = cam * 0.12;
  ctx.fillStyle = 'rgba(82, 36, 51, 0.32)';
  for (let index = 0; index < 14; index += 1) {
    const x = wrap(index * 170 - offset, 2200) - 280;
    const width = 58 + (index % 4) * 22;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + width, 170, x + width * 0.5, 360, x + width * 0.76, 620);
    ctx.lineTo(x + width * 0.24, 620);
    ctx.bezierCurveTo(x + width * 0.1, 390, x - width * 0.2, 180, x, 0);
    ctx.fill();
  }

  for (let index = 0; index < 8; index += 1) {
    const x = wrap(index * 260 - cam * 0.2, 2000) - 300;
    ctx.fillStyle = 'rgba(16, 8, 20, 0.42)';
    ctx.beginPath();
    ctx.moveTo(x, 620);
    ctx.quadraticCurveTo(x + 80, 410, x + 190, 620);
    ctx.closePath();
    ctx.fill();
  }

  for (let index = 0; index < 11; index += 1) {
    const x = wrap(index * 188 - cam * 0.24, 2200) - 290;
    const baseY = 486 + (index * 43) % 104;
    const height = 28 + (index % 4) * 18;
    const warm = index % 3 === 0;
    ctx.save();
    ctx.shadowColor = warm ? 'rgba(255, 129, 76, 0.4)' : 'rgba(92, 218, 212, 0.34)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = warm ? 'rgba(132, 65, 67, 0.46)' : 'rgba(58, 91, 105, 0.43)';
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + 13, baseY - height);
    ctx.lineTo(x + 27, baseY - height * 0.34);
    ctx.lineTo(x + 40, baseY - height * 1.34);
    ctx.lineTo(x + 56, baseY - height * 0.18);
    ctx.lineTo(x + 68, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = warm ? 'rgba(255, 167, 111, 0.34)' : 'rgba(126, 241, 230, 0.3)';
    ctx.beginPath();
    ctx.moveTo(x + 12, baseY - 5);
    ctx.lineTo(x + 20, baseY - height * 0.72);
    ctx.lineTo(x + 28, baseY - 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const lowerGlow = ctx.createLinearGradient(0, 610, 0, VIEW_H);
  lowerGlow.addColorStop(0, 'rgba(255, 122, 53, 0.22)');
  lowerGlow.addColorStop(1, 'rgba(255, 92, 35, 0.04)');
  ctx.fillStyle = lowerGlow;
  ctx.fillRect(0, 610, VIEW_W, 110);

  for (let index = 0; index < 28; index += 1) {
    const x = wrap(index * 113 + Math.sin(demoTime * 1.2 + index) * 45 - cam * 0.35, 1500) - 110;
    const y = 510 - ((index * 61 + demoTime * (22 + index % 5 * 8)) % 430);
    const alpha = 0.22 + (index % 4) * 0.12;
    ctx.fillStyle = index % 3 === 0 ? `rgba(255, 196, 106, ${alpha})` : `rgba(255, 106, 62, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.4 + (index % 3), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSkyBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#12163d');
  sky.addColorStop(0.42, '#393174');
  sky.addColorStop(0.75, '#8a5d83');
  sky.addColorStop(1, '#f0a476');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  for (let index = 0; index < 54; index += 1) {
    const x = wrap(index * 163 - cam * 0.035, 1500) - 110;
    const y = 30 + ((index * 79) % 390);
    const twinkle = 0.38 + (Math.sin(demoTime * 1.7 + index * 1.9) * 0.5 + 0.5) * 0.6;
    ctx.fillStyle = `rgba(255, 245, 213, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (index % 3) * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }

  const moonX = 1015 - cam * 0.015;
  const moonGlow = ctx.createRadialGradient(moonX, 150, 10, moonX, 150, 155);
  moonGlow.addColorStop(0, 'rgba(255, 241, 197, 0.5)');
  moonGlow.addColorStop(1, 'rgba(255, 241, 197, 0)');
  ctx.fillStyle = moonGlow;
  ctx.fillRect(moonX - 170, -20, 340, 340);
  ctx.fillStyle = '#fff3ce';
  ctx.beginPath();
  ctx.arc(moonX, 150, 50, 0, Math.PI * 2);
  ctx.fill();

  for (let index = 0; index < 7; index += 1) {
    const x = wrap(index * 250 - cam * 0.08, 1800) - 280;
    drawCloudShape(x, 300 + (index % 3) * 63, 0.65, 0.16);
  }

  drawRidge(cam * 0.12, 590, 130, 'rgba(30, 28, 73, 0.45)');
  drawRidge(cam * 0.2 + 110, 625, 86, 'rgba(22, 20, 55, 0.52)');

  const cloudSea = ctx.createLinearGradient(0, 500, 0, VIEW_H);
  cloudSea.addColorStop(0, 'rgba(250, 205, 182, 0)');
  cloudSea.addColorStop(1, 'rgba(252, 208, 176, 0.16)');
  ctx.fillStyle = cloudSea;
  ctx.fillRect(0, 500, VIEW_W, 220);

  for (let index = 0; index < 7; index += 1) {
    const x = wrap(index * 290 - cam * 0.36 + Math.sin(demoTime * 0.25 + index) * 24, 1900) - 310;
    const y = 575 + (index % 3) * 42;
    drawCloudShape(x, y, 1.15, 0.14 + (index % 2) * 0.08);
  }

  for (let index = 0; index < 4; index += 1) {
    const x = wrap(index * 430 - cam * 0.16, 1900) - 310;
    const y = 440 + (index % 2) * 52;
    ctx.fillStyle = 'rgba(23, 22, 58, 0.38)';
    ctx.beginPath();
    ctx.ellipse(x + 80, y, 96, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(54, 45, 93, 0.42)';
    ctx.beginPath();
    ctx.moveTo(x + 38, y + 7);
    ctx.lineTo(x + 58, y - 48);
    ctx.lineTo(x + 120, y - 52);
    ctx.lineTo(x + 142, y + 5);
    ctx.closePath();
    ctx.fill();
  }

  for (let index = 0; index < 4; index += 1) {
    const x = wrap(index * 370 - cam * 0.28, 1900) - 340;
    ctx.strokeStyle = 'rgba(255, 228, 196, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 235 + index * 36);
    ctx.quadraticCurveTo(x + 130, 210 + index * 34, x + 280, 242 + index * 36);
    ctx.stroke();
  }
}

function drawStarfield(cam, count, parallax, color = '255, 244, 214') {
  for (let index = 0; index < count; index += 1) {
    const x = wrap(index * 157 - cam * parallax, 1580) - 140;
    const y = 24 + ((index * 83) % 410);
    const twinkle = 0.26 + (Math.sin(demoTime * 1.7 + index * 2.1) * 0.5 + 0.5) * 0.64;
    ctx.fillStyle = `rgba(${color}, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + (index % 3) * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBambooLeaf(x, y, scale, rotation, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 18 * scale, 4.2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBambooBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#081b2a');
  sky.addColorStop(0.45, '#17424a');
  sky.addColorStop(0.78, '#6b9d85');
  sky.addColorStop(1, '#c6dbb0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const moonX = 1010 - cam * 0.018;
  const moonGlow = ctx.createRadialGradient(moonX, 138, 9, moonX, 138, 170);
  moonGlow.addColorStop(0, 'rgba(244, 255, 218, 0.58)');
  moonGlow.addColorStop(1, 'rgba(207, 242, 196, 0)');
  ctx.fillStyle = moonGlow;
  ctx.fillRect(moonX - 180, -40, 360, 360);
  ctx.fillStyle = '#eff8cf';
  ctx.beginPath();
  ctx.arc(moonX, 138, 48, 0, Math.PI * 2);
  ctx.fill();
  drawRidge(cam * 0.08, 530, 116, 'rgba(20, 57, 54, 0.34)');
  drawRidge(cam * 0.14 + 100, 585, 82, 'rgba(10, 42, 42, 0.5)');

  for (let layer = 0; layer < 2; layer += 1) {
    const parallax = layer === 0 ? 0.16 : 0.36;
    const alpha = layer === 0 ? 0.24 : 0.48;
    for (let index = 0; index < 18; index += 1) {
      const x = wrap(index * 103 - cam * parallax, 1800) - 190 + layer * 37;
      const baseY = 665;
      const height = 280 + (index % 5) * 44 + layer * 70;
      const lean = Math.sin(index * 1.7) * 10;
      ctx.strokeStyle = `rgba(${layer === 0 ? '35, 91, 72' : '18, 61, 54'}, ${alpha})`;
      ctx.lineWidth = layer === 0 ? 5 : 8;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + lean, baseY - height * 0.48, x + lean * 1.5, baseY - height);
      ctx.stroke();
      ctx.strokeStyle = `rgba(139, 192, 125, ${alpha * 0.54})`;
      ctx.lineWidth = 1.4;
      for (let node = 1; node < 7; node += 1) {
        const nodeY = baseY - height * (node / 7);
        ctx.beginPath();
        ctx.moveTo(x + lean * (node / 7) - 5, nodeY);
        ctx.lineTo(x + lean * (node / 7) + 6, nodeY);
        ctx.stroke();
      }
      const leafColor = `rgba(${layer === 0 ? '68, 124, 79' : '33, 94, 64'}, ${alpha * 1.1})`;
      drawBambooLeaf(x + lean, baseY - height + 24, 1.6, -0.65, leafColor);
      drawBambooLeaf(x + lean + 2, baseY - height + 36, 1.25, 0.85, leafColor);
      drawBambooLeaf(x + lean - 2, baseY - height * 0.68, 1.1, -1.05, leafColor);
      drawBambooLeaf(x + lean + 8, baseY - height * 0.55, 0.95, 0.7, leafColor);
    }
  }
  const mist = ctx.createLinearGradient(0, 405, 0, 690);
  mist.addColorStop(0, 'rgba(207, 231, 194, 0)');
  mist.addColorStop(0.55, 'rgba(195, 225, 196, 0.16)');
  mist.addColorStop(1, 'rgba(230, 239, 210, 0.1)');
  ctx.fillStyle = mist;
  ctx.fillRect(0, 380, VIEW_W, 340);
  for (let index = 0; index < 24; index += 1) {
    const x = wrap(index * 127 + Math.sin(demoTime * 0.7 + index) * 26 - cam * 0.28, 1460) - 90;
    const y = 200 + ((index * 79) % 330);
    const pulse = 0.2 + (Math.sin(demoTime * 2.4 + index) * 0.5 + 0.5) * 0.66;
    ctx.fillStyle = `rgba(215, 255, 159, ${pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.4 + (index % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFrostBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#07192f');
  sky.addColorStop(0.35, '#28537b');
  sky.addColorStop(0.7, '#8db3c9');
  sky.addColorStop(1, '#d8e9e7');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawStarfield(cam, 62, 0.04);
  for (let ribbon = 0; ribbon < 3; ribbon += 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const aurora = ctx.createLinearGradient(0, 60, VIEW_W, 210);
    aurora.addColorStop(0, 'rgba(99, 245, 206, 0)');
    aurora.addColorStop(0.4, `rgba(${ribbon === 1 ? '142, 189, 255' : '93, 244, 204'}, ${0.15 + ribbon * 0.05})`);
    aurora.addColorStop(0.72, 'rgba(170, 140, 255, 0.1)');
    aurora.addColorStop(1, 'rgba(120, 195, 255, 0)');
    ctx.strokeStyle = aurora;
    ctx.lineWidth = 34 - ribbon * 7;
    ctx.beginPath();
    ctx.moveTo(-50, 170 + ribbon * 34);
    ctx.bezierCurveTo(280, 30 + ribbon * 24, 760, 220 - ribbon * 18, VIEW_W + 60, 74 + ribbon * 30);
    ctx.stroke();
    ctx.restore();
  }
  drawRidge(cam * 0.07, 520, 196, 'rgba(64, 101, 130, 0.38)');
  drawRidge(cam * 0.14 + 90, 570, 142, 'rgba(41, 76, 105, 0.48)');
  drawRidge(cam * 0.22 + 60, 625, 94, 'rgba(25, 53, 79, 0.58)');
  const iceGlow = ctx.createLinearGradient(0, 540, 0, VIEW_H);
  iceGlow.addColorStop(0, 'rgba(225, 252, 255, 0)');
  iceGlow.addColorStop(1, 'rgba(195, 241, 255, 0.16)');
  ctx.fillStyle = iceGlow;
  ctx.fillRect(0, 520, VIEW_W, 200);
  for (let index = 0; index < 48; index += 1) {
    const x = wrap(index * 123 + demoTime * (7 + index % 5) - cam * 0.24, 1530) - 100;
    const y = (index * 67 + demoTime * (18 + index % 7)) % 620;
    ctx.fillStyle = `rgba(240, 253, 255, ${0.28 + (index % 4) * 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + (index % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDesertBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#402542');
  sky.addColorStop(0.34, '#ad5f51');
  sky.addColorStop(0.65, '#e5a25f');
  sky.addColorStop(1, '#e8c482');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const sunX = 985 - cam * 0.012;
  const sunY = 185;
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 12, sunX, sunY, 190);
  sunGlow.addColorStop(0, 'rgba(255, 239, 175, 0.95)');
  sunGlow.addColorStop(0.3, 'rgba(255, 192, 106, 0.34)');
  sunGlow.addColorStop(1, 'rgba(255, 167, 89, 0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(sunX - 200, sunY - 200, 400, 400);
  ctx.fillStyle = '#ffe9ad';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 46, 0, Math.PI * 2);
  ctx.fill();
  drawRidge(cam * 0.08, 505, 112, 'rgba(138, 74, 55, 0.28)');
  drawRidge(cam * 0.15 + 80, 566, 95, 'rgba(113, 61, 54, 0.44)');
  for (let index = 0; index < 8; index += 1) {
    const x = wrap(index * 227 - cam * 0.22, 2020) - 230;
    const base = 580 + (index % 3) * 17;
    const height = 90 + (index % 4) * 24;
    ctx.fillStyle = 'rgba(83, 50, 48, 0.42)';
    ctx.fillRect(x, base - height, 16, height);
    ctx.fillRect(x - 8, base - height - 8, 32, 8);
    ctx.fillRect(x - 5, base - height * 0.54, 26, 6);
    if (index % 2 === 0) {
      ctx.beginPath();
      ctx.moveTo(x - 13, base - height - 8);
      ctx.lineTo(x + 8, base - height - 30);
      ctx.lineTo(x + 29, base - height - 8);
      ctx.closePath();
      ctx.fill();
    }
  }
  const duneFront = ctx.createLinearGradient(0, 600, 0, VIEW_H);
  duneFront.addColorStop(0, 'rgba(232, 177, 92, 0.68)');
  duneFront.addColorStop(1, 'rgba(106, 63, 51, 0.58)');
  ctx.fillStyle = duneFront;
  ctx.beginPath();
  ctx.moveTo(0, 655);
  for (let x = 0; x <= VIEW_W; x += 42) {
    const y = 636 + Math.sin((x + cam * 0.3) * 0.006) * 17;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.lineTo(0, VIEW_H);
  ctx.closePath();
  ctx.fill();
  for (let index = 0; index < 24; index += 1) {
    const x = wrap(index * 151 + demoTime * (11 + index % 5) - cam * 0.3, 1580) - 110;
    const y = 240 + ((index * 73) % 390);
    ctx.fillStyle = `rgba(255, 225, 159, ${0.16 + (index % 3) * 0.09})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + (index % 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFungiBackground(cam) {
  const cave = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  cave.addColorStop(0, '#100b28');
  cave.addColorStop(0.45, '#2c1949');
  cave.addColorStop(0.78, '#3b2853');
  cave.addColorStop(1, '#18162c');
  ctx.fillStyle = cave;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const glowA = ctx.createRadialGradient(240, 540, 10, 240, 540, 260);
  glowA.addColorStop(0, 'rgba(89, 230, 188, 0.2)');
  glowA.addColorStop(1, 'rgba(42, 105, 136, 0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 280, 520, 440);
  const glowB = ctx.createRadialGradient(1040, 480, 10, 1040, 480, 280);
  glowB.addColorStop(0, 'rgba(211, 107, 255, 0.2)');
  glowB.addColorStop(1, 'rgba(109, 54, 151, 0)');
  ctx.fillStyle = glowB;
  ctx.fillRect(760, 220, 520, 500);
  drawRidge(cam * 0.08, 580, 94, 'rgba(18, 14, 40, 0.64)');
  for (let layer = 0; layer < 2; layer += 1) {
    const count = layer === 0 ? 6 : 4;
    for (let index = 0; index < count; index += 1) {
      const x = wrap(index * 287 + layer * 131 - cam * (0.16 + layer * 0.12), 1790) - 220;
      const base = 650;
      const scale = layer === 0 ? 0.62 : 1;
      const height = (74 + (index % 3) * 28) * scale;
      const capColor = layer === 0 ? 'rgba(88, 76, 145, 0.45)' : 'rgba(76, 185, 157, 0.62)';
      ctx.strokeStyle = layer === 0 ? 'rgba(87, 69, 120, 0.46)' : 'rgba(124, 191, 169, 0.5)';
      ctx.lineWidth = 8 * scale;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x + 8, base - height * 0.5, x + 4, base - height);
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = layer === 0 ? 'rgba(113, 96, 190, 0.3)' : 'rgba(106, 255, 207, 0.43)';
      ctx.shadowBlur = 18 * scale;
      const cap = ctx.createLinearGradient(x - 40 * scale, base - height, x + 40 * scale, base - height + 22 * scale);
      cap.addColorStop(0, layer === 0 ? '#69558d' : '#9cf4cd');
      cap.addColorStop(1, capColor);
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.ellipse(x + 4, base - height, 42 * scale, 17 * scale, 0, Math.PI, Math.PI * 2);
      ctx.quadraticCurveTo(x + 37 * scale, base - height + 8, x + 25 * scale, base - height + 11);
      ctx.lineTo(x - 19 * scale, base - height + 11);
      ctx.quadraticCurveTo(x - 34 * scale, base - height + 7, x - 38 * scale, base - height);
      ctx.fill();
      ctx.restore();
    }
  }
  for (let index = 0; index < 34; index += 1) {
    const x = wrap(index * 139 + Math.sin(demoTime * 0.9 + index) * 38 - cam * 0.25, 1560) - 120;
    const y = 210 - ((index * 57 + demoTime * (15 + index % 6)) % 500) + 450;
    const pulse = 0.2 + (Math.sin(demoTime * 2.4 + index * 1.3) * 0.5 + 0.5) * 0.68;
    ctx.fillStyle = index % 4 === 0 ? `rgba(255, 183, 245, ${pulse})` : `rgba(158, 255, 205, ${pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (index % 3) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStormBackground(cam) {
  const storm = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  storm.addColorStop(0, '#10182d');
  storm.addColorStop(0.42, '#263a4d');
  storm.addColorStop(0.76, '#536d72');
  storm.addColorStop(1, '#172b38');
  ctx.fillStyle = storm;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  for (let index = 0; index < 12; index += 1) {
    const x = wrap(index * 177 - cam * 0.08, 1900) - 280;
    const y = 100 + (index % 4) * 57;
    ctx.fillStyle = index % 3 === 0 ? 'rgba(115, 144, 157, 0.24)' : 'rgba(63, 82, 102, 0.34)';
    ctx.beginPath();
    ctx.ellipse(x + 60, y, 106, 24, -0.05, 0, Math.PI * 2);
    ctx.ellipse(x + 155, y + 11, 88, 20, 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
  const flashPhase = Math.max(0, Math.sin(demoTime * 1.65 - 1.2));
  const lightningAlpha = Math.pow(flashPhase, 18);
  if (lightningAlpha > 0.03) {
    ctx.save();
    ctx.strokeStyle = `rgba(196, 241, 255, ${lightningAlpha})`;
    ctx.shadowColor = '#9feaff';
    ctx.shadowBlur = 22;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(205, 0);
    ctx.lineTo(170, 92);
    ctx.lineTo(215, 126);
    ctx.lineTo(163, 235);
    ctx.lineTo(196, 264);
    ctx.lineTo(139, 372);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(213, 125);
    ctx.lineTo(261, 158);
    ctx.lineTo(241, 206);
    ctx.moveTo(196, 263);
    ctx.lineTo(151, 302);
    ctx.stroke();
    ctx.restore();
  }
  drawRidge(cam * 0.09, 570, 96, 'rgba(18, 34, 45, 0.58)');
  for (let index = 0; index < 7; index += 1) {
    const x = wrap(index * 247 - cam * 0.18, 1900) - 260;
    const base = 620;
    const height = 150 + (index % 4) * 53;
    ctx.fillStyle = 'rgba(10, 24, 34, 0.7)';
    ctx.fillRect(x, base - height, 44, height);
    ctx.beginPath();
    ctx.moveTo(x - 14, base - height);
    ctx.lineTo(x + 22, base - height - 45);
    ctx.lineTo(x + 58, base - height);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255, 198, 96, ${0.16 + (index % 2) * 0.11})`;
    for (let window = 0; window < 3; window += 1) {
      ctx.fillRect(x + 10, base - height + 28 + window * 35, 7, 13);
      ctx.fillRect(x + 27, base - height + 28 + window * 35, 7, 13);
    }
  }
  ctx.strokeStyle = 'rgba(176, 217, 226, 0.22)';
  ctx.lineWidth = 1.5;
  for (let rain = 0; rain < 52; rain += 1) {
    const x = wrap(rain * 77 - cam * 0.25 + demoTime * 70, 1440) - 80;
    const y = (rain * 59 + demoTime * 330) % 680;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 9, y + 26);
    ctx.stroke();
  }
  if (lightningAlpha > 0.05) {
    ctx.fillStyle = `rgba(174, 224, 245, ${lightningAlpha * 0.11})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function drawRuinsBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#090d27');
  sky.addColorStop(0.42, '#1e2453');
  sky.addColorStop(0.75, '#41416e');
  sky.addColorStop(1, '#7b6376');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawStarfield(cam, 74, 0.035);
  const nebula = ctx.createRadialGradient(780 - cam * 0.02, 190, 10, 780 - cam * 0.02, 190, 250);
  nebula.addColorStop(0, 'rgba(125, 105, 219, 0.19)');
  nebula.addColorStop(1, 'rgba(77, 68, 144, 0)');
  ctx.fillStyle = nebula;
  ctx.fillRect(500, 0, 560, 470);
  const moonX = 305 - cam * 0.02;
  ctx.fillStyle = 'rgba(240, 224, 199, 0.8)';
  ctx.beginPath();
  ctx.arc(moonX, 145, 36, 0, Math.PI * 2);
  ctx.fill();
  for (let index = 0; index < 8; index += 1) {
    const x = wrap(index * 211 - cam * 0.16, 1820) - 250;
    const y = 360 + (index % 3) * 48 + Math.sin(demoTime * 0.6 + index) * 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(index) * 0.18);
    ctx.fillStyle = 'rgba(74, 71, 100, 0.42)';
    ctx.beginPath();
    ctx.moveTo(-20, -17);
    ctx.lineTo(17, -27);
    ctx.lineTo(27, 8);
    ctx.lineTo(4, 24);
    ctx.lineTo(-24, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(162, 145, 208, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -10);
    ctx.lineTo(8, -5);
    ctx.lineTo(2, 9);
    ctx.stroke();
    ctx.restore();
  }
  for (let index = 0; index < 9; index += 1) {
    const x = wrap(index * 241 - cam * 0.26, 2200) - 300;
    const base = 620;
    const height = 115 + (index % 4) * 39;
    ctx.fillStyle = 'rgba(28, 29, 51, 0.72)';
    ctx.fillRect(x, base - height, 23, height);
    ctx.fillRect(x - 13, base - height - 12, 49, 12);
    if (index % 2 === 0) {
      ctx.fillRect(x - 31, base - height * 0.72, 87, 12);
    }
    ctx.strokeStyle = 'rgba(156, 141, 213, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 11, base - height * 0.52, 13, 0, Math.PI * 2);
    ctx.stroke();
  }
  const haze = ctx.createLinearGradient(0, 500, 0, VIEW_H);
  haze.addColorStop(0, 'rgba(133, 121, 170, 0)');
  haze.addColorStop(1, 'rgba(103, 89, 139, 0.16)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 480, VIEW_W, 240);
}

function drawMirrorBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#0a102d');
  sky.addColorStop(0.34, '#283c6d');
  sky.addColorStop(0.57, '#6475a0');
  sky.addColorStop(0.58, '#102f45');
  sky.addColorStop(1, '#071821');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawStarfield(cam, 58, 0.035);
  const ringX = 850 - cam * 0.02;
  const ringY = 162;
  ctx.save();
  ctx.strokeStyle = 'rgba(208, 238, 255, 0.56)';
  ctx.shadowColor = 'rgba(161, 229, 255, 0.54)';
  ctx.shadowBlur = 20;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(ringX, ringY, 55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(211, 240, 247, 0.2)';
  ctx.beginPath();
  ctx.arc(ringX, ringY, 48, 0, Math.PI * 2);
  ctx.fill();
  drawRidge(cam * 0.1, 500, 108, 'rgba(23, 43, 64, 0.5)');
  drawRidge(cam * 0.18 + 120, 535, 75, 'rgba(13, 33, 49, 0.62)');
  const lake = ctx.createLinearGradient(0, 420, 0, VIEW_H);
  lake.addColorStop(0, 'rgba(58, 91, 129, 0.3)');
  lake.addColorStop(0.55, 'rgba(18, 57, 78, 0.68)');
  lake.addColorStop(1, 'rgba(4, 19, 29, 0.96)');
  ctx.fillStyle = lake;
  ctx.beginPath();
  ctx.moveTo(0, 420);
  ctx.quadraticCurveTo(VIEW_W * 0.4, 412, VIEW_W, 424);
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.lineTo(0, VIEW_H);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.translate(0, 840);
  ctx.scale(1, -1);
  ctx.fillStyle = '#b5e9f1';
  ctx.beginPath();
  ctx.arc(ringX, ringY, 49, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  for (let index = 0; index < 18; index += 1) {
    const x = wrap(index * 133 - cam * 0.22, 1600) - 120;
    const y = 440 + ((index * 43) % 210);
    ctx.strokeStyle = `rgba(144, 230, 235, ${0.12 + (index % 3) * 0.06})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 40, y + Math.sin(demoTime + index) * 3, x + 92, y);
    ctx.stroke();
  }
  for (let index = 0; index < 7; index += 1) {
    const x = wrap(index * 257 - cam * 0.3, 1900) - 260;
    const y = 315 + (index % 3) * 54 + Math.sin(demoTime * 0.8 + index) * 7;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(index * 0.32 + demoTime * 0.16);
    ctx.fillStyle = 'rgba(152, 230, 243, 0.22)';
    ctx.strokeStyle = 'rgba(196, 249, 255, 0.52)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(12, 0);
    ctx.lineTo(0, 20);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawEmberBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#170814');
  sky.addColorStop(0.38, '#4b1920');
  sky.addColorStop(0.7, '#9d3a25');
  sky.addColorStop(1, '#281016');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const heat = ctx.createRadialGradient(660, 700, 20, 660, 700, 470);
  heat.addColorStop(0, 'rgba(255, 152, 66, 0.36)');
  heat.addColorStop(0.46, 'rgba(215, 66, 40, 0.16)');
  heat.addColorStop(1, 'rgba(120, 23, 36, 0)');
  ctx.fillStyle = heat;
  ctx.fillRect(150, 240, 1060, 480);
  drawRidge(cam * 0.09, 520, 135, 'rgba(53, 18, 28, 0.6)');
  drawRidge(cam * 0.17 + 80, 590, 88, 'rgba(28, 11, 20, 0.72)');
  for (let index = 0; index < 5; index += 1) {
    const x = wrap(index * 397 - cam * 0.2, 2100) - 320;
    ctx.fillStyle = 'rgba(24, 9, 17, 0.82)';
    ctx.beginPath();
    ctx.moveTo(x, 650);
    ctx.lineTo(x + 86, 370 + (index % 3) * 40);
    ctx.lineTo(x + 172, 650);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 105, 54, 0.4)';
    ctx.shadowColor = '#ff6437';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 86, 370 + (index % 3) * 40);
    ctx.lineTo(x + 65, 430);
    ctx.lineTo(x + 105, 457);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  const smoke = ctx.createLinearGradient(0, 330, 0, 620);
  smoke.addColorStop(0, 'rgba(98, 39, 43, 0)');
  smoke.addColorStop(1, 'rgba(135, 49, 38, 0.18)');
  ctx.fillStyle = smoke;
  ctx.fillRect(0, 300, VIEW_W, 340);
  for (let index = 0; index < 42; index += 1) {
    const x = wrap(index * 109 + Math.sin(demoTime * 0.8 + index) * 34 - cam * 0.28, 1510) - 100;
    const y = 620 - ((index * 67 + demoTime * (18 + index % 6)) % 530);
    ctx.fillStyle = index % 4 === 0 ? `rgba(255, 219, 112, ${0.3 + (index % 3) * 0.12})` : `rgba(255, 104, 58, ${0.2 + (index % 4) * 0.09})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (index % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  const lowerHeat = ctx.createLinearGradient(0, 610, 0, VIEW_H);
  lowerHeat.addColorStop(0, 'rgba(255, 103, 46, 0.22)');
  lowerHeat.addColorStop(1, 'rgba(102, 25, 26, 0.04)');
  ctx.fillStyle = lowerHeat;
  ctx.fillRect(0, 600, VIEW_W, 120);
}

function drawVoidBackground(cam) {
  const voidSky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  voidSky.addColorStop(0, '#05040f');
  voidSky.addColorStop(0.42, '#160e2e');
  voidSky.addColorStop(0.76, '#25133a');
  voidSky.addColorStop(1, '#07070f');
  ctx.fillStyle = voidSky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawStarfield(cam, 84, 0.025, '220, 208, 255');
  const nebulaA = ctx.createRadialGradient(310 - cam * 0.02, 200, 10, 310 - cam * 0.02, 200, 260);
  nebulaA.addColorStop(0, 'rgba(91, 51, 155, 0.24)');
  nebulaA.addColorStop(1, 'rgba(55, 27, 101, 0)');
  ctx.fillStyle = nebulaA;
  ctx.fillRect(0, 0, 600, 500);
  const nebulaB = ctx.createRadialGradient(980 - cam * 0.03, 340, 10, 980 - cam * 0.03, 340, 290);
  nebulaB.addColorStop(0, 'rgba(120, 44, 132, 0.18)');
  nebulaB.addColorStop(1, 'rgba(61, 22, 95, 0)');
  ctx.fillStyle = nebulaB;
  ctx.fillRect(670, 60, 610, 560);
  for (let ribbon = 0; ribbon < 4; ribbon += 1) {
    const x = wrap(ribbon * 431 - cam * 0.1, 1900) - 290;
    ctx.save();
    ctx.strokeStyle = `rgba(${ribbon % 2 === 0 ? '165, 119, 255' : '102, 194, 220'}, ${0.16 + ribbon * 0.035})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([11, 14]);
    ctx.beginPath();
    ctx.moveTo(x, 170 + ribbon * 39);
    ctx.bezierCurveTo(x + 260, 110 + ribbon * 28, x + 410, 250 - ribbon * 19, x + 690, 185 + ribbon * 31);
    ctx.stroke();
    ctx.restore();
  }
  for (let index = 0; index < 6; index += 1) {
    const x = wrap(index * 311 - cam * 0.17, 1920) - 260;
    const y = 345 + (index % 3) * 49 + Math.sin(demoTime * 0.5 + index) * 10;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(157, 112, 229, 0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 38, 0, Math.PI * 2);
    ctx.stroke();
    for (let rune = 0; rune < 4; rune += 1) {
      const angle = (rune / 4) * Math.PI * 2 + demoTime * 0.26;
      ctx.fillStyle = 'rgba(203, 159, 255, 0.38)';
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * 47, Math.sin(angle) * 47, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  drawRidge(cam * 0.13, 610, 90, 'rgba(7, 6, 18, 0.85)');
  for (let index = 0; index < 34; index += 1) {
    const x = wrap(index * 121 + Math.sin(demoTime * 0.6 + index) * 30 - cam * 0.21, 1510) - 110;
    const y = 140 + ((index * 61) % 420);
    const pulse = 0.15 + (Math.sin(demoTime * 2 + index) * 0.5 + 0.5) * 0.58;
    ctx.fillStyle = `rgba(198, 153, 255, ${pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (index % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCelestialBackground(cam) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#2a2a65');
  sky.addColorStop(0.3, '#7f6e9e');
  sky.addColorStop(0.58, '#e8b68e');
  sky.addColorStop(0.8, '#f7dfaf');
  sky.addColorStop(1, '#d5bd96');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const sunX = 930 - cam * 0.015;
  const sunY = 172;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let ray = 0; ray < 14; ray += 1) {
    const angle = (ray / 14) * Math.PI * 2 + demoTime * 0.025;
    const rayGradient = ctx.createLinearGradient(sunX, sunY, sunX + Math.cos(angle) * 420, sunY + Math.sin(angle) * 420);
    rayGradient.addColorStop(0, 'rgba(255, 242, 183, 0.22)');
    rayGradient.addColorStop(1, 'rgba(255, 224, 157, 0)');
    ctx.strokeStyle = rayGradient;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(sunX, sunY);
    ctx.lineTo(sunX + Math.cos(angle) * 460, sunY + Math.sin(angle) * 460);
    ctx.stroke();
  }
  ctx.restore();
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 180);
  sunGlow.addColorStop(0, 'rgba(255, 252, 210, 0.98)');
  sunGlow.addColorStop(0.3, 'rgba(255, 225, 147, 0.48)');
  sunGlow.addColorStop(1, 'rgba(255, 208, 123, 0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(sunX - 190, sunY - 190, 380, 380);
  ctx.fillStyle = '#fff8d0';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 43, 0, Math.PI * 2);
  ctx.fill();
  for (let index = 0; index < 8; index += 1) {
    const x = wrap(index * 263 - cam * 0.09, 1950) - 290;
    drawCloudShape(x, 260 + (index % 3) * 62, 0.72, 0.22);
  }
  for (let index = 0; index < 6; index += 1) {
    const x = wrap(index * 313 - cam * 0.19, 2000) - 290;
    const y = 430 + (index % 3) * 48;
    ctx.fillStyle = 'rgba(67, 57, 91, 0.38)';
    ctx.fillRect(x, y - 66, 12, 92);
    ctx.fillRect(x + 98, y - 66, 12, 92);
    ctx.fillRect(x - 12, y - 76, 134, 12);
    ctx.beginPath();
    ctx.moveTo(x - 30, y - 76);
    ctx.lineTo(x + 54, y - 126);
    ctx.lineTo(x + 140, y - 76);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 226, 159, 0.24)';
    ctx.beginPath();
    ctx.arc(x + 54, y - 51, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  const cloudSea = ctx.createLinearGradient(0, 560, 0, VIEW_H);
  cloudSea.addColorStop(0, 'rgba(255, 243, 213, 0)');
  cloudSea.addColorStop(1, 'rgba(255, 239, 206, 0.23)');
  ctx.fillStyle = cloudSea;
  ctx.fillRect(0, 520, VIEW_W, 210);
  for (let index = 0; index < 8; index += 1) {
    const x = wrap(index * 257 - cam * 0.34 + Math.sin(demoTime * 0.3 + index) * 18, 1900) - 300;
    drawCloudShape(x, 580 + (index % 3) * 39, 1.2, 0.18 + (index % 2) * 0.08);
  }
  for (let index = 0; index < 34; index += 1) {
    const x = wrap(index * 137 + Math.sin(demoTime * 0.8 + index) * 35 - cam * 0.25, 1530) - 110;
    const y = 200 + ((index * 53) % 380);
    const pulse = 0.2 + (Math.sin(demoTime * 2.3 + index) * 0.5 + 0.5) * 0.7;
    ctx.fillStyle = `rgba(255, 231, 150, ${pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.1 + (index % 3) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBackground(theme, cam) {
  if (theme === 'cave') drawCaveBackground(cam);
  else if (theme === 'sky') drawSkyBackground(cam);
  else if (theme === 'bamboo') drawBambooBackground(cam);
  else if (theme === 'frost') drawFrostBackground(cam);
  else if (theme === 'desert') drawDesertBackground(cam);
  else if (theme === 'fungi') drawFungiBackground(cam);
  else if (theme === 'storm') drawStormBackground(cam);
  else if (theme === 'ruins') drawRuinsBackground(cam);
  else if (theme === 'mirror') drawMirrorBackground(cam);
  else if (theme === 'ember') drawEmberBackground(cam);
  else if (theme === 'void') drawVoidBackground(cam);
  else if (theme === 'celestial') drawCelestialBackground(cam);
  else drawForestBackground(cam);
}

function drawPlatform(platform) {
  const x = platform.x;
  const y = platform.y;
  const w = platform.w;
  const h = platform.h;
  if (platform.type === 'wood') {
    ctx.fillStyle = 'rgba(37, 25, 23, 0.36)';
    roundRectPath(x + 3, y + 7, w, h, 9);
    ctx.fill();
    ctx.fillStyle = '#5b3829';
    roundRectPath(x, y, w, h, 8);
    ctx.fill();
    ctx.fillStyle = '#98613a';
    roundRectPath(x + 3, y + 2, w - 6, Math.max(7, h - 6), 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(67, 40, 27, 0.68)';
    ctx.lineWidth = 2;
    for (let plank = x + 34; plank < x + w - 12; plank += 44) {
      ctx.beginPath();
      ctx.moveTo(plank, y + 5);
      ctx.lineTo(plank - 2, y + h - 3);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(113, 184, 95, 0.78)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 3);
    ctx.quadraticCurveTo(x + w * 0.42, y - 4, x + w - 8, y + 4);
    ctx.stroke();
    for (let vine = x + 28; vine < x + w; vine += 58) {
      ctx.strokeStyle = 'rgba(100, 164, 92, 0.52)';
      ctx.beginPath();
      ctx.moveTo(vine, y + h - 2);
      ctx.quadraticCurveTo(vine + 8, y + h + 12, vine - 2, y + h + 23);
      ctx.stroke();
    }
  } else if (platform.type === 'stone') {
    ctx.fillStyle = 'rgba(15, 9, 18, 0.46)';
    roundRectPath(x + 3, y + 7, w, h, 7);
    ctx.fill();
    ctx.fillStyle = '#322b35';
    roundRectPath(x, y, w, h, 7);
    ctx.fill();
    const stoneTop = ctx.createLinearGradient(x, y, x, y + h);
    stoneTop.addColorStop(0, '#805448');
    stoneTop.addColorStop(1, '#4b3334');
    ctx.fillStyle = stoneTop;
    roundRectPath(x + 3, y + 2, w - 6, h - 6, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 151, 92, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 3);
    ctx.lineTo(x + w - 7, y + 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(31, 20, 28, 0.5)';
    for (let crack = x + 30; crack < x + w - 15; crack += 46) {
      ctx.beginPath();
      ctx.moveTo(crack, y + 8);
      ctx.lineTo(crack + 5, y + h * 0.55);
      ctx.lineTo(crack - 4, y + h - 4);
      ctx.stroke();
    }
  } else if (platform.type === 'ice') {
    ctx.fillStyle = 'rgba(17, 31, 51, 0.34)';
    roundRectPath(x + 4, y + 7, w, h, 10);
    ctx.fill();
    const iceEarth = ctx.createLinearGradient(x, y, x, y + h);
    iceEarth.addColorStop(0, '#9ee6ee');
    iceEarth.addColorStop(0.18, '#5ba9c9');
    iceEarth.addColorStop(0.56, '#2c557d');
    iceEarth.addColorStop(1, '#17243f');
    ctx.fillStyle = iceEarth;
    roundRectPath(x, y, w, h, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    for (let facet = x + 18; facet < x + w - 12; facet += 54) {
      ctx.beginPath();
      ctx.moveTo(facet, y + 8);
      ctx.lineTo(facet + 24, y + 8);
      ctx.lineTo(facet + 9, y + Math.min(h - 4, 54));
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(215, 251, 255, 0.68)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 1);
    ctx.lineTo(x + w - 10, y + 1);
    ctx.stroke();
    ctx.fillStyle = '#e7fbff';
    for (let snow = x + 13; snow < x + w - 6; snow += 34) {
      ctx.beginPath();
      ctx.ellipse(snow, y - 1, 17, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(198, 247, 255, 0.38)';
    ctx.lineWidth = 1.5;
    for (let crack = x + 34; crack < x + w - 15; crack += 61) {
      ctx.beginPath();
      ctx.moveTo(crack, y + 9);
      ctx.lineTo(crack + 8, y + 27);
      ctx.lineTo(crack + 1, y + 47);
      ctx.stroke();
    }
  } else if (platform.type === 'sand') {
    ctx.fillStyle = 'rgba(50, 31, 22, 0.32)';
    roundRectPath(x + 4, y + 7, w, h, 12);
    ctx.fill();
    const dune = ctx.createLinearGradient(x, y, x, y + h);
    dune.addColorStop(0, '#f3c674');
    dune.addColorStop(0.18, '#ce9150');
    dune.addColorStop(0.58, '#855338');
    dune.addColorStop(1, '#3b2925');
    ctx.fillStyle = dune;
    roundRectPath(x, y, w, h, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 231, 165, 0.52)';
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 16);
    for (let crest = x + 24; crest < x + w - 8; crest += 36) {
      ctx.quadraticCurveTo(crest - 8, y + 2, crest + 10, y + 8);
      ctx.quadraticCurveTo(crest + 22, y + 13, crest + 35, y + 8);
    }
    ctx.lineTo(x + w - 4, y + 20);
    ctx.lineTo(x + 4, y + 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 221, 137, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 2);
    ctx.quadraticCurveTo(x + w * 0.45, y - 3, x + w - 9, y + 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(95, 59, 37, 0.46)';
    for (let grain = x + 23; grain < x + w - 12; grain += 39) {
      ctx.beginPath();
      ctx.arc(grain + (grain % 5), y + 28 + (grain % 19), 1.3 + (grain % 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(109, 68, 43, 0.5)';
    ctx.lineWidth = 2;
    for (let layer = x + 21; layer < x + w - 14; layer += 57) {
      ctx.beginPath();
      ctx.moveTo(layer, y + 14);
      ctx.quadraticCurveTo(layer + 20, y + 31, layer + 4, y + 51);
      ctx.stroke();
    }
  } else if (platform.type === 'obsidian') {
    ctx.fillStyle = 'rgba(5, 3, 10, 0.5)';
    roundRectPath(x + 4, y + 7, w, h, 11);
    ctx.fill();
    const obsidian = ctx.createLinearGradient(x, y, x, y + h);
    obsidian.addColorStop(0, '#3c2b3f');
    obsidian.addColorStop(0.22, '#211c2b');
    obsidian.addColorStop(0.72, '#121019');
    obsidian.addColorStop(1, '#08070e');
    ctx.fillStyle = obsidian;
    roundRectPath(x, y, w, h, 10);
    ctx.fill();
    const obsidianTop = ctx.createLinearGradient(x, y - 2, x, y + 15);
    obsidianTop.addColorStop(0, '#b25c55');
    obsidianTop.addColorStop(1, '#4b2b36');
    ctx.fillStyle = obsidianTop;
    roundRectPath(x, y - 2, w, 15, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 214, 171, 0.35)';
    for (let glint = x + 15; glint < x + w - 10; glint += 47) {
      ctx.beginPath();
      ctx.moveTo(glint, y + 2);
      ctx.lineTo(glint + 25, y + 1);
      ctx.lineTo(glint + 15, y + 4);
      ctx.closePath();
      ctx.fill();
    }
    for (let fissure = x + 35; fissure < x + w - 16; fissure += 69) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 111, 76, 0.5)';
      ctx.shadowColor = '#ff633f';
      ctx.shadowBlur = 9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fissure, y + 9);
      ctx.lineTo(fissure + 9, y + 28);
      ctx.lineTo(fissure - 1, y + 48);
      ctx.lineTo(fissure + 10, y + 70);
      ctx.stroke();
      ctx.restore();
    }
  } else if (platform.type === 'cloud') {
    ctx.save();
    ctx.shadowColor = 'rgba(255, 224, 184, 0.25)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(244, 221, 213, 0.68)';
    roundRectPath(x + 3, y + 5, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = '#f7e6d8';
    roundRectPath(x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 250, 238, 0.82)';
    for (let puff = x + 18; puff < x + w - 10; puff += 30) {
      ctx.beginPath();
      ctx.arc(puff, y + 5, 9 + (puff % 4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (level && level.theme === 'cave') {
    ctx.fillStyle = 'rgba(12, 7, 14, 0.42)';
    roundRectPath(x + 4, y + 7, w, h, 12);
    ctx.fill();
    const caveEarth = ctx.createLinearGradient(x, y, x, y + h);
    caveEarth.addColorStop(0, '#5a3830');
    caveEarth.addColorStop(0.28, '#392522');
    caveEarth.addColorStop(1, '#181116');
    ctx.fillStyle = caveEarth;
    roundRectPath(x, y, w, h, 11);
    ctx.fill();
    const crust = ctx.createLinearGradient(x, y - 2, x, y + 18);
    crust.addColorStop(0, '#c47755');
    crust.addColorStop(1, '#6e4036');
    ctx.fillStyle = crust;
    roundRectPath(x, y - 2, w, 18, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 179, 111, 0.74)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 1);
    ctx.lineTo(x + w - 10, y + 1);
    ctx.stroke();
    for (let crack = x + 32; crack < x + w - 16; crack += 58) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 138, 82, 0.44)';
      ctx.shadowColor = '#ff7a45';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(crack, y + 5);
      ctx.lineTo(crack + 7, y + 27);
      ctx.lineTo(crack - 2, y + 48);
      ctx.lineTo(crack + 9, y + 72);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    ctx.fillStyle = 'rgba(31, 25, 23, 0.34)';
    roundRectPath(x + 4, y + 7, w, h, 12);
    ctx.fill();
    const earth = ctx.createLinearGradient(x, y, x, y + h);
    earth.addColorStop(0, '#385d40');
    earth.addColorStop(0.3, '#29442f');
    earth.addColorStop(1, '#241e1d');
    ctx.fillStyle = earth;
    roundRectPath(x, y, w, h, 11);
    ctx.fill();
    const grass = ctx.createLinearGradient(x, y, x, y + 18);
    grass.addColorStop(0, '#84d36a');
    grass.addColorStop(1, '#3e8c4e');
    ctx.fillStyle = grass;
    roundRectPath(x, y - 2, w, 18, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(222, 246, 147, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 1);
    ctx.lineTo(x + w - 10, y + 1);
    ctx.stroke();
    for (let blade = x + 20; blade < x + w - 12; blade += 42) {
      ctx.strokeStyle = blade % 3 === 0 ? '#bfe878' : '#63b85d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(blade, y);
      ctx.quadraticCurveTo(blade - 5, y - 8, blade - 10, y - 6);
      ctx.moveTo(blade + 8, y);
      ctx.quadraticCurveTo(blade + 12, y - 10, blade + 17, y - 8);
      ctx.stroke();
    }
  }
}

function drawHazard(hazard) {
  if (hazard.type === 'sand') {
    const sand = ctx.createLinearGradient(hazard.x, hazard.y - 12, hazard.x, hazard.y + hazard.h);
    sand.addColorStop(0, '#f4c46d');
    sand.addColorStop(0.22, '#b7793c');
    sand.addColorStop(0.62, '#67412d');
    sand.addColorStop(1, '#211a20');
    ctx.save();
    ctx.fillStyle = sand;
    ctx.beginPath();
    ctx.moveTo(hazard.x - 8, hazard.y + 9);
    for (let x = 0; x <= hazard.w; x += 12) {
      const y = hazard.y + Math.sin(worldTime * 1.8 + (hazard.x + x) * 0.045) * 4;
      ctx.lineTo(hazard.x + x, y);
    }
    ctx.lineTo(hazard.x + hazard.w + 8, hazard.y + hazard.h);
    ctx.lineTo(hazard.x - 8, hazard.y + hazard.h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 231, 159, 0.66)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= hazard.w; x += 12) {
      const y = hazard.y + Math.sin(worldTime * 1.8 + (hazard.x + x) * 0.045) * 4;
      if (x === 0) ctx.moveTo(hazard.x + x, y);
      else ctx.lineTo(hazard.x + x, y);
    }
    ctx.stroke();
    for (let grain = 0; grain < 9; grain += 1) {
      const gx = hazard.x + wrap(grain * 37 + worldTime * (12 + grain), hazard.w);
      const gy = hazard.y + 18 + ((grain * 17 + worldTime * 9) % Math.max(12, hazard.h - 20));
      ctx.fillStyle = `rgba(255, 213, 124, ${0.24 + (grain % 3) * 0.12})`;
      ctx.beginPath();
      ctx.arc(gx, gy, 1.5 + (grain % 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (hazard.type === 'abyss') {
    const voidGradient = ctx.createLinearGradient(hazard.x, hazard.y - 16, hazard.x, hazard.y + hazard.h);
    voidGradient.addColorStop(0, '#56417d');
    voidGradient.addColorStop(0.18, '#211b42');
    voidGradient.addColorStop(0.7, '#070916');
    voidGradient.addColorStop(1, '#02030a');
    ctx.save();
    ctx.fillStyle = voidGradient;
    ctx.beginPath();
    ctx.moveTo(hazard.x, hazard.y);
    for (let x = 0; x <= hazard.w; x += 20) {
      ctx.lineTo(hazard.x + x, hazard.y + Math.sin(worldTime * 0.9 + x * 0.035) * 3);
    }
    ctx.lineTo(hazard.x + hazard.w, hazard.y + hazard.h);
    ctx.lineTo(hazard.x, hazard.y + hazard.h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(165, 129, 255, 0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hazard.x, hazard.y + 1);
    ctx.quadraticCurveTo(hazard.x + hazard.w * 0.5, hazard.y - 8, hazard.x + hazard.w, hazard.y + 1);
    ctx.stroke();
    for (let star = 0; star < 8; star += 1) {
      const sx = hazard.x + wrap(star * 29 + Math.sin(worldTime + star) * 7, hazard.w);
      const sy = hazard.y + 18 + ((star * 23 + worldTime * 2) % Math.max(16, hazard.h - 20));
      const twinkle = 0.35 + (Math.sin(worldTime * 3 + star * 1.7) * 0.5 + 0.5) * 0.55;
      ctx.fillStyle = `rgba(208, 190, 255, ${twinkle})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.3 + (star % 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (hazard.type === 'lava') {
    const lava = ctx.createLinearGradient(hazard.x, hazard.y, hazard.x, hazard.y + hazard.h);
    lava.addColorStop(0, '#ffdf76');
    lava.addColorStop(0.22, '#ff7b35');
    lava.addColorStop(1, '#b3252e');
    ctx.save();
    ctx.shadowColor = 'rgba(255, 105, 38, 0.7)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = lava;
    ctx.beginPath();
    ctx.moveTo(hazard.x, hazard.y + 7);
    for (let x = 0; x <= hazard.w; x += 16) {
      const y = hazard.y + Math.sin(worldTime * 2.2 + (hazard.x + x) * 0.035) * 5;
      ctx.lineTo(hazard.x + x, y);
    }
    ctx.lineTo(hazard.x + hazard.w, hazard.y + hazard.h);
    ctx.lineTo(hazard.x, hazard.y + hazard.h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 237, 161, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= hazard.w; x += 16) {
      const y = hazard.y + Math.sin(worldTime * 2.2 + (hazard.x + x) * 0.035) * 5;
      if (x === 0) ctx.moveTo(hazard.x + x, y);
      else ctx.lineTo(hazard.x + x, y);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  const count = Math.floor(hazard.w / 22);
  const step = hazard.w / Math.max(1, count);
  ctx.fillStyle = hazard.type === 'spike' ? '#d9b26e' : '#584329';
  ctx.strokeStyle = hazard.type === 'spike' ? '#77552e' : '#2f3826';
  ctx.lineWidth = 2;
  for (let index = 0; index < count; index += 1) {
    const x = hazard.x + index * step;
    ctx.beginPath();
    ctx.moveTo(x + 2, hazard.y + hazard.h);
    ctx.lineTo(x + step / 2, hazard.y);
    ctx.lineTo(x + step - 2, hazard.y + hazard.h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawCheckpoint() {
  if (!checkpoint) return;
  const x = checkpoint.x;
  const y = checkpoint.y;
  ctx.strokeStyle = '#4e3228';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x, y - 62);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = '#342018';
  roundRectPath(x - 8, y - 5, 16, 8, 3);
  ctx.fill();
  const glow = checkpoint.active ? 1 : 0.3;
  ctx.save();
  ctx.shadowColor = `rgba(255, 210, 105, ${0.55 + glow * 0.4})`;
  ctx.shadowBlur = checkpoint.active ? 28 : 10;
  ctx.fillStyle = checkpoint.active ? '#ffd56b' : '#7b6040';
  roundRectPath(x - 19, y - 91, 38, 29, 8);
  ctx.fill();
  ctx.strokeStyle = '#5c3a2a';
  ctx.lineWidth = 3;
  roundRectPath(x - 19, y - 91, 38, 29, 8);
  ctx.stroke();
  ctx.fillStyle = checkpoint.active ? '#fff5bd' : '#b99561';
  ctx.beginPath();
  ctx.arc(x, y - 77, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (checkpoint.active) {
    ctx.strokeStyle = 'rgba(255, 223, 130, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 76, 26 + Math.sin(worldTime * 2.4) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawGate() {
  if (!gate || gate.bossTriggered) return;
  const x = gate.x;
  const y = gate.y;
  const w = gate.w;
  const h = gate.h;
  const color = gate.bossGate ? '#b59aff' : '#6de7d0';
  ctx.save();
  ctx.fillStyle = 'rgba(27, 22, 38, 0.82)';
  roundRectPath(x - 11, y - 12, w + 22, h + 12, 20);
  ctx.fill();
  const portal = ctx.createRadialGradient(x + w / 2, y + h * 0.48, 4, x + w / 2, y + h * 0.48, w * 0.7);
  if (gate.open) {
    portal.addColorStop(0, 'rgba(255, 248, 197, 0.94)');
    portal.addColorStop(0.22, gate.bossGate ? 'rgba(188, 148, 255, 0.74)' : 'rgba(103, 239, 208, 0.66)');
    portal.addColorStop(1, 'rgba(37, 47, 76, 0)');
  } else {
    portal.addColorStop(0, 'rgba(93, 84, 109, 0.2)');
    portal.addColorStop(1, 'rgba(25, 24, 42, 0)');
  }
  ctx.fillStyle = portal;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h * 0.46, w * 0.66, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = gate.open ? color : 'rgba(154, 142, 161, 0.5)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h * 0.5, w * 0.37, Math.PI * 0.62, Math.PI * 2.38);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h * 0.5, w * 0.5, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  ctx.fillStyle = gate.open ? '#ffeeb0' : '#6e6376';
  drawStarShape(x + w / 2, y + h * 0.47, gate.open ? 17 : 11, gate.open ? 7 : 4, 5);
  ctx.fill();
  if (gate.open) {
    ctx.globalAlpha = 0.5 + Math.sin(worldTime * 3) * 0.18;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.47, 36 + Math.sin(worldTime * 1.8) * 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStarShape(cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawShards() {
  for (const shard of shards) {
    if (shard.collected) continue;
    const bob = Math.sin(worldTime * 2.2 + shard.phase) * 7;
    const cx = shard.x + shard.w / 2;
    const cy = shard.y + shard.h / 2 + bob;
    ctx.save();
    ctx.translate(cx, cy);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    glow.addColorStop(0, 'rgba(255, 244, 177, 0.9)');
    glow.addColorStop(0.35, 'rgba(255, 207, 91, 0.35)');
    glow.addColorStop(1, 'rgba(255, 195, 61, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(worldTime * 0.7 + shard.phase);
    ctx.fillStyle = '#ffea8c';
    drawStarShape(0, 0, 16, 5.5, 4);
    ctx.fill();
    ctx.fillStyle = '#fffbe2';
    drawStarShape(0, 0, 8, 2.5, 4);
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemy(enemy) {
  if (!enemy.alive) return;
  const cx = enemy.x + enemy.w / 2;
  const bottom = enemy.y + enemy.h;
  const flash = enemy.hitFlash > 0;
  ctx.save();
  ctx.translate(cx, bottom);

  if (enemy.type === 'mushroom') {
    const bob = Math.sin(worldTime * 3.1 + enemy.phase) * 1.8;
    ctx.fillStyle = 'rgba(32, 21, 22, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 24, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(enemy.direction, 1);
    ctx.translate(0, bob);
    ctx.fillStyle = flash ? '#fff5e3' : '#f3d7a6';
    roundRectPath(-13, -26, 26, 26, 10);
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : '#cf5c47';
    ctx.beginPath();
    ctx.arc(0, -31, 24, Math.PI, Math.PI * 2);
    ctx.quadraticCurveTo(26, -22, 22, -22);
    ctx.lineTo(-22, -22);
    ctx.quadraticCurveTo(-26, -22, -24, -31);
    ctx.fill();
    ctx.fillStyle = '#f7e4b6';
    [[-11, -37, 4], [7, -41, 3], [15, -29, 3.5]].forEach((spot) => {
      ctx.beginPath();
      ctx.arc(spot[0], spot[1], spot[2], 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#392434';
    ctx.beginPath();
    ctx.arc(5, -19, 2.4, 0, Math.PI * 2);
    ctx.arc(-3, -19, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (enemy.type === 'moth') {
    const flap = Math.sin(worldTime * 9 + enemy.phase);
    ctx.fillStyle = 'rgba(30, 22, 26, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 19, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff9e6' : 'rgba(244, 203, 144, 0.74)';
    ctx.beginPath();
    ctx.ellipse(-17, -23 + flap * 5, 17, 9, -0.55, 0, Math.PI * 2);
    ctx.ellipse(17, -23 - flap * 5, 17, 9, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : '#a781d8';
    ctx.beginPath();
    ctx.ellipse(0, -19, 7, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe59a';
    ctx.beginPath();
    ctx.arc(-3, -26, 2, 0, Math.PI * 2);
    ctx.arc(3, -26, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (enemy.type === 'beetle') {
    ctx.fillStyle = 'rgba(23, 14, 17, 0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 3, 29, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(enemy.direction, 1);
    ctx.strokeStyle = '#22151d';
    ctx.lineWidth = 3;
    for (let leg = -1; leg <= 1; leg += 1) {
      ctx.beginPath();
      ctx.moveTo(leg * 10, -10);
      ctx.lineTo(leg * 16, 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(255, 151, 98, 0.28)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = flash ? '#ffffff' : '#6f4b63';
    ctx.beginPath();
    ctx.ellipse(0, -19, 27, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = flash ? '#fff1c9' : '#f0a06d';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -36);
    ctx.lineTo(0, -5);
    ctx.stroke();
    ctx.fillStyle = '#ffd57e';
    ctx.beginPath();
    ctx.arc(17, -24, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2c202f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(26, -20);
    ctx.quadraticCurveTo(36, -30, 24, -34);
    ctx.stroke();
  } else if (enemy.type === 'spirit') {
    const pulse = 0.88 + Math.sin(worldTime * 5 + enemy.phase) * 0.09;
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.shadowColor = flash ? '#fff7d9' : '#ff7d52';
    ctx.shadowBlur = flash ? 30 : 20;
    ctx.fillStyle = flash ? '#ffffff' : '#ff9c5d';
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.bezierCurveTo(-21, -2, -20, -29, -6, -43);
    ctx.quadraticCurveTo(0, -52, 7, -40);
    ctx.bezierCurveTo(24, -26, 20, -3, 0, 3);
    ctx.fill();
    ctx.fillStyle = '#fff1ac';
    ctx.beginPath();
    ctx.arc(-5, -29, 2.6, 0, Math.PI * 2);
    ctx.arc(5, -29, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (enemy.type === 'wisp') {
    const drift = Math.sin(worldTime * 4 + enemy.phase) * 2;
    ctx.translate(0, drift);
    ctx.shadowColor = flash ? '#fff6df' : '#8b6ce3';
    ctx.shadowBlur = 18;
    ctx.fillStyle = flash ? '#ffffff' : '#5c467f';
    ctx.beginPath();
    ctx.arc(0, -29, 20, Math.PI, Math.PI * 2);
    ctx.quadraticCurveTo(22, -8, 13, 2);
    ctx.quadraticCurveTo(6, -9, 1, 4);
    ctx.quadraticCurveTo(-8, -9, -14, 2);
    ctx.quadraticCurveTo(-23, -10, -20, -29);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd66b';
    ctx.beginPath();
    ctx.arc(-7, -32, 2.6, 0, Math.PI * 2);
    ctx.arc(7, -32, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(28, 17, 48, 0.78)';
    ctx.beginPath();
    ctx.ellipse(0, -21, 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (enemy.type === 'slime') {
    const hop = enemy.onGround ? 0 : Math.max(0, 1 - Math.abs(enemy.vy) / 330);
    const wobble = Math.sin(worldTime * 6 + enemy.phase) * 2;
    ctx.fillStyle = 'rgba(22, 34, 31, 0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 23 + hop * 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(enemy.direction, 1);
    const slimeBody = ctx.createRadialGradient(-9, -28, 2, 0, -17, 27);
    slimeBody.addColorStop(0, flash ? '#ffffff' : '#baf58b');
    slimeBody.addColorStop(0.48, flash ? '#fff4de' : '#66c875');
    slimeBody.addColorStop(1, flash ? '#ffffff' : '#2b7f65');
    ctx.fillStyle = slimeBody;
    ctx.beginPath();
    ctx.moveTo(-24, -2);
    ctx.bezierCurveTo(-28, -28, -15, -36 - wobble, 0, -36 - wobble);
    ctx.bezierCurveTo(17, -36 - wobble, 28, -26, 24, -2);
    ctx.quadraticCurveTo(0, 7, -24, -2);
    ctx.fill();
    ctx.fillStyle = 'rgba(232, 255, 207, 0.7)';
    ctx.beginPath();
    ctx.ellipse(-9, -28, 5, 3.5, -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#173b37';
    ctx.beginPath();
    ctx.ellipse(5, -19, 3.1, 4.1, 0, 0, Math.PI * 2);
    ctx.ellipse(15, -18, 2.6, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(6, -20, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#28624f';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(9, -11, 4, 0.15, Math.PI - 0.2);
    ctx.stroke();
  } else if (enemy.type === 'hornet') {
    const flap = Math.sin(worldTime * 20 + enemy.phase);
    if (enemy.diveWindup > 0) {
      ctx.strokeStyle = `rgba(255, 207, 90, ${0.3 + (1 - enemy.diveWindup / 0.34) * 0.55})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, -19, 28 + flap * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.scale(enemy.direction, 1);
    ctx.fillStyle = flash ? '#fff7df' : 'rgba(211, 245, 255, 0.62)';
    ctx.beginPath();
    ctx.ellipse(-8, -28, 12, 5, -0.62 - flap * 0.18, 0, Math.PI * 2);
    ctx.ellipse(9, -28, 12, 5, 0.62 + flap * 0.18, 0, Math.PI * 2);
    ctx.fill();
    const hornetBody = ctx.createLinearGradient(-10, -34, 10, -8);
    hornetBody.addColorStop(0, flash ? '#ffffff' : '#ffe477');
    hornetBody.addColorStop(1, flash ? '#ffffff' : '#d8862e');
    ctx.fillStyle = hornetBody;
    ctx.beginPath();
    ctx.ellipse(0, -19, 10, 16, 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4b2a27';
    ctx.lineWidth = 3;
    for (let stripe = -1; stripe <= 1; stripe += 1) {
      ctx.beginPath();
      ctx.moveTo(-8, -16 + stripe * 6);
      ctx.lineTo(8, -19 + stripe * 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#432737';
    ctx.beginPath();
    ctx.arc(4, -34, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff0a2';
    ctx.beginPath();
    ctx.ellipse(7, -35, 2.8, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4d2b2c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(2, -40);
    ctx.quadraticCurveTo(-7, -48, -13, -47);
    ctx.moveTo(6, -40);
    ctx.quadraticCurveTo(12, -48, 18, -46);
    ctx.stroke();
    ctx.fillStyle = '#5a3440';
    ctx.beginPath();
    ctx.moveTo(-9, -14);
    ctx.lineTo(-22, -8);
    ctx.lineTo(-9, -7);
    ctx.fill();
  } else if (enemy.type === 'cultist') {
    const castPulse = enemy.castWindup > 0 ? 1 - enemy.castWindup / 0.56 : 0.2 + Math.sin(worldTime * 3) * 0.12;
    ctx.fillStyle = 'rgba(19, 13, 31, 0.34)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 21, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(enemy.direction, 1);
    ctx.strokeStyle = '#382445';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(15, -33);
    ctx.lineTo(21, 0);
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = '#d477ff';
    ctx.shadowBlur = 12 + castPulse * 12;
    ctx.fillStyle = flash ? '#ffffff' : `rgba(195, 113, 255, ${0.55 + castPulse * 0.4})`;
    ctx.beginPath();
    ctx.arc(18, -37, 5 + castPulse * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const robe = ctx.createLinearGradient(-16, -55, 12, 0);
    robe.addColorStop(0, flash ? '#ffffff' : '#77568c');
    robe.addColorStop(0.55, flash ? '#fff5ea' : '#422d56');
    robe.addColorStop(1, '#24182e');
    ctx.fillStyle = robe;
    ctx.beginPath();
    ctx.moveTo(-7, -51);
    ctx.quadraticCurveTo(-19, -30, -20, -2);
    ctx.quadraticCurveTo(0, 7, 20, -2);
    ctx.quadraticCurveTo(15, -32, 7, -51);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b1a35';
    ctx.beginPath();
    ctx.arc(1, -50, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : '#ead6dd';
    ctx.beginPath();
    ctx.ellipse(2, -47, 8, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a3c70';
    ctx.beginPath();
    ctx.arc(-1, -48, 1.8, 0, Math.PI * 2);
    ctx.arc(5, -48, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#633b72';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-13, -34);
    ctx.lineTo(14, -31);
    ctx.stroke();
    ctx.fillStyle = '#9d6ab0';
    ctx.beginPath();
    drawStarShape(0, -34, 3.4, 1.5, 4);
    ctx.fill();
  } else if (enemy.type === 'scarab') {
    const chargeGlow = enemy.chargeWindup > 0 || enemy.chargeTimer > 0;
    const legSwing = Math.sin(worldTime * (enemy.chargeTimer > 0 ? 17 : 7) + enemy.phase) * 3;
    ctx.fillStyle = 'rgba(20, 15, 23, 0.34)';
    ctx.beginPath();
    ctx.ellipse(0, 3, 31, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(enemy.direction, 1);
    ctx.strokeStyle = '#2d232d';
    ctx.lineWidth = 4;
    for (let leg = -1; leg <= 1; leg += 1) {
      ctx.beginPath();
      ctx.moveTo(leg * 11, -15);
      ctx.lineTo(leg * 18 + legSwing, 2);
      ctx.stroke();
    }
    if (chargeGlow) {
      ctx.save();
      ctx.shadowColor = '#ffbd5c';
      ctx.shadowBlur = enemy.chargeTimer > 0 ? 24 : 12;
      ctx.strokeStyle = `rgba(255, 185, 87, ${enemy.chargeTimer > 0 ? 0.75 : 0.42})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -18, 31, 22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const shell = ctx.createRadialGradient(-8, -28, 3, 0, -18, 30);
    shell.addColorStop(0, flash ? '#ffffff' : '#d3b36a');
    shell.addColorStop(0.5, flash ? '#fff6e0' : '#6c6552');
    shell.addColorStop(1, flash ? '#ffffff' : '#27383a');
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.ellipse(0, -20, 29, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = chargeGlow ? '#ffcf77' : 'rgba(237, 208, 144, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.quadraticCurveTo(3, -20, 0, -4);
    ctx.stroke();
    ctx.fillStyle = '#3d3031';
    ctx.beginPath();
    ctx.moveTo(21, -31);
    ctx.lineTo(39, -24);
    ctx.lineTo(23, -16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffe18b';
    ctx.beginPath();
    ctx.arc(15, -27, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (enemy.type === 'spore') {
    const pulse = 0.92 + Math.sin(worldTime * 3.5 + enemy.phase) * 0.08;
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.shadowColor = flash ? '#ffffff' : 'rgba(110, 241, 164, 0.55)';
    ctx.shadowBlur = 20;
    const cap = ctx.createRadialGradient(-9, -45, 2, 0, -36, 28);
    cap.addColorStop(0, flash ? '#ffffff' : '#d3ffb6');
    cap.addColorStop(0.55, flash ? '#fff4df' : '#65d59b');
    cap.addColorStop(1, flash ? '#ffffff' : '#2f8f7b');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(0, -34, 24, Math.PI, Math.PI * 2);
    ctx.quadraticCurveTo(20, -24, 17, -22);
    ctx.lineTo(-17, -22);
    ctx.quadraticCurveTo(-20, -24, -24, -34);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaffc3';
    [[-12, -37, 3], [1, -43, 4], [12, -33, 2.5]].forEach((spot) => {
      ctx.beginPath();
      ctx.arc(spot[0], spot[1], spot[2], 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = flash ? '#ffffff' : '#b7e6b0';
    ctx.beginPath();
    ctx.ellipse(0, -17, 11, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4c9b7f';
    ctx.lineWidth = 2;
    for (let tendril = -1; tendril <= 1; tendril += 1) {
      ctx.beginPath();
      ctx.moveTo(tendril * 7, -5);
      ctx.quadraticCurveTo(tendril * 10 + Math.sin(worldTime * 4 + tendril) * 4, 5, tendril * 5, 12);
      ctx.stroke();
    }
    ctx.fillStyle = '#21453d';
    ctx.beginPath();
    ctx.arc(-4, -19, 1.7, 0, Math.PI * 2);
    ctx.arc(4, -19, 1.7, 0, Math.PI * 2);
    ctx.fill();
    for (let mote = 0; mote < 4; mote += 1) {
      const angle = worldTime * 0.8 + (mote / 4) * Math.PI * 2;
      ctx.fillStyle = 'rgba(178, 255, 184, 0.68)';
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * 31, -27 + Math.sin(angle) * 15, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (enemy.type === 'raven') {
    const flap = Math.sin(worldTime * 8 + enemy.phase);
    if (enemy.diveWindup > 0) {
      ctx.strokeStyle = `rgba(179, 134, 255, ${0.25 + (1 - enemy.diveWindup / 0.46) * 0.55})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, -24, 34 + flap * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.translate(0, Math.sin(worldTime * 3 + enemy.phase) * 1.5);
    ctx.scale(enemy.direction, 1);
    const wingGradient = ctx.createLinearGradient(-34, -40, 30, -15);
    wingGradient.addColorStop(0, flash ? '#ffffff' : '#8b6cb8');
    wingGradient.addColorStop(1, flash ? '#fff2de' : '#33294a');
    ctx.fillStyle = wingGradient;
    ctx.beginPath();
    ctx.moveTo(-4, -28);
    ctx.quadraticCurveTo(-27, -51 - flap * 5, -38, -31);
    ctx.lineTo(-24, -26);
    ctx.lineTo(-33, -17);
    ctx.quadraticCurveTo(-17, -22, -4, -20);
    ctx.moveTo(4, -28);
    ctx.quadraticCurveTo(28, -52 + flap * 5, 39, -31);
    ctx.lineTo(24, -25);
    ctx.lineTo(31, -15);
    ctx.quadraticCurveTo(16, -21, 4, -20);
    ctx.fill();
    const ravenBody = ctx.createRadialGradient(-4, -31, 2, 0, -21, 24);
    ravenBody.addColorStop(0, flash ? '#ffffff' : '#6f5a99');
    ravenBody.addColorStop(1, flash ? '#fff4dc' : '#201a35');
    ctx.fillStyle = ravenBody;
    ctx.beginPath();
    ctx.ellipse(0, -21, 12, 18, 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2141';
    ctx.beginPath();
    ctx.arc(6, -36, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6c85e';
    ctx.beginPath();
    ctx.moveTo(14, -37);
    ctx.lineTo(27, -33);
    ctx.lineTo(14, -30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffdf74';
    ctx.shadowColor = '#f5ce75';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(8, -39, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#312541';
    ctx.beginPath();
    ctx.moveTo(-5, -8);
    ctx.lineTo(-19, 7);
    ctx.lineTo(0, -3);
    ctx.lineTo(11, 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (enemy.maxHp > 1 && enemy.hp < enemy.maxHp) {
    ctx.save();
    ctx.translate(cx, enemy.y - 10);
    for (let index = 0; index < enemy.maxHp; index += 1) {
      ctx.fillStyle = index < enemy.hp ? '#ffd36b' : 'rgba(40, 24, 35, 0.58)';
      ctx.beginPath();
      ctx.arc((index - (enemy.maxHp - 1) / 2) * 8, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawPlayerTrail() {
  if (!player || !player.trail) return;
  for (const trail of player.trail) {
    const alpha = Math.max(0, trail.life / trail.maxLife) * 0.22;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#79fff0';
    ctx.translate(trail.x + player.w / 2, trail.y + player.h);
    ctx.scale(trail.facing, 1);
    ctx.beginPath();
    ctx.ellipse(0, -33, 16, 23, -0.15, 0, Math.PI * 2);
    ctx.arc(3, -55, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139, 255, 239, 0.72)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

function drawPlayer() {
  if (!player) return;
  const cx = player.x + player.w / 2;
  const bottom = player.y + player.h;
  const moving = Math.abs(player.vx) > 30 && player.onGround;
  const stride = moving ? Math.sin(player.walkPhase * 2) * 6 : 0;
  const squash = player.landSquash;
  const blinkAlpha = player.invulnTime > 0 && player.dashTimer <= 0
    ? 0.55 + (Math.sin(worldTime * 28) * 0.5 + 0.5) * 0.45
    : 1;

  ctx.save();
  ctx.globalAlpha = blinkAlpha;
  if (player.dashTimer > 0 || player.dashCooldown > 0.54) {
    const aura = ctx.createRadialGradient(cx, bottom - 34, 8, cx, bottom - 34, 54);
    aura.addColorStop(0, 'rgba(125, 255, 239, 0.14)');
    aura.addColorStop(0.55, 'rgba(76, 225, 218, 0.1)');
    aura.addColorStop(1, 'rgba(72, 220, 211, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(cx - 60, bottom - 100, 120, 120);
  }
  const shadow = ctx.createRadialGradient(cx, bottom + 3, 3, cx, bottom + 3, 29);
  shadow.addColorStop(0, 'rgba(24, 13, 18, 0.34)');
  shadow.addColorStop(1, 'rgba(24, 13, 18, 0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(cx, bottom + 3, 29, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(cx, bottom);
  ctx.scale(player.facing * (1 + squash * 0.65), 1 - squash);

  const tailWave = Math.sin(worldTime * 4) * 4;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(74, 31, 31, 0.58)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-8, -25);
  ctx.bezierCurveTo(-27, -17, -42, -31 + stride * 0.35, -33, -50 + tailWave);
  ctx.quadraticCurveTo(-29, -61 + tailWave, -22, -56 + tailWave);
  ctx.stroke();
  const tail = ctx.createLinearGradient(-13, -25, -37, -58);
  tail.addColorStop(0, '#d95c30');
  tail.addColorStop(0.44, '#fa8d43');
  tail.addColorStop(0.78, '#ffc168');
  tail.addColorStop(1, '#ffe0a0');
  ctx.strokeStyle = tail;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-8, -25);
  ctx.bezierCurveTo(-27, -17, -42, -31 + stride * 0.35, -33, -50 + tailWave);
  ctx.quadraticCurveTo(-29, -61 + tailWave, -22, -56 + tailWave);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 231, 174, 0.56)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-12, -27);
  ctx.bezierCurveTo(-26, -20, -35, -32 + stride * 0.3, -30, -46 + tailWave);
  ctx.stroke();
  for (let segment = 0; segment < 3; segment += 1) {
    const t = 0.24 + segment * 0.2;
    const sx = -8 - 28 * t - 5 * Math.sin(t * Math.PI);
    const sy = -25 - 28 * t + tailWave * t;
    ctx.fillStyle = segment === 2 ? '#ffe3a3' : 'rgba(255, 179, 93, 0.74)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.6 - segment * 0.35, 1.4, 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.lineCap = 'round';
  ctx.strokeStyle = '#6e4637';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-7, -19);
  ctx.quadraticCurveTo(-7 + stride * 0.45, -10, -9 + stride, -2);
  ctx.stroke();
  const backPaw = ctx.createRadialGradient(-12 + stride, -2, 1, -9 + stride, -1, 9);
  backPaw.addColorStop(0, '#fff0c9');
  backPaw.addColorStop(1, '#c98e5f');
  ctx.fillStyle = backPaw;
  ctx.beginPath();
  ctx.ellipse(-8 + stride, -1.5, 8, 4, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#543a31';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(9, -18);
  ctx.quadraticCurveTo(11 - stride * 0.4, -9, 9 - stride, -2);
  ctx.stroke();
  const frontPaw = ctx.createRadialGradient(9 - stride, -2, 1, 11 - stride, -1, 10);
  frontPaw.addColorStop(0, '#fff5d8');
  frontPaw.addColorStop(0.58, '#efd09d');
  frontPaw.addColorStop(1, '#b77c58');
  ctx.fillStyle = frontPaw;
  ctx.beginPath();
  ctx.ellipse(10 - stride, -1.5, 9, 4.2, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(135, 86, 66, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8 - stride, -3);
  ctx.lineTo(8 - stride, 0);
  ctx.moveTo(12 - stride, -3.2);
  ctx.lineTo(12 - stride, 0.2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(88, 34, 28, 0.24)';
  ctx.beginPath();
  ctx.ellipse(-2, -30, 19, 23, -0.08, 0, Math.PI * 2);
  ctx.fill();
  const body = ctx.createRadialGradient(7, -41, 2, -1, -31, 27);
  body.addColorStop(0, '#ffcf7a');
  body.addColorStop(0.42, '#f99b4c');
  body.addColorStop(0.78, '#df6635');
  body.addColorStop(1, '#a93d2f');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -31, 18.5, 22.5, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 221, 147, 0.34)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(1, -33, 14.8, 18.4, -0.1, Math.PI * 1.08, Math.PI * 1.84);
  ctx.stroke();
  const belly = ctx.createLinearGradient(0, -40, 8, -16);
  belly.addColorStop(0, '#fff7dc');
  belly.addColorStop(0.58, '#f7dfb0');
  belly.addColorStop(1, '#d9a56f');
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(6, -28, 8.1, 12.4, -0.12, 0, Math.PI * 2);
  ctx.fill();
  const haunch = ctx.createRadialGradient(-9, -25, 2, -8, -24, 13);
  haunch.addColorStop(0, 'rgba(255, 186, 102, 0.64)');
  haunch.addColorStop(1, 'rgba(173, 67, 41, 0)');
  ctx.fillStyle = haunch;
  ctx.beginPath();
  ctx.arc(-8, -24, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(126, 52, 40, 0.32)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-13, -20);
  ctx.quadraticCurveTo(-17, -27, -12, -33);
  ctx.stroke();

  ctx.fillStyle = '#85392e';
  ctx.beginPath();
  ctx.moveTo(-12, -67);
  ctx.lineTo(-11, -87);
  ctx.lineTo(3, -70);
  ctx.closePath();
  ctx.moveTo(9, -67);
  ctx.lineTo(12, -88);
  ctx.lineTo(23, -68);
  ctx.closePath();
  ctx.fill();
  const leftEar = ctx.createLinearGradient(-10, -86, 2, -68);
  leftEar.addColorStop(0, '#d65b39');
  leftEar.addColorStop(1, '#ffb15d');
  ctx.fillStyle = leftEar;
  ctx.beginPath();
  ctx.moveTo(-10, -69);
  ctx.lineTo(-9, -83);
  ctx.lineTo(1, -70);
  ctx.closePath();
  ctx.fill();
  const rightEar = ctx.createLinearGradient(12, -85, 20, -69);
  rightEar.addColorStop(0, '#e8663c');
  rightEar.addColorStop(1, '#ffc06e');
  ctx.fillStyle = rightEar;
  ctx.beginPath();
  ctx.moveTo(11, -69);
  ctx.lineTo(12, -84);
  ctx.lineTo(20, -69);
  ctx.closePath();
  ctx.fill();
  const earInner = ctx.createLinearGradient(0, -80, 0, -69);
  earInner.addColorStop(0, '#ffb2a0');
  earInner.addColorStop(1, '#f6d2b8');
  ctx.fillStyle = earInner;
  ctx.beginPath();
  ctx.moveTo(-8, -70);
  ctx.lineTo(-7.5, -79);
  ctx.lineTo(-1, -70);
  ctx.closePath();
  ctx.moveTo(13, -70);
  ctx.lineTo(13.5, -80);
  ctx.lineTo(18.5, -70);
  ctx.closePath();
  ctx.fill();

  const headShadow = ctx.createRadialGradient(1, -57, 2, 4, -52, 23);
  headShadow.addColorStop(0, 'rgba(87, 32, 32, 0.18)');
  headShadow.addColorStop(1, 'rgba(87, 32, 32, 0)');
  ctx.fillStyle = headShadow;
  ctx.beginPath();
  ctx.arc(2, -51, 24, 0, Math.PI * 2);
  ctx.fill();
  const head = ctx.createRadialGradient(-3, -62, 3, 5, -51, 24);
  head.addColorStop(0, '#ffe19d');
  head.addColorStop(0.34, '#ffbd69');
  head.addColorStop(0.72, '#f58a42');
  head.addColorStop(1, '#c04f32');
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(4, -52, 19.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f48b47';
  ctx.beginPath();
  ctx.moveTo(-11, -56);
  ctx.lineTo(-19, -51);
  ctx.lineTo(-12, -48);
  ctx.lineTo(-17, -43);
  ctx.lineTo(-6, -44);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d85c36';
  ctx.beginPath();
  ctx.moveTo(-4, -68);
  ctx.quadraticCurveTo(1, -73, 6, -68);
  ctx.quadraticCurveTo(1, -66, -4, -68);
  ctx.fill();
  ctx.strokeStyle = 'rgba(126, 49, 37, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -62);
  ctx.quadraticCurveTo(-11, -58, -7, -54);
  ctx.moveTo(15, -62);
  ctx.quadraticCurveTo(20, -58, 16, -54);
  ctx.stroke();
  const muzzle = ctx.createRadialGradient(12, -49, 1, 10, -47, 11);
  muzzle.addColorStop(0, '#fff9e9');
  muzzle.addColorStop(0.62, '#fff0cc');
  muzzle.addColorStop(1, '#ecc99b');
  ctx.fillStyle = muzzle;
  ctx.beginPath();
  ctx.ellipse(10, -46.5, 9.4, 7.2, -0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#4a2940';
  ctx.beginPath();
  ctx.ellipse(5, -55, 3.2, 4, -0.05, 0, Math.PI * 2);
  ctx.ellipse(15.5, -55, 3.2, 4, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f6cc54';
  ctx.beginPath();
  ctx.ellipse(5.5, -54.5, 1.7, 2.6, -0.05, 0, Math.PI * 2);
  ctx.ellipse(16, -54.5, 1.7, 2.6, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b1c2d';
  ctx.beginPath();
  ctx.ellipse(5.5, -54.3, 0.72, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(16, -54.3, 0.72, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(6.2, -56.1, 1.1, 0, Math.PI * 2);
  ctx.arc(16.7, -56.1, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 184, 151, 0.22)';
  ctx.beginPath();
  ctx.ellipse(1, -48, 4.5, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#b84c4e';
  ctx.beginPath();
  ctx.moveTo(13.5, -47.3);
  ctx.quadraticCurveTo(10.5, -44.6, 8, -47.4);
  ctx.quadraticCurveTo(10.8, -49.8, 13.5, -47.3);
  ctx.fill();
  ctx.strokeStyle = '#7c3b33';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(10.7, -46.1);
  ctx.quadraticCurveTo(9.5, -43.6, 7.8, -44.2);
  ctx.moveTo(10.7, -46.1);
  ctx.quadraticCurveTo(12.2, -43.6, 14, -44.3);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(91, 45, 44, 0.56)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(8.2, -44.8);
  ctx.lineTo(1, -45.5);
  ctx.moveTo(13.3, -44.8);
  ctx.lineTo(20, -44.2);
  ctx.stroke();

  const scarf = ctx.createLinearGradient(0, -44, 0, -35);
  scarf.addColorStop(0, '#ff7d71');
  scarf.addColorStop(0.56, '#de3e4f');
  scarf.addColorStop(1, '#9c293f');
  ctx.strokeStyle = scarf;
  ctx.lineWidth = 8.5;
  ctx.beginPath();
  ctx.moveTo(-11, -41);
  ctx.quadraticCurveTo(2, -36.5, 16, -40.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 174, 152, 0.58)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-9, -43.5);
  ctx.quadraticCurveTo(2, -39.8, 13, -42.3);
  ctx.stroke();
  ctx.strokeStyle = '#b93243';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(-9, -38);
  ctx.quadraticCurveTo(-25, -35, -34, -28 + Math.sin(worldTime * 3.5) * 4);
  ctx.stroke();
  ctx.strokeStyle = '#ff8b75';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-11, -37.5);
  ctx.quadraticCurveTo(-25, -34.4, -33, -27.4 + Math.sin(worldTime * 3.5) * 4);
  ctx.stroke();
  ctx.fillStyle = '#ffd36e';
  ctx.beginPath();
  drawStarShape(3, -40.5, 4.8, 2.1, 4);
  ctx.fill();
  ctx.fillStyle = '#fff1a8';
  ctx.beginPath();
  ctx.arc(3, -40.5, 1.2, 0, Math.PI * 2);
  ctx.fill();

  if (player.attackTimer > 0) {
    const progress = 1 - player.attackTimer / player.attackDuration;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.rotate(-0.28 + progress * 0.52);
    ctx.strokeStyle = `rgba(255, 236, 159, ${0.88 - progress * 0.3})`;
    ctx.shadowColor = '#ffcf6d';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 11 - player.comboStep;
    ctx.beginPath();
    ctx.arc(5, -31, 57 + player.comboStep * 8, -1.28, 0.52);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 246, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(5, -31, 59 + player.comboStep * 8, -1.15, 0.42);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  if (player.dashCooldown > 0.08) {
    ctx.save();
    ctx.translate(player.x + player.w / 2, bottom + 15);
    ctx.strokeStyle = 'rgba(105, 239, 220, 0.5)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - player.dashCooldown / 0.7));
    ctx.stroke();
    ctx.restore();
  }
}

function drawBoss() {
  if (!boss) return;
  const alpha = boss.alive ? 1 : Math.max(0, boss.deathTimer / 2.1);
  const cx = boss.x + boss.w / 2;
  const bottom = boss.y + boss.h;
  const windup = boss.state.endsWith('Windup');
  const pulse = Math.sin(worldTime * (windup ? 16 : 5)) * 0.5 + 0.5;

  ctx.save();
  ctx.globalAlpha = alpha;
  const aura = ctx.createRadialGradient(cx, boss.y + boss.h * 0.55, 20, cx, boss.y + boss.h * 0.55, 145);
  aura.addColorStop(0, boss.phase === 3 ? 'rgba(255, 97, 91, 0.26)' : 'rgba(114, 82, 201, 0.24)');
  aura.addColorStop(1, 'rgba(60, 36, 96, 0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, boss.y + boss.h * 0.55, 150, 0, Math.PI * 2);
  ctx.fill();

  if (windup) {
    ctx.strokeStyle = `rgba(255, 107, 93, ${0.3 + pulse * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, GROUND_TOP - 4, 105 + pulse * 20, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(26, 13, 35, 0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, GROUND_TOP + 2, 88, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(cx, bottom);
  ctx.scale(boss.direction, 1);
  const breathe = Math.sin(worldTime * 2.6) * 3;

  ctx.strokeStyle = '#24172f';
  ctx.lineWidth = 17;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-42, -39);
  ctx.quadraticCurveTo(-63, -18, -48, 0);
  ctx.moveTo(39, -38);
  ctx.quadraticCurveTo(56, -15, 44, 0);
  ctx.stroke();
  ctx.fillStyle = '#3b274b';
  ctx.beginPath();
  ctx.arc(-28, -35, 26, 0, Math.PI * 2);
  ctx.arc(26, -35, 26, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(0, -142, 0, -10);
  body.addColorStop(0, boss.phase === 3 ? '#5c304e' : '#4b315e');
  body.addColorStop(0.6, '#30203f');
  body.addColorStop(1, '#1b1228');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-49, -14);
  ctx.bezierCurveTo(-70, -75, -55, -137 + breathe, -12, -145 + breathe);
  ctx.quadraticCurveTo(0, -151 + breathe, 14, -144 + breathe);
  ctx.bezierCurveTo(58, -132, 71, -72, 47, -12);
  ctx.quadraticCurveTo(0, 6, -49, -14);
  ctx.fill();

  const chest = ctx.createRadialGradient(4, -82, 3, 4, -78, 44);
  chest.addColorStop(0, boss.phase === 3 ? 'rgba(255, 116, 97, 0.7)' : 'rgba(170, 123, 255, 0.55)');
  chest.addColorStop(1, 'rgba(88, 46, 112, 0)');
  ctx.fillStyle = chest;
  ctx.beginPath();
  ctx.arc(4, -78, 45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#4a2f5c';
  ctx.beginPath();
  ctx.moveTo(-29, -136);
  ctx.lineTo(-49, -171);
  ctx.lineTo(-13, -147);
  ctx.closePath();
  ctx.moveTo(26, -138);
  ctx.lineTo(50, -173);
  ctx.lineTo(13, -147);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c29aff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-43, -165);
  ctx.quadraticCurveTo(-48, -177, -41, -183);
  ctx.moveTo(44, -167);
  ctx.quadraticCurveTo(50, -180, 43, -185);
  ctx.stroke();

  ctx.fillStyle = '#22152e';
  ctx.beginPath();
  ctx.ellipse(3, -119, 39, 31, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = boss.phase === 3 ? '#ff8b67' : '#ffcb68';
  ctx.shadowColor = boss.phase === 3 ? '#ff6154' : '#ffc457';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.ellipse(-9, -121, 8, 4.2, -0.14, 0, Math.PI * 2);
  ctx.ellipse(18, -120, 8, 4.2, 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 232, 188, 0.82)';
  for (let tooth = -12; tooth <= 16; tooth += 9) {
    ctx.beginPath();
    ctx.moveTo(tooth, -101);
    ctx.lineTo(tooth + 4, -93);
    ctx.lineTo(tooth + 8, -101);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(205, 163, 255, 0.48)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-38, -54);
  ctx.quadraticCurveTo(-19, -43, -35, -25);
  ctx.moveTo(35, -62);
  ctx.quadraticCurveTo(19, -46, 34, -22);
  ctx.stroke();

  if (boss.hitFlash > 0) {
    ctx.globalAlpha = Math.min(1, boss.hitFlash * 4) * 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, -78, 62, 75, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function projectilePalette(type) {
  if (type === 'boss') return { core: '#f4e8ff', mid: '#9a6cf0', outer: 'rgba(107, 65, 198, 0)', glow: 'rgba(165, 119, 255, 0.78)' };
  if (type === 'dark') return { core: '#fff2ff', mid: '#c36aff', outer: 'rgba(112, 47, 164, 0)', glow: 'rgba(198, 103, 255, 0.72)' };
  if (type === 'spore') return { core: '#f4ffdc', mid: '#6ee3a8', outer: 'rgba(46, 148, 112, 0)', glow: 'rgba(121, 245, 171, 0.7)' };
  return { core: '#fff8dd', mid: '#ffaf63', outer: 'rgba(255, 139, 76, 0)', glow: 'rgba(255, 147, 80, 0.7)' };
}

function drawProjectiles() {
  for (const projectile of projectiles) {
    const palette = projectilePalette(projectile.type);
    ctx.save();
    ctx.translate(projectile.x, projectile.y);
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, projectile.radius * 2.8);
    glow.addColorStop(0, palette.core);
    glow.addColorStop(0.28, palette.glow);
    glow.addColorStop(1, palette.outer);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, projectile.radius * 2.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(projectile.spin * (projectile.type === 'boss' ? 1 : 0.65));
    ctx.fillStyle = palette.mid;
    ctx.beginPath();
    if (projectile.type === 'boss') {
      for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2;
        const radius = index % 2 === 0 ? projectile.radius * 1.1 : projectile.radius * 0.52;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    } else if (projectile.type === 'dark') {
      ctx.moveTo(0, -projectile.radius * 1.25);
      ctx.lineTo(projectile.radius * 0.8, 0);
      ctx.lineTo(0, projectile.radius * 1.15);
      ctx.lineTo(-projectile.radius * 0.8, 0);
    } else if (projectile.type === 'spore') {
      ctx.arc(0, 0, projectile.radius * 0.72, 0, Math.PI * 2);
    } else {
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        const radius = index % 2 === 0 ? projectile.radius : projectile.radius * 0.68;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.core;
    ctx.beginPath();
    ctx.arc(0, 0, projectile.radius * 0.32, 0, Math.PI * 2);
    ctx.fill();
    if (projectile.type === 'spore') {
      for (let mote = 0; mote < 3; mote += 1) {
        const angle = projectile.spin * 1.6 + (mote / 3) * Math.PI * 2;
        ctx.fillStyle = palette.core;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * projectile.radius * 1.35, Math.sin(angle) * projectile.radius * 1.35, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawShockwaves() {
  for (const wave of shockwaves) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, wave.life * 1.7);
    const x = wave.vx < 0 ? wave.x : wave.x + wave.w;
    ctx.translate(x, wave.y + wave.h);
    ctx.scale(Math.sign(wave.vx), 1);
    ctx.fillStyle = 'rgba(255, 158, 87, 0.76)';
    ctx.shadowColor = '#ff8f4c';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(26, -8, 53, -38);
    ctx.quadraticCurveTo(21, -20, 0, -12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 244, 194, 0.72)';
    ctx.beginPath();
    ctx.moveTo(3, -2);
    ctx.quadraticCurveTo(24, -7, 43, -25);
    ctx.quadraticCurveTo(18, -10, 5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles() {
  for (const particle of particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.spin);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.rect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
    ctx.fill();
    ctx.restore();
  }
}

function drawFloaters() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 19px "Microsoft YaHei", "PingFang SC", sans-serif';
  for (const floater of floaters) {
    const alpha = Math.max(0, floater.life / floater.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = floater.color;
    ctx.shadowColor = 'rgba(28, 17, 28, 0.6)';
    ctx.shadowBlur = 5;
    ctx.fillText(floater.text, floater.x, floater.y);
  }
  ctx.restore();
}

function drawWorld() {
  const viewLeft = camera.x - 100;
  const viewRight = camera.x + VIEW_W + 100;
  for (const platform of platforms) {
    if (platform.x + platform.w < viewLeft || platform.x > viewRight) continue;
    drawPlatform(platform);
  }
  for (const hazard of hazards) {
    if (hazard.x + hazard.w < viewLeft || hazard.x > viewRight) continue;
    drawHazard(hazard);
  }
  if (checkpoint && Math.abs(checkpoint.x - camera.x - VIEW_W / 2) < VIEW_W) drawCheckpoint();
  drawGate();
  drawShards();
  for (const enemy of enemies) {
    if (!enemy.alive || enemy.x + enemy.w < viewLeft || enemy.x > viewRight) continue;
    drawEnemy(enemy);
  }
  if (boss) drawBoss();
  drawShockwaves();
  drawProjectiles();
  drawPlayerTrail();
  drawPlayer();
  drawParticles();
  drawFloaters();
}

function drawScreenEffects() {
  const vignette = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 270, VIEW_W / 2, VIEW_H / 2, 790);
  vignette.addColorStop(0, 'rgba(8, 10, 28, 0)');
  vignette.addColorStop(0.74, 'rgba(8, 10, 28, 0.07)');
  vignette.addColorStop(1, 'rgba(6, 8, 22, 0.34)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (flashTime > 0) {
    const alpha = Math.min(0.4, flashTime * 1.6);
    ctx.fillStyle = `rgba(255, 226, 190, ${alpha})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function drawAttractScene() {
  drawForestBackground(demoTime * 42, true);
  const glow = ctx.createRadialGradient(640, 350, 15, 640, 350, 330);
  glow.addColorStop(0, 'rgba(255, 220, 132, 0.12)');
  glow.addColorStop(1, 'rgba(255, 220, 132, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(280, 20, 720, 660);
  for (let index = 0; index < 10; index += 1) {
    const x = 940 + Math.sin(demoTime * 0.6 + index) * 130;
    const y = 590 - ((index * 37 + demoTime * 18) % 280);
    ctx.fillStyle = `rgba(255, 232, 161, ${0.25 + (index % 3) * 0.18})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (index % 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

function render() {
  ctx.setTransform(viewScaleX, 0, 0, viewScaleY, 0, 0);
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (mode === 'menu' || !level) {
    drawAttractScene();
    return;
  }
  drawBackground(level.theme, camera.x);
  const intensity = shakeTime > 0 ? shakeStrength * Math.min(1, shakeTime * 4) : 0;
  const shakeX = intensity ? (Math.random() * 2 - 1) * intensity : 0;
  const shakeY = intensity ? (Math.random() * 2 - 1) * intensity * 0.65 : 0;
  ctx.save();
  ctx.translate(-camera.x + shakeX, shakeY);
  drawWorld();
  ctx.restore();
  drawScreenEffects();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = Math.max(1, rect.width || VIEW_W);
  const cssHeight = Math.max(1, rect.height || VIEW_H);
  const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
  const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  viewScaleX = pixelWidth / VIEW_W;
  viewScaleY = pixelHeight / VIEW_H;
  ctx.imageSmoothingEnabled = true;
}

const keyHeld = { left: false, right: false, jump: false };
const touchHeld = { left: 0, right: 0, jump: 0 };
const touchPointers = new Map();

function syncHeldInput() {
  input.left = keyHeld.left || touchHeld.left > 0;
  input.right = keyHeld.right || touchHeld.right > 0;
  input.jumpHeld = keyHeld.jump || touchHeld.jump > 0;
}

function resetAllInputSources() {
  keyHeld.left = false;
  keyHeld.right = false;
  keyHeld.jump = false;
  touchHeld.left = 0;
  touchHeld.right = 0;
  touchHeld.jump = 0;
  for (const [action, pointers] of touchPointers.entries()) {
    pointers.clear();
    const button = document.querySelector(`.touch-btn[data-action="${action}"]`);
    if (button) button.classList.remove('is-active');
  }
  syncHeldInput();
}

const gameKeys = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'KeyA', 'KeyD', 'KeyW',
  'KeyJ', 'KeyZ', 'KeyL', 'ShiftLeft', 'ShiftRight'
]);

window.addEventListener('keydown', (event) => {
  const buttonFocused = event.target instanceof Element && event.target.closest('button');
  if (event.code === 'KeyM' && !event.repeat) {
    event.preventDefault();
    toggleMute();
    return;
  }
  if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) {
    event.preventDefault();
    if (mode === 'playing' || mode === 'paused') togglePause();
    return;
  }
  if (buttonFocused && mode !== 'playing' && (event.code === 'Space' || event.code === 'Enter')) return;
  if (mode !== 'playing') return;
  if (gameKeys.has(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
    keyHeld.left = true;
    syncHeldInput();
  } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
    keyHeld.right = true;
    syncHeldInput();
  } else if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
    keyHeld.jump = true;
    input.jumpBuffer = 0.13;
    syncHeldInput();
  } else if (event.code === 'KeyJ' || event.code === 'KeyZ') {
    input.attackBuffer = 0.16;
  } else if (event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.code === 'KeyL') {
    input.dashBuffer = 0.14;
  }
  if (gameKeys.has(event.code)) audio.unlock();
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') keyHeld.left = false;
  else if (event.code === 'ArrowRight' || event.code === 'KeyD') keyHeld.right = false;
  else if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') keyHeld.jump = false;
  else return;
  syncHeldInput();
});

document.querySelectorAll('.touch-btn').forEach((button) => {
  const action = button.dataset.action;
  if (!touchPointers.has(action)) touchPointers.set(action, new Set());
  const pointers = touchPointers.get(action);

  const activate = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    audio.unlock();
    const firstPointer = pointers.size === 0;
    pointers.add(event.pointerId);
    button.classList.add('is-active');
    if (action === 'left' || action === 'right') {
      touchHeld[action] = pointers.size;
      syncHeldInput();
    } else if (action === 'jump') {
      touchHeld.jump = pointers.size;
      if (firstPointer) input.jumpBuffer = 0.13;
      syncHeldInput();
    } else if (action === 'attack' && firstPointer) {
      input.attackBuffer = 0.16;
    } else if (action === 'dash' && firstPointer) {
      input.dashBuffer = 0.14;
    }
    try {
      button.setPointerCapture(event.pointerId);
    } catch (error) {
      return;
    }
  };

  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) button.classList.remove('is-active');
    if (action === 'left' || action === 'right') {
      touchHeld[action] = pointers.size;
      syncHeldInput();
    } else if (action === 'jump') {
      touchHeld.jump = pointers.size;
      syncHeldInput();
    }
  };

  button.addEventListener('pointerdown', activate, { passive: false });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('contextmenu', (event) => event.preventDefault());
});

dom.startButton.addEventListener('click', () => {
  if (mode !== 'menu') return;
  dom.helpPanel.hidden = true;
  startNewRun();
});

dom.continueButton.addEventListener('click', () => {
  if (mode !== 'menu') return;
  continueRun();
});

dom.helpButton.addEventListener('click', () => {
  dom.helpPanel.hidden = !dom.helpPanel.hidden;
  dom.helpButton.setAttribute('aria-expanded', String(!dom.helpPanel.hidden));
});

dom.menuSoundButton.addEventListener('click', toggleMute);
dom.muteButton.addEventListener('click', toggleMute);
dom.pauseButton.addEventListener('click', togglePause);
dom.resumeButton.addEventListener('click', resumeGame);
dom.retryPauseButton.addEventListener('click', () => {
  if (mode === 'paused') retryLevel();
});
dom.menuPauseButton.addEventListener('click', returnToMenu);
dom.nextButton.addEventListener('click', () => {
  if (mode === 'levelClear') nextLevel();
});
dom.menuClearButton.addEventListener('click', returnToMenu);
dom.retryButton.addEventListener('click', retryLevel);
dom.menuOverButton.addEventListener('click', returnToMenu);
dom.againButton.addEventListener('click', () => startLevel(0, 0));
dom.menuVictoryButton.addEventListener('click', returnToMenu);

window.addEventListener('blur', () => {
  resetAllInputSources();
  if (mode === 'playing') pauseGame();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resetAllInputSources();
    if (mode === 'playing') pauseGame();
  }
});

document.addEventListener('pointerdown', () => {
  audio.unlock();
}, { once: true, capture: true });

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(canvas);
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => window.setTimeout(resizeCanvas, 120));

function frame(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  let delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  delta = Math.min(delta, 0.08);
  demoTime += delta;
  accumulator += delta;
  let steps = 0;
  while (accumulator >= fixedStep && steps < 6) {
    updateGame(fixedStep);
    accumulator -= fixedStep;
    steps += 1;
  }
  if (steps === 6) accumulator = 0;
  render();
  window.requestAnimationFrame(frame);
}

resizeCanvas();
syncMenu();
updateMuteUi();
showScreen(dom.screenMenu);
dom.hud.hidden = true;
dom.bossBar.hidden = true;
window.requestAnimationFrame(frame);







