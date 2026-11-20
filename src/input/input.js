// Keyboard + mouse buttons + touch input -> one controls object for the player's car.
// Desktop defaults follow Rocket League's PC keyboard + mouse layout (see BINDINGS below).
// Mouse *buttons* are bindings; mouse *movement* never controls the car.
import { neutralControls } from '../physics/car.js';

// Touch flip window: after a 2nd JUMP tap in the air with the stick centred, the game waits this
// long for a stick flick before turning it into a double jump. Generous for phones (V1); tighten
// only after playtesting. Keyboard/mouse uses RL timing (no buffer).
export const TOUCH_FLIP_BUFFER = 0.3;
export const TOUCH_FLIP_DEADZONE = 0.35;
export const KEYBOARD_FLIP_DEADZONE = 0.5;

// Input is sampled once per physics tick, but ticks only run when the browser draws a frame. A press
// whose down and up events both land between two frames (a quick tap, a busy/throttled tab, a slow
// phone) used to be lost completely. Every press is therefore latched until the sim has seen it.
// A press released before any tick read it counts as held for TAP_MIN_TICKS (drive/steer keys, so a
// tap visibly nudges the car) or one tick (jump, boost, roll: a tapped jump is a minimum RL jump).
// A press the sim already saw ends on release as before, so normal held-key feel is unchanged.
export const TAP_MIN_TICKS = 10; // 10 ticks at 120 Hz ≈ 83 ms
const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const TOUCH_BUTTONS = ['jump', 'boost', 'roll'];

// Mouse buttons share the key latch under these pseudo codes.
export const MOUSE_CODES = ['MouseLeft', 'MouseMiddle', 'MouseRight']; // indexed by MouseEvent.button
const MOUSE_BITS = { MouseLeft: 1, MouseRight: 2, MouseMiddle: 4 };    // MouseEvent.buttons bits

/** Default bindings: Rocket League PC keyboard + mouse, plus a few no-mouse fallbacks. */
export const BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  reverse: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  jump: ['MouseRight', 'KeyK'],            // RL: Right Mouse. K = keyboard-only fallback
  boost: ['MouseLeft', 'KeyJ'],            // RL: Left Mouse. J = keyboard-only fallback
  slide: ['ShiftLeft', 'ShiftRight'],      // RL: Left Shift = powerslide on the ground, free air roll in the air
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  rearView: ['MouseMiddle'],               // hold
  scoreboard: ['Tab'],                     // hold
};
// One-shot actions handled on keydown (not part of the car controls).
const KEY_ACTIONS = {
  Space: 'ballcam',                        // RL: Space = ball cam toggle
  Escape: 'pause', KeyP: 'pause',
  KeyR: 'reserve',
  KeyM: 'mute',
  KeyH: 'help',
  Backquote: 'debug', F3: 'debug',
};
// Keys whose browser default (scrolling, focus moves, button activation) must never reach the page.
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
// Blocked only during play, so Space / Tab still work on focused menu buttons.
const BLOCK_IN_GAME = new Set(['Space', 'Tab']);
// Mouse presses on these never become car input (menus, HUD buttons, touch buttons).
const UI_SELECTOR = 'button, input, label, select, a, .screen';
const TOUCH_MOUSE_GRACE_MS = 1000; // compat mouse events a browser emits after a touch

export class Input {
  constructor(root) {
    this.root = root;
    this.keys = new Set();      // codes physically held right now (keys + mouse buttons)
    this.taps = new Map();      // code -> ticks an unseen/just-tapped press still counts as held
    this.seen = new Set();      // latched codes a tick has already read
    this.touch = { stickX: 0, stickY: 0, jump: false, boost: false, roll: false };
    this.touchTaps = { jump: 0, boost: 0, roll: 0 };
    this.lastDevice = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    this.lastTouchAt = -Infinity;
    this.onAction = () => {};
    this.onPointerDown = () => {}; // main.js: refocus the canvas
    this.enabled = true;
    this.inGame = false;           // main.js: true while a match is live (not paused / in a menu)
    this.bindKeyboard();
    this.bindMouse();
    // Right mouse is jump: keep the browser context menu off the game.
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  press(code, tapTicks = 1) {
    if (!this.keys.has(code)) {
      this.taps.set(code, tapTicks);
      this.seen.delete(code);
    }
    this.keys.add(code);
  }

  release(code) {
    this.keys.delete(code);
    if (this.seen.has(code)) { this.taps.delete(code); this.seen.delete(code); } // already registered: release normally
  }

  blocks(code) { return BLOCK.has(code) || (this.inGame && BLOCK_IN_GAME.has(code)); }

  bindKeyboard() {
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (this.blocks(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat && KEY_ACTIONS[e.code]) this.onAction(KEY_ACTIONS[e.code]);
      if (!e.repeat) this.press(e.code, DRIVE_KEYS.has(e.code) ? TAP_MIN_TICKS : 1);
      else this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      if (this.blocks(e.code)) e.preventDefault(); // Space keyup would "click" a focused button
      this.release(e.code);
    });
    addEventListener('blur', () => { this.keys.clear(); this.taps.clear(); this.seen.clear(); });
  }

  bindMouse() {
    // Touch taps make browsers emit compatibility mouse events; never treat those as mouse buttons.
    const noteTouch = (e) => { if (e.pointerType !== 'mouse') this.lastTouchAt = performance.now(); };
    addEventListener('pointerdown', noteTouch, true);
    addEventListener('touchstart', () => { this.lastTouchAt = performance.now(); }, { capture: true, passive: true });
    const fromTouch = (e) => e.sourceCapabilities?.firesTouchEvents || performance.now() - this.lastTouchAt < TOUCH_MOUSE_GRACE_MS;

    // mousedown/mouseup (not pointerdown) fire for every button, even while another is held.
    this.root.addEventListener('mousedown', (e) => {
      const code = MOUSE_CODES[e.button];
      if (!code || fromTouch(e)) return;
      if (e.target?.closest?.(UI_SELECTOR)) return;
      e.preventDefault(); // no text selection / middle-click autoscroll / focus theft
      this.lastDevice = 'keyboard';
      this.onPointerDown();
      this.press(code, 1);
    });
    addEventListener('mouseup', (e) => {
      const code = MOUSE_CODES[e.button];
      if (code) this.release(code);
    });
    // A button released outside the window never sends mouseup: reconcile from the buttons mask.
    addEventListener('mousemove', (e) => {
      for (const code of MOUSE_CODES) if (this.keys.has(code) && !(e.buttons & MOUSE_BITS[code])) this.release(code);
    });
    this.root.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  }

  /** Forget latched presses (new match / pause), so a key tapped in a menu doesn't act later. */
  clearTaps() {
    this.taps.clear();
    this.seen.clear();
    for (const b of TOUCH_BUTTONS) this.touchTaps[b] = 0;
  }

  /** Wire the on-screen touch controls (see ui/touch.js). */
  setTouchState(state) {
    for (const b of TOUCH_BUTTONS) if (state[b] && !this.touch[b]) this.touchTaps[b] = 1; // latch the press
    Object.assign(this.touch, state);
    this.lastDevice = 'touch';
  }

  get profile() {
    return this.lastDevice === 'touch'
      ? { flipBuffer: TOUCH_FLIP_BUFFER, deadzone: TOUCH_FLIP_DEADZONE }
      : { flipBuffer: 0, deadzone: KEYBOARD_FLIP_DEADZONE };
  }

  /** Held now, or pressed since the last tick(s) and not yet seen long enough. */
  down(code) { return this.keys.has(code) || (this.taps.get(code) || 0) > 0; }

  /** Is any binding of `action` held/latched right now? (for camera / UI holds read per frame) */
  held(action) { return BINDINGS[action].some((code) => this.down(code)); }

  /** Build the car controls for this tick (called once per physics tick). */
  read(out = neutralControls()) {
    const c = out;
    if (!this.enabled) return Object.assign(c, neutralControls());
    const b = (action) => this.held(action);
    let sx = (b('steerRight') ? 1 : 0) - (b('steerLeft') ? 1 : 0);
    let sy = (b('throttle') ? 1 : 0) - (b('reverse') ? 1 : 0);
    const t = this.touch, tt = this.touchTaps;
    if (Math.abs(t.stickX) > Math.abs(sx)) sx = t.stickX;
    if (Math.abs(t.stickY) > Math.abs(sy)) sy = t.stickY;

    const rollL = b('rollLeft'), rollR = b('rollRight');
    // Left Shift (and the touch AIR ROLL button) is one button with two jobs, like RL:
    // on the ground it powerslides (handbrake), in the air it is free air roll (steer rolls instead
    // of yawing). The car physics uses handbrake only on the ground and yaw/roll only in the air.
    const slide = b('slide') || t.roll || tt.roll > 0;
    c.stickX = sx; c.stickY = sy;
    c.throttle = sy;
    c.steer = sx;
    c.pitch = -sy; // stick forward = nose down (RL default)
    c.yaw = slide ? 0 : sx;
    c.roll = (rollR ? 1 : 0) - (rollL ? 1 : 0) + (slide ? sx : 0);
    c.roll = Math.max(-1, Math.min(1, c.roll));
    c.boost = b('boost') || t.boost || tt.boost > 0;
    c.jump = b('jump') || t.jump || tt.jump > 0;
    c.handbrake = slide || rollL || rollR; // RL: directional air roll buttons also powerslide on the ground

    // this tick has seen the latched presses
    for (const [code, n] of this.taps) {
      if (n <= 1 || (this.seen.has(code) && this.keys.has(code))) { this.taps.delete(code); this.seen.delete(code); } // held: plain key state takes over
      else { this.taps.set(code, n - 1); this.seen.add(code); }
    }
    for (const k of TOUCH_BUTTONS) if (tt[k] > 0) tt[k]--;
    return c;
  }
}
