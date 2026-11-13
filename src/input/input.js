// Keyboard + touch input -> one controls object for the player's car.
// The mouse never controls the car (desktop: keyboard only; phones: on-screen touch controls).
import { neutralControls } from '../physics/car.js';

// Touch flip window: after a 2nd JUMP tap in the air with the stick centred, the game waits this
// long for a stick flick before turning it into a double jump. Generous for phones (V1); tighten
// only after playtesting. Keyboard uses RL timing (no buffer).
export const TOUCH_FLIP_BUFFER = 0.3;
export const TOUCH_FLIP_DEADZONE = 0.35;
export const KEYBOARD_FLIP_DEADZONE = 0.5;

// Input is sampled once per physics tick, but ticks only run when the browser draws a frame. A press
// whose keydown and keyup both land between two frames (a quick tap, a busy/throttled tab, a slow
// phone) used to be lost completely. Every press is therefore latched until the sim has seen it.
// A press released before any tick read it counts as held for TAP_MIN_TICKS (drive/steer keys, so a
// tap visibly nudges the car) or one tick (jump, boost, roll: a tapped jump is a minimum RL jump).
// A press the sim already saw ends on keyup as before, so normal held-key feel is unchanged.
export const TAP_MIN_TICKS = 10; // 10 ticks at 120 Hz ≈ 83 ms
const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const TOUCH_BUTTONS = ['jump', 'boost', 'roll'];

export class Input {
  constructor(root) {
    this.root = root;
    this.keys = new Set();      // keys physically held right now
    this.taps = new Map();      // code -> ticks an unseen/just-tapped press still counts as held
    this.seen = new Set();      // latched codes a tick has already read
    this.touch = { stickX: 0, stickY: 0, jump: false, boost: false, roll: false };
    this.touchTaps = { jump: 0, boost: 0, roll: 0 };
    this.lastDevice = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    this.onAction = () => {};
    this.enabled = true;
    this.bindKeyboard();
    // The canvas has no mouse controls; just keep the browser context menu off the game.
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeyboard() {
    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (block.has(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) {
        if (e.code === 'Escape' || e.code === 'KeyP') this.onAction('pause');
        else if (e.code === 'KeyR') this.onAction('reserve');
        else if (e.code === 'KeyC') this.onAction('ballcam');
        else if (e.code === 'KeyM') this.onAction('mute');
        else if (e.code === 'Backquote' || e.code === 'F3') this.onAction('debug');
        else if (e.code === 'KeyH') this.onAction('help');
        this.taps.set(e.code, DRIVE_KEYS.has(e.code) ? TAP_MIN_TICKS : 1);
        this.seen.delete(e.code);
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.seen.has(e.code)) { this.taps.delete(e.code); this.seen.delete(e.code); } // already registered: release normally
    });
    addEventListener('blur', () => { this.keys.clear(); this.taps.clear(); this.seen.clear(); });
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

  /** Build the car controls for this tick (called once per physics tick). */
  read(out = neutralControls()) {
    const c = out;
    if (!this.enabled) return Object.assign(c, neutralControls());
    const k = (code) => this.down(code);
    const up = k('KeyW') || k('ArrowUp');
    const down = k('KeyS') || k('ArrowDown');
    const left = k('KeyA') || k('ArrowLeft');
    const right = k('KeyD') || k('ArrowRight');
    let sx = (right ? 1 : 0) - (left ? 1 : 0);
    let sy = (up ? 1 : 0) - (down ? 1 : 0);
    const t = this.touch, tt = this.touchTaps;
    if (Math.abs(t.stickX) > Math.abs(sx)) sx = t.stickX;
    if (Math.abs(t.stickY) > Math.abs(sy)) sy = t.stickY;

    const rollL = k('KeyQ'), rollR = k('KeyE');
    const freeRoll = t.roll || tt.roll > 0; // free air roll: stick X rolls instead of yaw
    c.stickX = sx; c.stickY = sy;
    c.throttle = sy;
    c.steer = sx;
    c.pitch = -sy; // stick forward = nose down (RL default)
    c.yaw = freeRoll ? 0 : sx;
    c.roll = (rollR ? 1 : 0) - (rollL ? 1 : 0) + (freeRoll ? sx : 0);
    c.roll = Math.max(-1, Math.min(1, c.roll));
    c.boost = k('ShiftLeft') || k('ShiftRight') || t.boost || tt.boost > 0;
    c.jump = k('Space') || t.jump || tt.jump > 0;
    c.handbrake = rollL || rollR || freeRoll || k('ControlLeft'); // RL: air-roll button = powerslide on the ground

    // this tick has seen the latched presses
    for (const [code, n] of this.taps) {
      if (n <= 1 || (this.seen.has(code) && this.keys.has(code))) { this.taps.delete(code); this.seen.delete(code); } // held: plain key state takes over
      else { this.taps.set(code, n - 1); this.seen.add(code); }
    }
    for (const b of TOUCH_BUTTONS) if (tt[b] > 0) tt[b]--;
    return c;
  }
}
