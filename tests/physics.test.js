import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../src/physics/constants.js';
import { makeBall, stepBall } from '../src/physics/ball.js';
import { makeCar, stepCar, neutralControls } from '../src/physics/car.js';
import { collideCarBall } from '../src/physics/collide.js';
import { arenaQuery } from '../src/physics/arena.js';
import { v3, len, sub, scale, add, dot, toLocal } from '../src/physics/vec.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('RL constants are the researched values', () => {
  assert.equal(K.GRAVITY, 650);
  assert.equal(K.BALL_RADIUS, 91.25);        // RocketSim BALL_COLLISION_RADIUS_SOCCAR
  assert.equal(K.BALL_VISUAL_RADIUS, 92.75);
  assert.equal(K.BALL_MASS, 30);
  assert.equal(K.BALL_MAX_SPEED, 6000);
  assert.equal(K.BALL_RESTITUTION, 0.6);
  assert.equal(K.BALL_MAX_ANG_SPEED, 6);
  assert.equal(K.CAR_MAX_SPEED, 2300);
  assert.equal(K.CAR_SUPERSONIC, 2200);
  assert.equal(K.FLIP_BACKWARD_MAX_SPEED_SCALE, 2.5);
  assert.equal(K.HANDBRAKE_LAT_FRICTION_FACTOR, 0.1);
  assert.equal(K.POWERSLIDE_RISE_RATE, 5);
  assert.equal(K.POWERSLIDE_FALL_RATE, 2);
  assert.equal(K.BOOST_MIN_TIME, 0.1);
  near(K.CAR_TORQUE_SCALE, 0.0958738, 1e-6, 'CAR_TORQUE_SCALE');
  assert.equal(K.FLIP_DURATION, 0.65);
  assert.equal(K.FLIP_Z_DAMP_START, 0.15);
  assert.equal(K.FLIP_Z_DAMP_PER_TICK, 0.35);
  near(K.DT, 0.008333, 0.0001, 'fixed tick ~8 ms');
});

test('ball free fall follows 650 uu/s^2 with only light drag', () => {
  const b = makeBall(v3(0, -1500, 1900));
  for (let i = 0; i < 120; i++) stepBall(b, K.DT);
  const fell = 1900 - b.pos.z;
  near(fell, 325, 325 * 0.02, 'distance fallen in 1 s');
  near(b.vel.z, -650 * Math.pow(0.97, 1), 12, 'speed after 1 s');
});

test('ball bounce keeps 60% of into-surface speed and apex ratio ~0.36', () => {
  const b = makeBall(v3(0, -1500, 1000));
  let before = 0, after = 0, bounced = false;
  for (let i = 0; i < 400 && !bounced; i++) {
    const ev = [];
    const vz = b.vel.z;
    stepBall(b, K.DT, ev);
    if (ev.some((e) => e.type === 'floor')) { before = vz - K.GRAVITY * K.DT; after = b.vel.z; bounced = true; }
  }
  assert.ok(bounced);
  near(after / -before, 0.6, 0.012, 'restitution');
  let apex = 0;
  for (let i = 0; i < 240; i++) { stepBall(b, K.DT); apex = Math.max(apex, b.pos.z - K.BALL_RADIUS); }
  near(apex / (1000 - K.BALL_RADIUS), 0.36, 0.03, 'bounce height ratio');
});

test('walls use the same 0.6 restitution', () => {
  const b = makeBall(v3(K.ARENA_HALF_X - 300, 0, 900));
  b.vel = v3(2000, 0, 0);
  let vin = 0, vout = 0;
  for (let i = 0; i < 60; i++) {
    const ev = []; const vx = b.vel.x;
    stepBall(b, K.DT, ev);
    if (ev.some((e) => e.type === 'wall')) { vin = vx; vout = b.vel.x; break; }
  }
  near(-vout / vin, 0.6, 0.02, 'wall restitution');
});

test('ball speed and spin are capped; spin never bends the flight (no Magnus)', () => {
  const a = makeBall(v3(0, -2000, 1000)); a.vel = v3(9000, 0, 0); a.ang = v3(50, 0, 0);
  stepBall(a, K.DT);
  assert.ok(len(a.vel) <= 6000 + 1e-6);
  assert.ok(len(a.ang) <= 6 + 1e-6);
  const s = makeBall(v3(0, -2000, 1200)); s.vel = v3(300, 800, 400); s.ang = v3(0, 6, 0);
  const n = makeBall(v3(0, -2000, 1200)); n.vel = v3(300, 800, 400);
  for (let i = 0; i < 60; i++) { stepBall(s, K.DT); stepBall(n, K.DT); }
  near(len(sub(s.pos, n.pos)), 0, 1e-9, 'spinning vs non-spinning flight');
});

test('car drive: throttle-only tops out ~1410, boost reaches 2300 and supersonic', () => {
  const car = makeCar(-1, v3(-2300, -2000, K.CAR_REST_HEIGHT), 0);
  const c = neutralControls(); c.throttle = 1;
  for (let i = 0; i < 120 * 3.5; i++) stepCar(car, c, K.DT);
  near(len(car.vel), 1410, 20, 'throttle top speed');
  const car2 = makeCar(-1, v3(-2300, -2000, K.CAR_REST_HEIGHT), 0); car2.boost = 100;
  c.boost = true;
  let maxSp = 0, superAt = null;
  for (let i = 0; i < 120 * 2.3; i++) { stepCar(car2, c, K.DT); maxSp = Math.max(maxSp, len(car2.vel)); if (car2.supersonic && superAt === null) superAt = len(car2.vel); }
  near(maxSp, 2300, 0.001, 'boost max speed');
  assert.ok(superAt >= 2200, 'supersonic at >= 2200');
  assert.ok(car2.boost < 100 - 33, 'boost drains ~33/s');
});

test('car gravity is a constant 650 uu/s^2 at any speed (RocketSim)', () => {
  for (const vy of [0, 2300]) {
    const car = makeCar(-1, v3(0, -2000, 1000), Math.PI / 2);
    car.onGround = false; car.vel = v3(0, vy, 0);
    stepCar(car, neutralControls(), K.DT);
    near(-car.vel.z / K.DT, 650, 0.5, `gravity at ${vy}`);
  }
});

const driveCar = (speed, yaw = 0) => {
  const car = makeCar(-1, v3(-1500, -2500, K.CAR_REST_HEIGHT), yaw);
  car.vel = v3(Math.cos(yaw) * speed, Math.sin(yaw) * speed, 0);
  return car;
};
const slipAngle = (car) => {
  const s = len(car.vel);
  return s < 1 ? 0 : Math.acos(Math.max(-1, Math.min(1, dot(car.vel, car.R.f) / s)));
};

test('ground steering: front-wheel steer angles give RL turning circles', () => {
  // RLUtilities measured curvature (1/uu) vs speed for full steer
  for (const [speed, kappa] of [[500, 0.00398], [1000, 0.00235], [1400, 0.0015]]) {
    const car = driveCar(speed);
    const c = neutralControls(); c.steer = 1; c.throttle = 0.0011; // hold speed roughly (tiny throttle)
    let yaw = 0, dist = 0;
    for (let i = 0; i < 120 * 1.5; i++) {
      const f0 = { ...car.R.f };
      c.throttle = len(car.vel) < speed ? 1 : 0.0011;
      stepCar(car, c, K.DT);
      if (i > 60) { yaw += Math.abs(Math.asin(Math.max(-1, Math.min(1, f0.x * car.R.f.y - f0.y * car.R.f.x)))); dist += len(car.vel) * K.DT; }
    }
    const k = yaw / dist;
    assert.ok(Math.abs(k - kappa) / kappa < 0.2, `curvature at ${speed}: ${k.toFixed(5)} vs RL ${kappa}`);
    assert.ok(slipAngle(car) < 0.12, `grip driving barely slides (${slipAngle(car).toFixed(3)} rad)`);
  }
});

test('powerslide: handbrake ramps in 0.2 s, kills lateral grip, car slides and keeps its speed', () => {
  const grip = driveCar(1400), slide = driveCar(1400);
  const c = neutralControls(); c.steer = 1;
  const h = { ...c, handbrake: true };
  stepCar(slide, h, K.DT);
  near(slide.handbrakeVal, 5 * K.DT, 1e-9, 'handbrake rises at 5/s');
  for (let i = 1; i < 24; i++) stepCar(slide, h, K.DT);
  near(slide.handbrakeVal, 1, 1e-9, 'full handbrake after 0.2 s');
  for (let i = 0; i < 24; i++) stepCar(grip, c, K.DT);
  for (let i = 0; i < 60; i++) { stepCar(grip, c, K.DT); stepCar(slide, h, K.DT); }
  assert.ok(slide.powersliding, 'powersliding flag');
  assert.ok(slipAngle(slide) > 0.35, `powerslide drifts sideways (slip ${slipAngle(slide).toFixed(2)} rad)`);
  assert.ok(slipAngle(grip) < 0.12, `grip turn does not (slip ${slipAngle(grip).toFixed(2)} rad)`);
  assert.ok(len(slide.vel) > len(grip.vel) - 50, 'no coasting brake while powersliding');
  // release: handbrake falls at 2/s and grip comes back
  for (let i = 0; i < 30; i++) stepCar(slide, c, K.DT);
  near(slide.handbrakeVal, 1 - 2 * 30 * K.DT, 1e-9, 'handbrake falls at 2/s');
  const lat0 = Math.abs(dot(slide.vel, slide.R.l));
  for (let i = 0; i < 120; i++) stepCar(slide, neutralControls(), K.DT);
  const lat1 = Math.abs(dot(slide.vel, slide.R.l));
  assert.ok(lat0 > 200 && lat1 < lat0 * 0.05, `grip returns after release: sideways slide ${lat0.toFixed(0)} -> ${lat1.toFixed(1)} uu/s`);
});

test('boost: a tap boosts for the 0.1 s minimum; supersonic holds 1 s between 2100 and 2200', () => {
  const car = driveCar(0); car.boost = 100;
  const tap = neutralControls(); tap.boost = true;
  stepCar(car, tap, K.DT);
  let ticks = 1;
  while (car.boosting && ticks < 60) { stepCar(car, neutralControls(), K.DT); ticks++; }
  near(ticks, 13, 1, 'boost ticks from a 1-tick tap (0.1 s)');

  const s = driveCar(2250); s.supersonic = true;
  s.vel = v3(2150, 0, 0);
  let t = 0;
  while (s.supersonic && t < 3) { s.vel = v3(2150, 0, 0); stepCar(s, neutralControls(), K.DT); s.vel = v3(2150, 0, 0); t += K.DT; }
  near(t, 1, 0.05, 'supersonic kept for 1 s at 2150');
})

test('jump impulse, hold and dodge timings', () => {
  const car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  const c = neutralControls(); c.jump = true;
  stepCar(car, c, K.DT);
  near(car.vel.z, 291.667 + (1458.333 * 0.62 - 650) * K.DT, 1, 'first jump tick (62% hold accel for 0.025 s)');
  for (let i = 0; i < 40; i++) stepCar(car, c, K.DT);
  c.jump = false; stepCar(car, c, K.DT);
  // dodge forward
  c.jump = true; c.stickY = 1; c.pitch = -1;
  const vy0 = car.vel.y;
  stepCar(car, c, K.DT);
  assert.ok(car.flipping);
  near(car.vel.y - vy0, 500, 1, 'forward dodge impulse from rest');
  // float: normal vertical momentum for 0.15 s, then -35% per tick
  c.jump = false;
  let t = car.flipTime; let damped = 0;
  while (t < 0.3) {
    const vz = car.vel.z; stepCar(car, c, K.DT); t = car.flipTime;
    const g = (vz - K.GRAVITY * K.DT);
    if (Math.abs(car.vel.z - g * 0.65) < 2 && Math.abs(vz) > 5) damped++;
    if (t < K.FLIP_Z_DAMP_START - 0.01) assert.ok(Math.abs(car.vel.z - g) < 2, `no damping before 0.15 s (t=${t})`);
  }
  assert.ok(damped >= 5, `z damped for the 0.15-0.21 s window (${damped} ticks)`);
  for (let i = 0; i < 120; i++) stepCar(car, c, K.DT);
  assert.ok(!car.flipping || car.onGround, 'dodge ends after 0.65 s');
});

test('Psyonix extra impulse goes to the ball only (momentum not conserved)', () => {
  const car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  car.vel = v3(0, 1400, 0);
  const ball = makeBall(v3(0, -2000 + 175, K.BALL_RADIUS));
  const p0 = add(scale(car.vel, K.CAR_MASS), scale(ball.vel, K.BALL_MASS));
  let hit = null;
  for (let i = 1; i < 30 && !hit; i++) {
    car.pos.y += car.vel.y * K.DT;
    hit = collideCarBall(car, ball, i);
  }
  assert.ok(hit, 'contact');
  const p1 = add(scale(car.vel, K.CAR_MASS), scale(ball.vel, K.BALL_MASS));
  const dp = sub(p1, p0);
  near(len(sub(dp, scale(hit.extra, K.BALL_MASS))), 0, 1e-6, 'momentum gain == ball mass * extra impulse');
  // extra impulse matches the published formula
  const rel = Math.min(hit.relSpeed, 4600);
  const factor = rel <= 500 ? 0.65 : rel <= 2300 ? 0.65 - (0.1 * (rel - 500)) / 1800 : 0.55 - (0.25 * (rel - 2300)) / 2300;
  near(len(hit.extra), rel * factor, 1e-6, 'extra impulse magnitude');
});

test('hit predictability: identical inputs give identical outcomes', () => {
  const run = () => {
    const car = makeCar(-1, v3(30, -2100, K.CAR_REST_HEIGHT), Math.PI / 2 + 0.05);
    car.vel = v3(60, 1700, 0);
    const ball = makeBall(v3(0, -1850, 120)); ball.vel = v3(0, -200, 300);
    const c = neutralControls(); c.throttle = 1;
    for (let i = 1; i < 120; i++) { stepCar(car, c, K.DT); stepBall(ball, K.DT); collideCarBall(car, ball, i); }
    return ball.pos;
  };
  assert.deepEqual(run(), run());
});

test('arena: flat floor, curved ramps up to vertical walls', () => {
  const q = arenaQuery(v3(0, 0, 50));
  near(q.d, 50, 1e-9, 'floor distance'); near(q.n.z, 1, 1e-9, 'floor normal');
  const w = arenaQuery(v3(K.ARENA_HALF_X - 10, 0, 1000));
  near(w.n.x, -1, 1e-9, 'side wall normal');
  const r = arenaQuery(v3(K.ARENA_HALF_X - 60, 0, 60));
  assert.ok(r.n.z > 0.1 && r.n.x < -0.1, 'ramp normal is diagonal');
});

test('cars can drive up the curved wall (wall shots)', () => {
  const car = makeCar(-1, v3(1500, -2000, K.CAR_REST_HEIGHT), 0);
  car.boost = 100;
  const c = neutralControls(); c.throttle = 1; c.boost = true;
  let maxZ = 0;
  for (let i = 0; i < 120 * 1.5; i++) { stepCar(car, c, K.DT); maxZ = Math.max(maxZ, car.pos.z); }
  assert.ok(maxZ > 500, `car climbed the wall to z=${maxZ.toFixed(0)}`);
});

test('aerials: jump, pitch up and boost flies the car high', () => {
  const car = makeCar(-1, v3(0, -2500, K.CAR_REST_HEIGHT), Math.PI / 2);
  car.boost = 100;
  const c = neutralControls(); c.jump = true; c.boost = true; c.pitch = 1; // nose up
  let maxZ = 0;
  for (let i = 0; i < 120 * 2; i++) {
    if (i > 24) c.pitch = 0; // stop pitching once pointed up
    stepCar(car, c, K.DT);
    maxZ = Math.max(maxZ, car.pos.z);
  }
  assert.ok(maxZ > 900, `aerial reached z=${maxZ.toFixed(0)}`);
});

test('flip hits: a front flip into the ball hits harder than driving into it', () => {
  const shot = (flip) => {
    const car = makeCar(-1, v3(0, -2400, K.CAR_REST_HEIGHT), Math.PI / 2);
    car.vel = v3(0, 1200, 0);
    const ball = makeBall(v3(0, -1900, 130));
    const c = neutralControls(); c.throttle = 1;
    let best = 0;
    for (let i = 1; i < 120; i++) {
      c.jump = flip && (i <= 3 || i === 12);
      c.stickY = flip && i >= 12 ? 1 : 0;
      stepCar(car, c, K.DT);
      const hit = collideCarBall(car, ball, i);
      if (hit) { best = Math.max(best, len(ball.vel)); break; }
    }
    return best;
  };
  const drive = shot(false), flip = shot(true);
  assert.ok(drive > 0 && flip > drive, `flip hit ${flip.toFixed(0)} > drive hit ${drive.toFixed(0)}`);
});

test('flip: float, cancel, pitch lock and backward-flip speed scale (RocketSim)', () => {
  const jumpThenFlip = (pitch, vel = v3(0, 0, 0)) => {
    const car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
    car.vel = vel;
    const c = neutralControls(); c.jump = true;
    for (let i = 0; i < 10; i++) stepCar(car, c, K.DT);
    c.jump = false; stepCar(car, c, K.DT); stepCar(car, c, K.DT);
    c.jump = true; c.pitch = pitch; stepCar(car, c, K.DT);
    c.jump = false;
    return { car, c };
  };
  // float: once falling, vertical speed keeps being cut 35%/tick until the flip ends
  const { car, c } = jumpThenFlip(-1);
  let maxFallDuringFlip = 0;
  while (car.flipTime < 0.6 && !car.onGround) { stepCar(car, c, K.DT); if (car.flipTime > 0.25) maxFallDuringFlip = Math.min(maxFallDuringFlip, car.vel.z); }
  assert.ok(maxFallDuringFlip > -60, `car floats (falls at most ${(-maxFallDuringFlip).toFixed(0)} uu/s mid-flip)`);

  // cancel: pull back right after a front flip -> rotation stops
  const a = jumpThenFlip(-1), b = jumpThenFlip(-1);
  const back = { ...b.c, pitch: 1 }; // pull back straight away
  for (let i = 0; i < 36; i++) { stepCar(a.car, a.c, K.DT); stepCar(b.car, back, K.DT); }
  const noseDown = (cc) => Math.asin(-cc.R.f.z) + (cc.R.u.z < 0 ? Math.PI / 2 : 0);
  assert.ok(noseDown(b.car) < 0.6 && noseDown(a.car) > 1.2,
    `flip cancel keeps the car level (${noseDown(b.car).toFixed(2)} rad) while a full flip rotates (${noseDown(a.car).toFixed(2)} rad)`);

  // pitch lock: pitch input does nothing until 0.95 s after the flip started
  const l1 = jumpThenFlip(-1), l2 = jumpThenFlip(-1);
  while (l1.car.flipTime < 0.7) { stepCar(l1.car, l1.c, K.DT); stepCar(l2.car, l2.c, K.DT); }
  const p = { ...l2.c, pitch: 1 };
  for (let i = 0; i < 12; i++) { stepCar(l1.car, l1.c, K.DT); stepCar(l2.car, p, K.DT); }
  near(toLocal(l2.car.R, l2.car.angVel).y, toLocal(l1.car.R, l1.car.angVel).y, 1e-9, 'pitch input ignored during 0.65-0.95 s');
  for (let i = 0; i < 40; i++) { stepCar(l1.car, l1.c, K.DT); stepCar(l2.car, p, K.DT); }
  assert.ok(Math.abs(toLocal(l2.car.R, l2.car.angVel).y - toLocal(l1.car.R, l1.car.angVel).y) > 0.3, 'pitch works again after 0.95 s');

  // backward flip at speed gets the 2.5x max-speed scale (x 16/15)
  const bk = jumpThenFlip(1, v3(0, 1150, 0));
  const fwd = bk.car.vel.y;
  const expected = 1150 - 500 * ((2.5 - 1) * (1150 / 2300) + 1) * (16 / 15);
  near(fwd, expected, 15, 'backflip impulse at 1150 uu/s');
});

test('air control uses RocketSim torque and damping', () => {
  const car = makeCar(-1, v3(0, -2000, 1000), Math.PI / 2);
  car.onGround = false;
  const c = neutralControls(); c.roll = 1;
  stepCar(car, c, K.DT);
  near(toLocal(car.R, car.angVel).x / K.DT, 400 * K.CAR_TORQUE_SCALE, 0.5, 'roll accel from rest');
  const car2 = makeCar(-1, v3(0, -2000, 1000), Math.PI / 2);
  car2.onGround = false;
  const p = neutralControls(); p.pitch = 1;
  stepCar(car2, p, K.DT);
  near(-toLocal(car2.R, car2.angVel).y / K.DT, 130 * K.CAR_TORQUE_SCALE, 0.5, 'pitch accel from rest');
});
