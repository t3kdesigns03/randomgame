// Car physics, ported from RocketSim (the open-source Rocket League sim RLBot uses; see constants.js):
//  - ground: per-wheel tyre friction like RL's Bullet raycast vehicle: steered front wheels, lateral
//    friction impulses (contact damping 0.2, LAT_FRICTION curve), engine/brake along each wheel, and an
//    analog handbrake (powerslide) that cuts lateral grip to 10% and blends the steer angle.
//  - jump / double jump / dodge with RL timings, flip cancel, pitch lock, the flip "float".
//  - air control with RL torque / damping, boost with a 0.1 s minimum, supersonic hysteresis.
// Wall driving uses the arena SDF; the collision volume is the Octane OBB (see collide.js).
import * as K from './constants.js';
import {
  v3, clone, dot, cross, len, scale, sub, norm, clampLen, clamp, curve, lerp,
  toLocal, toWorld, integrateBasis, rotateAxis, basisFromUpForward, orthonormalize,
} from './vec.js';
import { arenaQuery } from './arena.js';

export const neutralControls = () => ({
  throttle: 0, steer: 0, // ground
  pitch: 0, yaw: 0, roll: 0, // air (pitch +1 = nose up)
  stickX: 0, stickY: 0, // raw stick (right +, forward +) used for dodge direction
  boost: false, jump: false, handbrake: false,
});

/**
 * team: -1 = player (south half, y < 0), +1 = bot (north half, y > 0).
 * profile.flipBuffer: seconds a neutral-stick 2nd jump waits for a stick flick before becoming a
 * double jump (touch = generous, keyboard = 0). profile.deadzone: stick magnitude needed to flip.
 */
export function makeCar(team, pos, yaw, profile = {}) {
  const f = v3(Math.cos(yaw), Math.sin(yaw), 0);
  const car = {
    team,
    pos: clone(pos),
    vel: v3(),
    angVel: v3(),
    R: { f, l: cross(v3(0, 0, 1), f), u: v3(0, 0, 1) },
    boost: K.BOOST_START,
    onGround: true,
    groundN: v3(0, 0, 1),
    jumping: false, jumpTime: 0, hasJumped: false, hasDoubleJumped: false,
    dodgeTimer: 0, // time since first jump ended
    flipping: false, flipTime: 0, flipDir: { x: 0, y: 0 },
    pendingDodge: -1, // >= 0 while waiting for a stick flick (touch flip buffer)
    supersonic: false, supersonicTime: 0, boosting: false, boostTime: 0,
    handbrakeVal: 0, powersliding: false, // analog handbrake 0..1 (RL ramps it)
    hasFlipped: false, flipTorque: { x: 0, y: 0 },
    contactTime: 0, // time spent touching a surface while not on wheels (auto-right)
    prevJump: false,
    lastExtraImpulseTick: -10,
    profile: { flipBuffer: 0, deadzone: K.DODGE_DEADZONE, ...profile },
    events: [], // 'jump' | 'doublejump' | 'flip' | 'land'
  };
  car.pos.z = Math.max(car.pos.z, K.CAR_REST_HEIGHT);
  return car;
}

export function resetCar(car, pos, yaw) {
  const fresh = makeCar(car.team, pos, yaw, car.profile);
  Object.assign(car, fresh);
}

export const carSpeed = (car) => len(car.vel);

/** World-space centre of the car OBB. */
export function hitboxCenter(car) {
  return {
    x: car.pos.x + car.R.f.x * K.CAR_HITBOX_OFFSET.x + car.R.u.x * K.CAR_HITBOX_OFFSET.z,
    y: car.pos.y + car.R.f.y * K.CAR_HITBOX_OFFSET.x + car.R.u.y * K.CAR_HITBOX_OFFSET.z,
    z: car.pos.z + car.R.f.z * K.CAR_HITBOX_OFFSET.x + car.R.u.z * K.CAR_HITBOX_OFFSET.z,
  };
}

const HX = K.CAR_HITBOX.x / 2, HY = K.CAR_HITBOX.y / 2, HZ = K.CAR_HITBOX.z / 2;

export function hitboxCorners(car) {
  const c = hitboxCenter(car);
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out.push({
      x: c.x + car.R.f.x * HX * sx + car.R.l.x * HY * sy + car.R.u.x * HZ * sz,
      y: c.y + car.R.f.y * HX * sx + car.R.l.y * HY * sy + car.R.u.y * HZ * sz,
      z: c.z + car.R.f.z * HX * sx + car.R.l.z * HY * sy + car.R.u.z * HZ * sz,
    });
  }
  return out;
}

const _q = { d: 0, n: { x: 0, y: 0, z: 1 } };

// [RL] constant gravity for cars (RocketSim GRAVITY_Z = -650 at every speed)
const carGravity = () => K.GRAVITY;

/** RL dodge: direction from the air-control inputs (dodgeDir = (-pitch, yaw + roll)). */
function startFlip(car, c) {
  let dx = -c.pitch, dy = c.yaw + c.roll; // forward +, right +
  if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) { dx = 0; dy = 0; } // stall: a flip with no impulse / torque
  else { const m = Math.hypot(dx, dy); dx /= m; dy /= m; }
  const f2 = norm(v3(car.R.f.x, car.R.f.y, 0));
  const r2 = v3(f2.y, -f2.x, 0);
  const forwardSpeed = dot(car.vel, f2);
  const ratio = Math.abs(forwardSpeed) / K.CAR_MAX_SPEED;
  const backwards = Math.abs(forwardSpeed) < 100 ? dx < 0 : (dx >= 0) !== (forwardSpeed >= 0);
  let ix = dx * K.FLIP_INITIAL_VEL;
  let iy = dy * K.FLIP_INITIAL_VEL;
  const maxScaleX = backwards ? K.FLIP_BACKWARD_MAX_SPEED_SCALE : K.FLIP_FORWARD_MAX_SPEED_SCALE;
  ix *= (maxScaleX - 1) * ratio + 1;
  iy *= (K.FLIP_SIDE_MAX_SPEED_SCALE - 1) * ratio + 1;
  if (backwards) ix *= K.FLIP_BACKWARD_IMPULSE_SCALE_X;
  car.vel.x += f2.x * ix + r2.x * iy;
  car.vel.y += f2.y * ix + r2.y * iy;
  car.flipping = true;
  car.hasFlipped = true;
  car.flipTime = 0;
  car.flipDir = { x: dx, y: dy };
  // torque components under 0.1 are dropped (RL)
  car.flipTorque = { x: Math.abs(dx) < 0.1 ? 0 : dx, y: Math.abs(dy) < 0.1 ? 0 : dy };
  car.hasDoubleJumped = true;
  car.pendingDodge = -1;
  car.events.push('flip');
}

function doubleJump(car) {
  car.vel.x += car.R.u.x * K.DOUBLE_JUMP_IMPULSE;
  car.vel.y += car.R.u.y * K.DOUBLE_JUMP_IMPULSE;
  car.vel.z += car.R.u.z * K.DOUBLE_JUMP_IMPULSE;
  car.hasDoubleJumped = true;
  car.pendingDodge = -1;
  car.events.push('doublejump');
}

function land(car, n) {
  car.onGround = true;
  car.groundN = clone(n);
  const R = basisFromUpForward(n, car.R.f);
  car.R = R;
  car.angVel = scale(n, dot(car.angVel, n)); // wheels kill pitch/roll spin; yaw spin carries into the drive
  const vn = dot(car.vel, n);
  if (vn < 0) car.vel = sub(car.vel, scale(n, vn));
  car.jumping = false; car.hasJumped = false; car.hasDoubleJumped = false; car.hasFlipped = false;
  car.flipping = false; car.pendingDodge = -1; car.dodgeTimer = 0; car.contactTime = 0;
  car.events.push('land');
}

/** Advance one car by one tick. */
export function stepCar(car, c, dt) {
  car.events.length = 0;
  const jumpPressed = c.jump && !car.prevJump;
  car.prevJump = c.jump;

  // ---- boost (RL: once started, boosts for at least 0.1 s) ----
  car.boosting = car.boost > 0 && (c.boost || (car.boosting && car.boostTime < K.BOOST_MIN_TIME));
  if (car.boosting) {
    car.boostTime += dt;
    car.boost = Math.max(0, car.boost - K.BOOST_USE_PER_SEC * dt);
  } else car.boostTime = 0;

  // ---- handbrake: analog, ramps up in 0.2 s and down in 0.5 s ----
  car.handbrakeVal = clamp(car.handbrakeVal + (c.handbrake ? K.POWERSLIDE_RISE_RATE : -K.POWERSLIDE_FALL_RATE) * dt, 0, 1);

  if (car.onGround) groundStep(car, c, dt, jumpPressed);
  else airStep(car, c, dt, jumpPressed);

  // ---- speed cap, supersonic ----
  car.vel = clampLen(car.vel, K.CAR_MAX_SPEED);
  const sp = len(car.vel);
  if (sp >= K.CAR_SUPERSONIC) { car.supersonic = true; car.supersonicTime = 0; }
  else if (car.supersonic && sp >= K.CAR_SUPERSONIC_MAINTAIN && car.supersonicTime < K.CAR_SUPERSONIC_MAINTAIN_TIME) car.supersonicTime += dt;
  else car.supersonic = false;
  car.angVel = clampLen(car.angVel, K.CAR_MAX_ANG_SPEED);

  // ---- integrate ----
  car.pos.x += car.vel.x * dt; car.pos.y += car.vel.y * dt; car.pos.z += car.vel.z * dt;
  if (!car.onGround) integrateBasis(car.R, car.angVel, dt);

  surfaceResolve(car, dt);
  centreBarrier(car);
}

const INV_MASS = 1 / K.CAR_MASS;
const INV_IYAW = 1 / K.CAR_INERTIA.z;

function groundStep(car, c, dt, jumpPressed) {
  const n = car.groundN;
  const hb = car.handbrakeVal;
  car.powersliding = hb > 0;

  if (jumpPressed) {
    car.onGround = false;
    car.jumping = true; car.jumpTime = 0; car.hasJumped = true;
    car.vel.x += car.R.u.x * K.JUMP_IMPULSE;
    car.vel.y += car.R.u.y * K.JUMP_IMPULSE;
    car.vel.z += car.R.u.z * K.JUMP_IMPULSE;
    car.events.push('jump');
    airStep(car, c, dt, false);
    return;
  }

  const f = car.R.f, l = car.R.l;
  const fwd = dot(car.vel, f);
  const absF = Math.abs(fwd);

  // ---- throttle / brake (RocketSim Car::_UpdateWheels) ----
  const realThrottle = car.boosting ? 1 : c.throttle;
  let engineThrottle = 0, brake = 0;
  if (c.handbrake) {
    engineThrottle = realThrottle; // powersliding: no braking, no coasting drag
  } else if (Math.abs(realThrottle) >= K.THROTTLE_DEADZONE) {
    if (absF > K.STOPPING_FORWARD_VEL && Math.sign(realThrottle) !== Math.sign(fwd)) brake = 1;
    else engineThrottle = realThrottle;
  } else {
    brake = absF < K.STOPPING_FORWARD_VEL ? 1 : K.COASTING_BRAKE_FACTOR;
  }
  const driveAccel = engineThrottle * K.THROTTLE_ACCEL_PER_WHEEL * curve(K.DRIVE_SPEED_TORQUE_FACTOR_CURVE, absF);

  // ---- steering: front wheels turn; powerslide blends toward its own steer curve ----
  let steerAngle = curve(K.STEER_ANGLE_FROM_SPEED_CURVE, absF);
  if (hb > 0) steerAngle += (curve(K.POWERSLIDE_STEER_ANGLE_FROM_SPEED_CURVE, absF) - steerAngle) * hb;
  steerAngle *= c.steer; // + = right
  const cs = Math.cos(steerAngle), sn = Math.sin(steerAngle);
  const ff = v3(f.x * cs - l.x * sn, f.y * cs - l.y * sn, f.z * cs - l.z * sn); // steered wheel forward
  const fl = v3(l.x * cs + f.x * sn, l.y * cs + f.y * sn, l.z * cs + f.z * sn); // steered wheel axle

  // not throttling: grip fades on steep surfaces (slide down walls)
  const nonSticky = realThrottle !== 0 ? 1 : curve(K.NON_STICKY_FRICTION_FACTOR_CURVE, n.z);

  // ---- per-wheel tyre impulses, all from the same pre-impulse state (as RL) ----
  let yawRate = dot(car.angVel, n);
  let jx = 0, jy = 0, jz = 0, jYaw = 0;
  for (const w of K.WHEELS) {
    const r = v3(f.x * w.x + l.x * w.y, f.y * w.x + l.y * w.y, f.z * w.x + l.z * w.y); // planar contact offset
    const nr = cross(n, r);
    const vc = v3(car.vel.x + yawRate * nr.x, car.vel.y + yawRate * nr.y, car.vel.z + yawRate * nr.z);
    const wf = w.front ? ff : f, wl = w.front ? fl : l;
    const latV = dot(vc, wl), longV = dot(vc, wf);
    const base = Math.abs(latV);
    const input = base > 5 ? base / (Math.abs(longV) + base) : 0;
    let latF = curve(K.LAT_FRICTION_CURVE, input), longF = 1;
    if (hb > 0) {
      latF *= (K.HANDBRAKE_LAT_FRICTION_FACTOR - 1) * hb + 1;
      longF *= (curve(K.HANDBRAKE_LONG_FRICTION_FACTOR_CURVE, input) - 1) * hb + 1;
    }
    latF *= nonSticky; longF *= nonSticky;

    // lateral: Bullet resolveSingleBilateral (-0.2 * slip * effective mass), * mass/3 * dt (RocketSim)
    const rxl = dot(cross(r, wl), n);
    const sideImpulse = -K.WHEEL_CONTACT_DAMPING * latV / (INV_MASS + rxl * rxl * INV_IYAW);
    const jLat = sideImpulse * latF * (K.CAR_MASS / 3) * dt;
    // longitudinal: engine along the wheel, else brake toward zero rolling speed
    let jLong = 0;
    if (driveAccel !== 0) jLong = driveAccel * longF * K.CAR_MASS * dt;
    else if (brake > 0) jLong = -Math.sign(longV) * Math.min((K.BRAKE_ACCEL / 4) * brake * dt, Math.abs(longV) * 0.25) * longF * K.CAR_MASS;

    const jw = v3(wl.x * jLat + wf.x * jLong, wl.y * jLat + wf.y * jLong, wl.z * jLat + wf.z * jLong);
    jx += jw.x; jy += jw.y; jz += jw.z;
    jYaw += dot(cross(r, jw), n);
  }
  car.vel.x += jx * INV_MASS; car.vel.y += jy * INV_MASS; car.vel.z += jz * INV_MASS;
  // boost: central force along the car's nose (on top of the full-throttle engine)
  if (car.boosting) {
    car.vel.x += f.x * K.BOOST_ACCEL_GROUND * dt; car.vel.y += f.y * K.BOOST_ACCEL_GROUND * dt; car.vel.z += f.z * K.BOOST_ACCEL_GROUND * dt;
  }
  yawRate = clamp(yawRate + jYaw * INV_IYAW, -K.CAR_MAX_ANG_SPEED, K.CAR_MAX_ANG_SPEED);

  // ---- yaw the car about the surface normal ----
  const dYaw = yawRate * dt;
  if (Math.abs(dYaw) > 1e-9) {
    car.R.f = rotateAxis(car.R.f, n, dYaw);
    car.R.l = rotateAxis(car.R.l, n, dYaw);
  }
  car.angVel = scale(n, yawRate);

  // ---- gravity vs sticky force ----
  const g = carGravity(car);
  const gn = -g * n.z; // gravity's pull away from the surface (+ on ceilings)
  car.vel.x -= n.x * gn * dt; car.vel.y -= n.y * gn * dt;
  car.vel.z += (-g - n.z * gn) * dt;
  const fullStick = realThrottle !== 0 || absF > K.STOPPING_FORWARD_VEL;
  const sticky = (K.STICKY_FORCE_SCALE + (fullStick ? 1 - Math.abs(n.z) : 0)) * K.GRAVITY;
  if (gn > sticky) {
    // pulled off the surface (e.g. ceiling, or a wall too slow)
    car.onGround = false;
    car.hasJumped = false;
    return;
  }
  const vn = dot(car.vel, n);
  car.vel.x -= n.x * vn; car.vel.y -= n.y * vn; car.vel.z -= n.z * vn;
}

function airStep(car, c, dt, jumpPressed) {
  car.powersliding = false;
  // jump hold (62% accel during the first 0.025 s)
  if (car.jumping) {
    if ((c.jump && car.jumpTime < K.JUMP_MAX_HOLD) || car.jumpTime < K.JUMP_MIN_HOLD) {
      const a = K.JUMP_HOLD_ACCEL * (car.jumpTime < K.JUMP_MIN_HOLD ? K.JUMP_MIN_HOLD_ACCEL_SCALE : 1);
      car.vel.x += car.R.u.x * a * dt;
      car.vel.y += car.R.u.y * a * dt;
      car.vel.z += car.R.u.z * a * dt;
      car.jumpTime += dt;
    } else {
      car.jumping = false;
    }
  } else if (car.hasJumped) {
    car.dodgeTimer += dt;
  }

  // second jump: double jump or dodge (flip input = |pitch| + |yaw| + |roll| >= deadzone)
  const canDodge = !car.hasDoubleJumped && !car.hasFlipped && !car.flipping && !car.jumping &&
    (!car.hasJumped || car.dodgeTimer < K.DODGE_WINDOW);
  const flipInput = Math.abs(c.pitch) + Math.abs(c.yaw) + Math.abs(c.roll) >= car.profile.deadzone;
  if (jumpPressed && canDodge) {
    if (flipInput) startFlip(car, c);
    else if (car.profile.flipBuffer > 0) car.pendingDodge = 0;
    else doubleJump(car);
  } else if (car.pendingDodge >= 0) {
    car.pendingDodge += dt;
    if (flipInput) startFlip(car, c);
    else if (car.pendingDodge >= car.profile.flipBuffer) doubleJump(car);
  }

  car.vel.z -= carGravity(car) * dt;

  // boost / air throttle along forward
  if (car.boosting) {
    car.vel.x += car.R.f.x * K.BOOST_ACCEL_AIR * dt;
    car.vel.y += car.R.f.y * K.BOOST_ACCEL_AIR * dt;
    car.vel.z += car.R.f.z * K.BOOST_ACCEL_AIR * dt;
  } else if (Math.abs(c.throttle) > K.THROTTLE_DEADZONE) {
    const a = K.AIR_THROTTLE_ACCEL * c.throttle;
    car.vel.x += car.R.f.x * a * dt; car.vel.y += car.R.f.y * a * dt; car.vel.z += car.R.f.z * a * dt;
  }

  // ---- rotation: flip torque, else air control (local: x = roll right +, y = nose down +, z = yaw left +) ----
  const w = toLocal(car.R, car.angVel);
  let doAirControl = true;
  let pitchScale = 1;
  const alpha = v3();
  if (car.hasFlipped) car.flipTime += dt;
  if (car.flipping && car.flipTime >= K.FLIP_DURATION) car.flipping = false;
  if (car.flipping) {
    pitchScale = 0;
    const t = car.flipTorque;
    if (t.x !== 0 || t.y !== 0) {
      doAirControl = false;
      let tx = t.x;
      // flip cancel: pulling the stick against the flip's pitch stops the rotation
      if (tx !== 0 && c.pitch !== 0 && Math.sign(-c.pitch) !== Math.sign(tx)) {
        tx *= 1 - Math.min(Math.abs(c.pitch), 1);
        doAirControl = true;
      }
      alpha.y += tx * K.FLIP_TORQUE_PITCH;
      alpha.x += t.y * K.FLIP_TORQUE_ROLL;
    }
    // the float: cut vertical speed 35% per 120 Hz tick from 0.15 s (while falling, or before 0.21 s)
    if (car.flipTime >= K.FLIP_Z_DAMP_START && (car.vel.z < 0 || car.flipTime < K.FLIP_Z_DAMP_END)) {
      car.vel.z *= Math.pow(1 - K.FLIP_Z_DAMP_PER_TICK, dt * 120);
    }
  } else if (car.hasFlipped && car.flipTime < K.FLIP_DURATION + K.FLIP_PITCHLOCK_EXTRA_TIME) {
    pitchScale = 0; // pitch lock just after a flip
  }
  if (doAirControl) {
    const p = c.pitch * pitchScale;
    alpha.x += K.AIR_TORQUE.roll * c.roll - K.AIR_DAMP.roll * w.x;
    alpha.y += -K.AIR_TORQUE.pitch * p - K.AIR_DAMP.pitch * (1 - Math.abs(p)) * w.y;
    alpha.z += -K.AIR_TORQUE.yaw * c.yaw - K.AIR_DAMP.yaw * (1 - Math.abs(c.yaw)) * w.z;
  }
  const aw = toWorld(car.R, alpha);
  car.angVel = clampLen(
    { x: car.angVel.x + aw.x * dt, y: car.angVel.y + aw.y * dt, z: car.angVel.z + aw.z * dt },
    K.CAR_MAX_ANG_SPEED,
  );
}

/** Keep the car on/inside the arena: wheels-on-surface snapping, landing, OBB corner contacts. */
function surfaceResolve(car, dt) {
  const q = arenaQuery(car.pos, _q);
  const n = { x: q.n.x, y: q.n.y, z: q.n.z };
  if (car.onGround) {
    if (q.d < K.CAR_REST_HEIGHT + 60) {
      // follow the surface (floor, ramps, walls, ceiling)
      car.pos.x += n.x * (K.CAR_REST_HEIGHT - q.d);
      car.pos.y += n.y * (K.CAR_REST_HEIGHT - q.d);
      car.pos.z += n.z * (K.CAR_REST_HEIGHT - q.d);
      car.groundN = n;
      car.R = basisFromUpForward(n, car.R.f);
      const sp = len(car.vel);
      const vt = sub(car.vel, scale(n, dot(car.vel, n)));
      const vtl = len(vt);
      car.vel = vtl > 1e-6 ? scale(vt, sp / vtl) : v3();
      return;
    }
    car.onGround = false;
  }

  // airborne: land on wheels?
  const upDot = dot(car.R.u, n);
  if (q.d <= K.CAR_REST_HEIGHT && upDot > 0.3 && dot(car.vel, n) <= 50 && !car.jumping) {
    car.pos.x += n.x * (K.CAR_REST_HEIGHT - q.d);
    car.pos.y += n.y * (K.CAR_REST_HEIGHT - q.d);
    car.pos.z += n.z * (K.CAR_REST_HEIGHT - q.d);
    land(car, n);
    return;
  }

  // OBB corners vs arena (roof / side landings, ceiling hits)
  let touched = false;
  for (const p of hitboxCorners(car)) {
    const cq = arenaQuery(p, _q);
    if (cq.d < 0) {
      touched = true;
      const cn = cq.n;
      car.pos.x -= cn.x * cq.d; car.pos.y -= cn.y * cq.d; car.pos.z -= cn.z * cq.d;
      const vn = dot(car.vel, cn);
      if (vn < 0) {
        // [RL] car-world contact: restitution 0.3, Coulomb friction 0.3
        const jn = -(1 + K.CARWORLD_RESTITUTION) * vn;
        car.vel.x += cn.x * jn; car.vel.y += cn.y * jn; car.vel.z += cn.z * jn;
        const vt = sub(car.vel, scale(cn, dot(car.vel, cn)));
        const vtl = len(vt);
        if (vtl > 1e-6) car.vel = sub(car.vel, scale(vt, Math.min(1, (K.CARWORLD_FRICTION * jn) / vtl)));
        car.angVel = scale(car.angVel, 0.6);
      }
    }
  }
  if (touched) {
    car.contactTime += dt;
    // Auto-right (V1 simplification of RL's turtle recovery): after 0.5 s on roof/side, land upright.
    if (car.contactTime > 0.5 && len(car.vel) < 400) {
      const q2 = arenaQuery(car.pos, _q);
      const n2 = { x: q2.n.x, y: q2.n.y, z: q2.n.z };
      car.pos.x += n2.x * (K.CAR_REST_HEIGHT - q2.d);
      car.pos.y += n2.y * (K.CAR_REST_HEIGHT - q2.d);
      car.pos.z += n2.z * (K.CAR_REST_HEIGHT - q2.d);
      land(car, n2);
    }
  } else {
    car.contactTime = 0;
  }
}

/** Cars cannot cross the centre plane (y = 0): invisible car-only wall above the net. */
function centreBarrier(car) {
  let extreme = -Infinity;
  for (const p of hitboxCorners(car)) {
    const v = p.y * -car.team; // distance past the barrier toward the opponent's half
    if (v > extreme) extreme = v;
  }
  const over = extreme - K.CAR_CENTER_BARRIER;
  if (over > 0) {
    car.pos.y -= -car.team * over;
    const vy = car.vel.y * -car.team;
    if (vy > 0) car.vel.y = 0;
  }
}

export { orthonormalize };
