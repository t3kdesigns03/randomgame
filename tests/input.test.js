import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals so Input can bind its window listeners under node.
const listeners = {};
globalThis.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
globalThis.matchMedia = () => ({ matches: false });
const fire = (type, code, extra = {}) => {
  for (const fn of listeners[type] || []) fn({ code, repeat: false, target: null, preventDefault() {}, ...extra });
};
// root (#app) listeners: mousedown / contextmenu / auxclick land here
const rootListeners = {};
const root = { addEventListener(type, fn) { (rootListeners[type] ||= []).push(fn); } };
const BIT = [1, 4, 2]; // MouseEvent.buttons bit for button 0 / 1 / 2
const mouse = (button, down, extra = {}) => {
  const ev = { button, buttons: down ? BIT[button] : 0, target: null, preventDefault() {}, ...extra };
  if (down) for (const fn of rootListeners.mousedown || []) fn(ev);
  else fire('mouseup', undefined, ev);
};

const K = await import('../src/physics/constants.js');
const { makeCar, stepCar } = await import('../src/physics/car.js');
const { v3 } = await import('../src/physics/vec.js');
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

test('a tap whose down+up land between ticks still registers (keys and mouse buttons)', () => {
  const inp = new Input(root);
  fire('keydown', 'KeyW'); fire('keyup', 'KeyW'); // both before the next tick
  for (let i = 0; i < TAP_MIN_TICKS; i++) assert.equal(inp.read().throttle, 1, `tick ${i}`);
  assert.equal(inp.read().throttle, 0);

  mouse(2, true); mouse(2, false);
  assert.equal(inp.read().jump, true);  // seen for exactly one tick -> a press edge
  assert.equal(inp.read().jump, false);

  mouse(0, true); mouse(0, false);
  assert.equal(inp.read().boost, true);
  assert.equal(inp.read().boost, false);

  fire('keydown', 'ShiftLeft'); fire('keyup', 'ShiftLeft');
  assert.equal(inp.read().handbrake, true);
  assert.equal(inp.read().handbrake, false);
});

test('clearTaps drops latched presses (pause / new match)', () => {
  const inp = new Input(root);
  mouse(2, true); mouse(2, false);
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

test('Rocket League layout: RMB jump, LMB boost, MMB rear view, Tab scoreboard, J/K fallbacks', () => {
  const inp = new Input(root);
  mouse(2, true); let c = inp.read(); assert.equal(c.jump, true); assert.equal(c.boost, false);
  mouse(0, true); c = inp.read(); assert.equal(c.jump, true); assert.equal(c.boost, true); // both held at once
  mouse(2, false); mouse(0, false); c = inp.read(); assert.equal(c.jump, false); assert.equal(c.boost, false);

  mouse(1, true); assert.equal(inp.held('rearView'), true); c = inp.read();
  assert.equal(c.boost || c.jump || c.handbrake, false); // rear view is camera-only
  mouse(1, false); inp.read(); assert.equal(inp.held('rearView'), false);

  fire('keydown', 'Tab'); assert.equal(inp.held('scoreboard'), true);
  fire('keyup', 'Tab'); inp.read(); assert.equal(inp.held('scoreboard'), false);

  fire('keydown', 'KeyK'); fire('keydown', 'KeyJ');
  c = inp.read(); assert.equal(c.jump, true); assert.equal(c.boost, true);
  fire('keyup', 'KeyK'); fire('keyup', 'KeyJ'); inp.read();

  // Space and Shift no longer jump / boost
  fire('keydown', 'Space'); fire('keydown', 'ShiftLeft');
  c = inp.read(); assert.equal(c.jump, false); assert.equal(c.boost, false);
  fire('keyup', 'Space'); fire('keyup', 'ShiftLeft'); inp.read();
});

test('Space toggles ball cam; C does nothing; R / Esc / H actions unchanged', () => {
  const inp = new Input(root);
  const acts = [];
  inp.onAction = (a) => acts.push(a);
  for (const code of ['Space', 'KeyC', 'KeyR', 'Escape', 'KeyH']) { fire('keydown', code); fire('keyup', code); }
  assert.deepEqual(acts, ['ballcam', 'reserve', 'pause', 'help']);
  inp.read();
});

test('Space / Tab only swallow the browser default during play', () => {
  const inp = new Input(root);
  let prevented = 0;
  const ev = { preventDefault() { prevented++; } };
  fire('keydown', 'Tab', ev); fire('keyup', 'Tab', ev);
  assert.equal(prevented, 0, 'menus: Tab / Space keep their default (focus, button activation)');
  inp.inGame = true;
  fire('keydown', 'Tab', ev); fire('keyup', 'Tab', ev); fire('keydown', 'Space', ev); fire('keyup', 'Space', ev);
  assert.equal(prevented, 4);
  inp.inGame = false;
  inp.read();
});

test('Shift: powerslide on the ground, free air roll in the air (one button)', () => {
  const inp = new Input(root);
  fire('keydown', 'ShiftLeft'); fire('keydown', 'KeyD');
  let c = inp.read();
  assert.equal(c.handbrake, true);      // ground: powerslide
  assert.equal(c.steer, 1);             // still steers on the ground
  assert.equal(c.yaw, 0); assert.equal(c.roll, 1); // air: D rolls right instead of yawing
  fire('keyup', 'ShiftLeft');
  c = inp.read();
  assert.equal(c.handbrake, false); assert.equal(c.yaw, 1); assert.equal(c.roll, 0);
  fire('keyup', 'KeyD'); for (let i = 0; i < TAP_MIN_TICKS; i++) inp.read();

  // Q / E stay directional air roll
  fire('keydown', 'KeyQ'); assert.equal(inp.read().roll, -1); fire('keyup', 'KeyQ'); inp.read();
  fire('keydown', 'KeyE'); assert.equal(inp.read().roll, 1); fire('keyup', 'KeyE'); inp.read();

  // through the real car physics: Shift slides on the ground ...
  const ground = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  ground.vel = v3(0, 1200, 0);
  fire('keydown', 'ShiftLeft');
  stepCar(ground, inp.read(), K.DT);
  assert.equal(ground.powersliding, true);
  // ... and Shift + D rolls the car in the air instead of yawing it
  const air = makeCar(-1, v3(0, 0, 800), Math.PI / 2);
  air.onGround = false;
  fire('keydown', 'KeyD');
  for (let i = 0; i < 20; i++) stepCar(air, inp.read(), K.DT);
  const rollRate = Math.abs(air.angVel.x * air.R.f.x + air.angVel.y * air.R.f.y + air.angVel.z * air.R.f.z);
  const yawRate = Math.abs(air.angVel.z);
  assert.ok(rollRate > 1 && rollRate > yawRate * 3, `free air roll rolls (roll ${rollRate.toFixed(2)}, yaw ${yawRate.toFixed(2)})`);
  fire('keyup', 'KeyD'); fire('keyup', 'ShiftLeft'); for (let i = 0; i < TAP_MIN_TICKS; i++) inp.read();
});

test('double jump and directional flip still work through the mouse jump button', () => {
  const inp = new Input(root);
  let car;
  const run = (n) => { for (let i = 0; i < n; i++) stepCar(car, inp.read(), K.DT); };
  // flip: RMB jump, release, RMB again with W held -> forward dodge
  car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  car.profile = { ...car.profile, ...inp.profile };
  mouse(2, true); run(20); mouse(2, false); run(4);
  assert.equal(car.onGround, false);
  fire('keydown', 'KeyW');
  const vy0 = car.vel.y;
  mouse(2, true); run(1);
  assert.ok(car.flipping, 'second RMB + W = flip');
  assert.ok(car.vel.y - vy0 > 400, `forward dodge impulse (${(car.vel.y - vy0).toFixed(0)})`);
  mouse(2, false); fire('keyup', 'KeyW'); run(TAP_MIN_TICKS);

  // double jump: second RMB press with no direction
  car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  car.profile = { ...car.profile, ...inp.profile };
  mouse(2, true); run(20); mouse(2, false); run(4);
  const vz0 = car.vel.z;
  mouse(2, true); run(1); mouse(2, false);
  assert.ok(!car.flipping && car.hasDoubleJumped, 'second RMB, no direction = double jump');
  assert.ok(car.vel.z > vz0 + 200, 'double jump adds upward speed');
  run(2);

  // a quick RMB tap between ticks is still a jump (latched)
  car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  mouse(2, true); mouse(2, false); run(1);
  assert.equal(car.hasJumped, true);
});

test('mouse presses on UI or from touch never reach the car; movement never drives', () => {
  const inp = new Input(root);
  mouse(0, true, { target: { closest: () => ({}) } }); // e.g. the pause button
  assert.equal(inp.read().boost, false);
  mouse(0, false);
  mouse(2, true, { sourceCapabilities: { firesTouchEvents: true } });
  assert.equal(inp.read().jump, false);
  mouse(2, false);
  fire('mousemove', undefined, { buttons: 0, clientX: 500, clientY: 10 });
  const c = inp.read();
  assert.equal(c.throttle, 0); assert.equal(c.steer, 0); assert.equal(c.boost, false); assert.equal(c.jump, false);
});

test('a mouse button released outside the window is released on the next mousemove', () => {
  const inp = new Input(root);
  mouse(0, true); assert.equal(inp.read().boost, true);
  fire('mousemove', undefined, { buttons: 0 }); // no mouseup ever arrived
  assert.equal(inp.read().boost, false);
});
