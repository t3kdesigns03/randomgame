// Keyboard + mouse + touch input -> one controls object for the player's car.
import { neutralControls } from '../physics/car.js';

// Touch flip window: after a 2nd JUMP tap in the air with the stick centred, the game waits this
// long for a stick flick before turning it into a double jump. Generous for phones (V1); tighten
// only after playtesting. Keyboard uses RL timing (no buffer).
export const TOUCH_FLIP_BUFFER = 0.3;
export const TOUCH_FLIP_DEADZONE = 0.35;
export const KEYBOARD_FLIP_DEADZONE = 0.5;

export class Input {
  constructor(root) {
    this.root = root;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.touch = { stickX: 0, stickY: 0, jump: false, boost: false, roll: false };
    this.lastDevice = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    this.onAction = () => {};
    this.enabled = true;
    this.bindKeyboard();
    this.bindMouse();
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
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
  }

  bindMouse() {
    const canvasHost = this.root;
    canvasHost.addEventListener('mousedown', (e) => {
      this.lastDevice = 'keyboard';
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvasHost.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Wire the on-screen touch controls (see ui/touch.js). */
  setTouchState(state) {
    Object.assign(this.touch, state);
    this.lastDevice = 'touch';
  }

  get profile() {
    return this.lastDevice === 'touch'
      ? { flipBuffer: TOUCH_FLIP_BUFFER, deadzone: TOUCH_FLIP_DEADZONE }
      : { flipBuffer: 0, deadzone: KEYBOARD_FLIP_DEADZONE };
  }

  /** Build the car controls for this tick. */
  read(out = neutralControls()) {
    const k = this.keys;
    const c = out;
    if (!this.enabled) return Object.assign(c, neutralControls());
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    let sx = (right ? 1 : 0) - (left ? 1 : 0);
    let sy = (up ? 1 : 0) - (down ? 1 : 0);
    const t = this.touch;
    if (Math.abs(t.stickX) > Math.abs(sx)) sx = t.stickX;
    if (Math.abs(t.stickY) > Math.abs(sy)) sy = t.stickY;

    const rollL = k.has('KeyQ'), rollR = k.has('KeyE');
    const freeRoll = this.mouse.right || t.roll; // free air roll: stick X rolls instead of yaw
    c.stickX = sx; c.stickY = sy;
    c.throttle = sy;
    c.steer = sx;
    c.pitch = -sy; // stick forward = nose down (RL default)
    c.yaw = freeRoll ? 0 : sx;
    c.roll = (rollR ? 1 : 0) - (rollL ? 1 : 0) + (freeRoll ? sx : 0);
    c.roll = Math.max(-1, Math.min(1, c.roll));
    c.boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.mouse.left || t.boost;
    c.jump = k.has('Space') || t.jump;
    c.handbrake = rollL || rollR || freeRoll || k.has('ControlLeft'); // RL: air-roll button = powerslide on the ground
    return c;
  }
}
