import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals so Input can bind its window listeners under node.
const listeners = {};
globalThis.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
globalThis.matchMedia = () => ({ matches: false });
const fire = (type, code, extra = {}) => {
  for (const fn of listeners[type] || []) fn({ code, repeat: false, target: null, preventDefault() {}, ...extra });
};
const root = { addEventListener() {} };

const { Input, TAP_MIN_TICKS } = await import('../src/input/input.js');

test('held W / ArrowUp drives forward; A/D and arrows steer', () => {
  const inp = new Input(root);
  fire('keydown', 'KeyW');
  for (let i = 0; i < 30; i++) assert.equal(inp.read().throttle, 1);
  fire('keyup', 'KeyW');
  for (let i = 0; i < TAP_MIN_TICKS; i++) inp.read();
  assert.equal(inp.read().throttle, 0);
  fire('keydown', 'ArrowUp'); fire('keydown', 'ArrowLeft');
  let c = inp.read(); assert.equal(c.throttle, 1); assert.equal(c.steer, -1);
  fire('keyup', 'ArrowUp'); fire('keyup', 'ArrowLeft');
  fire('keydown', 'KeyS'); fire('keydown', 'KeyD');
  c = inp.read(); assert.equal(c.throttle, -1); assert.equal(c.steer, 1);
  fire('keyup', 'KeyS'); fire('keyup', 'KeyD');
});

test('a tap whose keydown+keyup land between ticks still registers (the shipped bug)', () => {
  const inp = new Input(root);
  fire('keydown', 'KeyW'); fire('keyup', 'KeyW'); // both before the next tick
  for (let i = 0; i < TAP_MIN_TICKS; i++) assert.equal(inp.read().throttle, 1, `tick ${i}`);
  assert.equal(inp.read().throttle, 0);

  fire('keydown', 'Space'); fire('keyup', 'Space');
  assert.equal(inp.read().jump, true);  // seen for exactly one tick -> a press edge
  assert.equal(inp.read().jump, false);

  fire('keydown', 'ShiftLeft'); fire('keyup', 'ShiftLeft');
  assert.equal(inp.read().boost, true);
  assert.equal(inp.read().boost, false);
});

test('clearTaps drops latched presses (pause / new match)', () => {
  const inp = new Input(root);
  fire('keydown', 'Space'); fire('keyup', 'Space');
  inp.clearTaps();
  assert.equal(inp.read().jump, false);
});

test('touch button taps between ticks are latched too; held keys survive touch updates', () => {
  const inp = new Input(root);
  fire('keydown', 'KeyW');
  inp.setTouchState({ stickX: 0, stickY: 0, jump: true, boost: false, roll: false });
  inp.setTouchState({ stickX: 0, stickY: 0, jump: false, boost: false, roll: false });
  const c = inp.read();
  assert.equal(c.jump, true);
  assert.equal(c.throttle, 1); // touch state never overwrites keyboard state
  assert.equal(inp.read().jump, false);
  fire('keyup', 'KeyW');
});

test('the mouse has no car bindings', () => {
  const inp = new Input(root);
  assert.equal(inp.mouse, undefined);
  fire('mousedown', undefined, { button: 0 });
  const c = inp.read();
  assert.equal(c.boost, false); assert.equal(c.throttle, 0); assert.equal(c.handbrake, false);
});
