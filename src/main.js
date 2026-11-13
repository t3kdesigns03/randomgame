// Rocket Pong — browser entry point: fixed-timestep loop, menus, HUD, input wiring.
import * as K from './physics/constants.js';
import { len } from './physics/vec.js';
import { Game } from './game/game.js';
import { MODES } from './game/rules.js';
import { Input } from './input/input.js';
import { createTouchControls } from './ui/touch.js';
import { GameView } from './render/scene.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked storage: fine */ } },
};

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || new URLSearchParams(location.search).has('touch');
const app = $('app');
const view = new GameView($('view'));
const input = new Input(app);
const sfx = new Sfx();
const touch = createTouchControls($('hud'), input);
touch.show(isTouch);

let game = null;
let mode = 'quick';
let running = false;
let paused = false;
let acc = 0;
let last = performance.now();
let debug = new URLSearchParams(location.search).has('debug');
let callTimer = 0;
const fps = { frames: 0, t: 0, value: 0, worst: 0, frameMs: 0 };

// ---------------------------------------------------------------- screens
function show(id) {
  for (const s of ['menu', 'pause', 'over']) $(s).classList.toggle('hidden', s !== id);
}
function startMatch() {
  mode = document.querySelector('input[name=mode]:checked')?.value || 'quick';
  game = new Game({ mode, playerProfile: input.profile });
  view.resetTrails();
  running = true; paused = false; acc = 0;
  show(null);
  $('hud').classList.remove('hidden');
  $('targetLbl').textContent = mode === 'quick' ? 'FIRST TO 7' : 'TO 11 · WIN BY 2';
  $('call').classList.add('hidden');
  $('keysHint').classList.toggle('hidden', isTouch || store.get('rp_keys_hint') === '0');
  touch.reset();
  input.clearTaps();
  sfx.unlock();
  tryLandscape();
}
function pause(on) {
  if (!running || game?.state === 'over') return;
  paused = on;
  show(on ? 'pause' : null);
  touch.reset();
  input.clearTaps();
  $('muteBtn').textContent = `Sound: ${sfx.muted ? 'off' : 'on'}`;
}
function quitToMenu() {
  running = false; paused = false; game = null;
  $('hud').classList.add('hidden');
  show('menu');
}
function tryLandscape() {
  if (!isTouch) return;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  }
}

// how-to overlay: auto on first load for 10 s, dismissible, never again unless asked
let howTimer = null;
function showHowTo(auto) {
  const el = $('howto');
  el.classList.remove('hidden');
  clearInterval(howTimer);
  let left = 10;
  $('howCount').textContent = auto ? `(${left})` : '';
  if (auto) {
    howTimer = setInterval(() => {
      left--;
      $('howCount').textContent = `(${left})`;
      if (left <= 0) hideHowTo();
    }, 1000);
  }
}
function hideHowTo() {
  clearInterval(howTimer);
  $('howto').classList.add('hidden');
  store.set('rp_howto_seen', '1');
}

$('playBtn').onclick = startMatch;
$('howBtn').onclick = () => showHowTo(false);
$('pauseHowBtn').onclick = () => showHowTo(false);
$('howClose').onclick = hideHowTo;
$('howto').addEventListener('pointerdown', (e) => { if (e.target === $('howto')) hideHowTo(); });
$('pauseBtn').onclick = () => pause(true);
$('resumeBtn').onclick = () => pause(false);
$('restartBtn').onclick = startMatch;
$('quitBtn').onclick = quitToMenu;
$('againBtn').onclick = startMatch;
$('overMenuBtn').onclick = quitToMenu;
$('muteBtn').onclick = () => { sfx.toggleMute(); $('muteBtn').textContent = `Sound: ${sfx.muted ? 'off' : 'on'}`; };
for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => { mode = r.value; });

input.onAction = (a) => {
  if (a === 'pause') { if (!$('howto').classList.contains('hidden')) hideHowTo(); else if (running) pause(!paused); }
  else if (a === 'reserve' && running && !paused) { game.reserve(); view.resetTrails(); }
  else if (a === 'ballcam') view.ballCam = !view.ballCam;
  else if (a === 'mute') sfx.toggleMute();
  else if (a === 'debug') debug = !debug;
  else if (a === 'help') { const h = $('keysHint'); h.classList.toggle('hidden'); store.set('rp_keys_hint', h.classList.contains('hidden') ? '0' : '1'); }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && running && !paused) pause(true); });

// orientation guard for phones
function checkOrientation() {
  const portrait = isTouch && innerHeight > innerWidth;
  $('rotate').classList.toggle('hidden', !portrait);
  if (portrait && running && !paused) pause(true);
}
addEventListener('resize', checkOrientation);
checkOrientation();

if (!store.get('rp_howto_seen')) showHowTo(true);

// ---------------------------------------------------------------- feedback
const CALL_TEXT = {
  'NOT RETURNED': 'NOT RETURNED', ACE: 'ACE', NET: 'INTO THE NET', 'OWN SIDE': 'BOUNCED ON OWN SIDE',
  OUT: 'OUT', 'OUT — WALL': 'OUT — HIT THE WALL', 'MISSED SERVE': 'MISSED SERVE', 'SERVE TIME': 'SERVE TIMED OUT',
};
function showCall(call) {
  const el = $('call');
  el.classList.remove('hidden', 'you', 'bot', 'let');
  void el.offsetWidth; // restart animation
  if (call.kind === 'let') {
    el.classList.add('let');
    $('callMain').textContent = 'LET';
    $('callSub').textContent = 'REPLAY THE POINT';
  } else {
    const you = call.winner === -1;
    el.classList.add(you ? 'you' : 'bot');
    $('callMain').textContent = call.kind === 'fault' ? 'FAULT' : 'POINT';
    const who = you ? 'YOUR POINT' : 'BOT POINT';
    $('callSub').textContent = `${CALL_TEXT[call.reason] || call.reason} · ${who}${call.rally > 1 ? ` · ${call.rally}-HIT RALLY` : ''}`;
  }
  callTimer = 1.9;
}

function handleFeed(feed) {
  for (const e of feed) {
    switch (e.type) {
      case 'touch': sfx.hit(e.relSpeed || 500); break;
      case 'floor': case 'wall': sfx.bounce(e.speed); break;
      case 'net': sfx.net(); break;
      case 'pad': if (e.team === -1) sfx.pad(e.big); break;
      case 'jump': if (e.team === -1) sfx.jump(); break;
      case 'call': showCall(e.call); sfx.point(e.call.winner === -1); break;
      case 'serve': view.resetTrails(); break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------- HUD
let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud(dt) {
  const m = game.match;
  setText('scoreYou', String(m.score[-1]));
  setText('scoreBot', String(m.score[1]));
  $('serveYou').classList.toggle('on', m.server === -1);
  $('serveBot').classList.toggle('on', m.server === 1);
  setText('rallyLbl', `RALLY ${m.rally ? m.rally.hits : 0}`);
  const car = game.world.cars[0];
  const b = Math.round(car.boost);
  setText('boostNum', String(b));
  $('boostArc').style.strokeDashoffset = String(169.6 * (1 - car.boost / K.BOOST_MAX));
  setText('speedNum', String(Math.round(len(car.vel) * 0.036)));
  $('superTag').classList.toggle('on', car.supersonic);
  if (callTimer > 0) { callTimer -= dt; if (callTimer <= 0) $('call').classList.add('hidden'); }
  if (game.state === 'serve' && game.stateTime < 0.05) {
    const el = $('call');
    el.classList.remove('hidden', 'you', 'bot', 'let');
    el.classList.add(m.server === -1 ? 'you' : 'bot');
    $('callMain').textContent = m.server === -1 ? 'YOUR SERVE' : 'BOT SERVES';
    $('callSub').textContent = `${m.score[-1]} – ${m.score[1]}`;
    callTimer = 1.0;
  }
  $('debug').classList.toggle('hidden', !debug);
  if (debug) {
    $('debug').textContent = `${fps.value} fps  worst ${fps.worst.toFixed(1)}ms  frame ${fps.frameMs.toFixed(2)}ms  dpr ${view.dpr}\n` +
      `car ${car.pos.x.toFixed(0)},${car.pos.y.toFixed(0)},${car.pos.z.toFixed(0)} spd ${len(car.vel).toFixed(0)} ${car.onGround ? 'ground' : 'air'}${car.flipping ? ' FLIP' : ''}\n` +
      `ball spd ${len(game.world.ball.vel).toFixed(0)} z ${game.world.ball.pos.z.toFixed(0)}  bot plan ${game.bot.plan ? (game.bot.plan.leave ? 'leave' : 'shot') : '-'}`;
  }
}

function gameOver() {
  const m = game.match;
  const won = m.winner === -1;
  $('overTitle').textContent = won ? 'YOU WIN!' : 'BOT WINS';
  $('overTitle').style.color = won ? 'var(--cyan)' : 'var(--pink)';
  $('overScore').textContent = `${m.score[-1]} – ${m.score[1]}`;
  setTimeout(() => { if (game && game.state === 'over') show('over'); }, 1600);
}

// ---------------------------------------------------------------- loop
// adaptive resolution: drop pixel ratio if frames run long, to hold 60 fps on phones
let slowFrames = 0, fastFrames = 0;
function adapt(frameMs) {
  if (frameMs > 19) { slowFrames++; fastFrames = 0; } else if (frameMs < 13) { fastFrames++; slowFrames = Math.max(0, slowFrames - 1); }
  if (slowFrames > 45 && view.dpr > 1) { view.setPixelRatio(Math.max(1, +(view.dpr - 0.25).toFixed(2))); slowFrames = 0; }
  if (fastFrames > 600 && view.dpr < view.maxDpr) { view.setPixelRatio(Math.min(view.maxDpr, view.dpr + 0.25)); fastFrames = 0; }
}

let wasOver = false;
function frame(t, fromRaf = false) {
  if (fromRaf) requestAnimationFrame(rafFrame);
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;
  fps.frames++; fps.t += dt; fps.worst = Math.max(fps.worst, dt * 1000);
  if (fps.t >= 1) { fps.value = Math.round(fps.frames / fps.t); fps.frames = 0; fps.t = 0; fps.lastWorst = fps.worst; fps.worst = 0; }
  if (!game) { view.render(idleGame, dt, t / 1000); return; }
  const t0 = performance.now();
  if (running && !paused) {
    acc += dt;
    let n = 0;
    while (acc >= K.DT && n < 6) {
      game.world.cars[0].profile = input.profile;
      input.read(game.playerControls);
      game.tick();
      acc -= K.DT; n++;
    }
    if (n === 6) acc = 0;
    handleFeed(game.drainFeed());
  }
  view.render(game, paused ? 0 : dt, t / 1000);
  updateHud(dt);
  fps.frameMs = performance.now() - t0;
  if (running && !paused) adapt(dt * 1000);
  if (game.state === 'over' && !wasOver) gameOver();
  wasOver = game.state === 'over';
}

// attract mode behind the menu: two bots play
const idleGame = new Game({ playerAI: {} });
const idleLoop = () => {
  if (!game) {
    for (let i = 0; i < 2; i++) idleGame.tick();
    idleGame.drainFeed();
    if (idleGame.state === 'over') Object.assign(idleGame, new Game({ playerAI: {} }));
  }
};
setInterval(idleLoop, 1000 / 60);
function rafFrame(t) { frame(t, true); }
requestAnimationFrame(rafFrame);

// expose for debugging / automated checks (lets a test drive the real loop without relying on rAF)
window.__rp = {
  get game() { return game; }, view, input, start: startMatch, K,
  /** Run `seconds` of game time through the real input -> tick -> render path at 60 fps steps. */
  advance(seconds) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) { last = performance.now() - 1000 / 60; frame(performance.now()); }
    return game && { state: game.state, score: { ...game.match.score }, t: +game.time.toFixed(2) };
  },
  key(code, down) { dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); },
};
