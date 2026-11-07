// Car: RL-style grounded driving (throttle/steer curves, powerslide, wall driving via the arena SDF),
// jump / double jump / dodge with RL timings, air control, boost. Collision volume = OBB (see collide.js).
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
    supersonic: false, boosting: false, powersliding: false,
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

function carGravity(car) {
  // Spec: gravity weakens slightly with speed, 650 at rest -> 626 at max speed.
  const t = clamp(len(car.vel) / K.CAR_MAX_SPEED, 0, 1);
  return lerp(K.GRAVITY, K.CAR_GRAVITY_AT_MAX_SPEED, t);
}

function startFlip(car, dx, dy) {
  // dx = forward component, dy = right component (normalised stick)
  const m = Math.hypot(dx, dy) || 1;
  dx /= m; dy /= m;
  const f2 = norm(v3(car.R.f.x, car.R.f.y, 0));
  const r2 = v3(f2.y, -f2.x, 0);
  const forwardSpeed = dot(car.vel, f2);
  const ratio = Math.abs(forwardSpeed) / K.CAR_MAX_SPEED;
  const backwards = Math.abs(forwardSpeed) < 100 ? dx < 0 : (dx >= 0) !== (forwardSpeed > 0);
  let ix = dx * K.FLIP_INITIAL_VEL;
  let iy = dy * K.FLIP_INITIAL_VEL;
  const maxScaleX = backwards ? K.FLIP_BACKWARD_MAX_SPEED_SCALE : K.FLIP_FORWARD_MAX_SPEED_SCALE;
  ix *= (maxScaleX - 1) * ratio + 1;
  iy *= (K.FLIP_SIDE_MAX_SPEED_SCALE - 1) * ratio + 1;
  if (backwards) ix *= K.FLIP_BACKWARD_IMPULSE_SCALE_X;
  car.vel.x += f2.x * ix + r2.x * iy;
  car.vel.y += f2.y * ix + r2.y * iy;
  car.flipping = true;
  car.flipTime = 0;
  car.flipDir = { x: dx, y: dy };
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
  car.angVel = v3();
  const vn = dot(car.vel, n);
  if (vn < 0) car.vel = sub(car.vel, scale(n, vn));
  car.jumping = false; car.hasJumped = false; car.hasDoubleJumped = false;
  car.flipping = false; car.pendingDodge = -1; car.dodgeTimer = 0; car.contactTime = 0;
  car.events.push('land');
}

/** Advance one car by one tick. */
export function stepCar(car, c, dt) {
  car.events.length = 0;
  const jumpPressed = c.jump && !car.prevJump;
  car.prevJump = c.jump;

  // ---- boost ----
  car.boosting = c.boost && car.boost > 0;
  if (car.boosting) car.boost = Math.max(0, car.boost - K.BOOST_USE_PER_SEC * dt);

  if (car.onGround) groundStep(car, c, dt, jumpPressed);
  else airStep(car, c, dt, jumpPressed);

  // ---- speed cap, supersonic ----
  car.vel = clampLen(car.vel, K.CAR_MAX_SPEED);
  const sp = len(car.vel);
  car.supersonic = car.supersonic ? sp >= K.CAR_SUPERSONIC_MAINTAIN : sp >= K.CAR_SUPERSONIC;

  // ---- integrate ----
  car.pos.x += car.vel.x * dt; car.pos.y += car.vel.y * dt; car.pos.z += car.vel.z * dt;
  if (!car.onGround) integrateBasis(car.R, car.angVel, dt);

  surfaceResolve(car, dt);
  centreBarrier(car);
}

function groundStep(car, c, dt, jumpPressed) {
  const n = car.groundN;
  car.powersliding = c.handbrake;

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

  const s = dot(car.vel, car.R.f);
  const absS = Math.abs(s);

  // steering: kinematic curvature model
  const kappa = curve(K.STEER_CURVATURE, absS);
  let yawRate = -c.steer * kappa * s; // + = left about n
  if (c.handbrake) yawRate *= K.POWERSLIDE_TURN_SCALE;
  const dYaw = yawRate * dt;
  if (Math.abs(dYaw) > 1e-9) {
    car.R.f = rotateAxis(car.R.f, n, dYaw);
    car.R.l = rotateAxis(car.R.l, n, dYaw);
    // tyres carry the velocity round with the car; powersliding lets the car rotate past its velocity
    car.vel = rotateAxis(car.vel, n, dYaw * (c.handbrake ? 0.25 : 1));
  }

  // lateral grip
  const lat = dot(car.vel, car.R.l);
  const damp = c.handbrake ? K.POWERSLIDE_LATERAL_DAMP : K.GRIP_LATERAL_DAMP;
  const kill = lat * (1 - Math.exp(-damp * dt));
  car.vel.x -= car.R.l.x * kill; car.vel.y -= car.R.l.y * kill; car.vel.z -= car.R.l.z * kill;

  // throttle / brake / coast / boost along forward
  const fs = dot(car.vel, car.R.f);
  let a = 0;
  const throttle = car.boosting ? 1 : c.throttle;
  if (car.boosting) {
    a = K.BOOST_ACCEL_GROUND + (fs >= 0 ? curve(K.THROTTLE_ACCEL_CURVE, Math.abs(fs)) : K.BRAKE_ACCEL);
  } else if (Math.abs(throttle) > 0.01) {
    if (Math.abs(fs) < 1 || Math.sign(throttle) === Math.sign(fs)) {
      a = throttle * curve(K.THROTTLE_ACCEL_CURVE, Math.abs(fs));
    } else {
      a = Math.sign(throttle) * K.BRAKE_ACCEL; // braking toward zero
      if (Math.abs(a * dt) > Math.abs(fs)) a = -fs / dt;
    }
  } else if (Math.abs(fs) > 0) {
    a = -Math.sign(fs) * Math.min(K.COAST_DECEL, Math.abs(fs) / dt);
  }
  car.vel.x += car.R.f.x * a * dt; car.vel.y += car.R.f.y * a * dt; car.vel.z += car.R.f.z * a * dt;

  // gravity: tangential part slides the car on ramps/walls; normal part vs sticky force
  const g = carGravity(car);
  const gn = -g * n.z; // dot((0,0,-g), n)
  car.vel.x -= n.x * gn * dt; car.vel.y -= n.y * gn * dt;
  car.vel.z += (-g - n.z * gn) * dt;
  const sticky = K.STICKY_FORCE_SCALE * K.GRAVITY + (Math.abs(throttle) > 0.01 ? (1 - Math.abs(n.z)) * K.GRAVITY : 0);
  if (gn > sticky) {
    // pulled off the surface (e.g. ceiling without throttle)
    car.onGround = false;
    car.hasJumped = false;
    return;
  }
  const vn = dot(car.vel, n);
  car.vel.x -= n.x * vn; car.vel.y -= n.y * vn; car.vel.z -= n.z * vn;
  car.angVel = v3();
}

function airStep(car, c, dt, jumpPressed) {
  car.powersliding = false;
  // jump hold
  if (car.jumping) {
    car.jumpTime += dt;
    if ((c.jump && car.jumpTime < K.JUMP_MAX_HOLD) || car.jumpTime < K.JUMP_MIN_HOLD) {
      car.vel.x += car.R.u.x * K.JUMP_HOLD_ACCEL * dt;
      car.vel.y += car.R.u.y * K.JUMP_HOLD_ACCEL * dt;
      car.vel.z += car.R.u.z * K.JUMP_HOLD_ACCEL * dt;
    } else {
      car.jumping = false;
    }
  } else if (car.hasJumped) {
    car.dodgeTimer += dt;
  }

  // second jump: double jump or dodge
  const canDodge = !car.hasDoubleJumped && !car.flipping && !car.jumping &&
    (!car.hasJumped || car.dodgeTimer < K.DODGE_WINDOW);
  const stickMag = Math.max(Math.abs(c.stickX), Math.abs(c.stickY));
  if (jumpPressed && canDodge) {
    if (stickMag >= car.profile.deadzone) startFlip(car, c.stickY, c.stickX);
    else if (car.profile.flipBuffer > 0) car.pendingDodge = 0;
    else doubleJump(car);
  } else if (car.pendingDodge >= 0) {
    car.pendingDodge += dt;
    if (stickMag >= car.profile.deadzone) startFlip(car, c.stickY, c.stickX);
    else if (car.pendingDodge >= car.profile.flipBuffer) doubleJump(car);
  }

  // gravity (weakens slightly with speed — cars only)
  car.vel.z -= carGravity(car) * dt;

  // boost / air throttle along forward
  if (car.boosting) {
    car.vel.x += car.R.f.x * K.BOOST_ACCEL_AIR * dt;
    car.vel.y += car.R.f.y * K.BOOST_ACCEL_AIR * dt;
    car.vel.z += car.R.f.z * K.BOOST_ACCEL_AIR * dt;
  } else if (Math.abs(c.throttle) > 0.01) {
    const a = K.AIR_THROTTLE_ACCEL * c.throttle;
    car.vel.x += car.R.f.x * a * dt; car.vel.y += car.R.f.y * a * dt; car.vel.z += car.R.f.z * a * dt;
  }

  // air control (local: x = roll right +, y = nose down +, z = yaw left +)
  const w = toLocal(car.R, car.angVel);
  const alpha = v3(
    K.AIR_TORQUE.roll * c.roll - K.AIR_DAMP.roll * w.x,
    -K.AIR_TORQUE.pitch * c.pitch - K.AIR_DAMP.pitch * (1 - Math.abs(c.pitch)) * w.y,
    -K.AIR_TORQUE.yaw * c.yaw - K.AIR_DAMP.yaw * (1 - Math.abs(c.yaw)) * w.z,
  );
  if (car.flipping) {
    car.flipTime += dt;
    if (car.flipTime <= K.FLIP_DURATION) {
      // flip torque replaces pitch/roll control for the duration of the dodge
      alpha.y = car.flipDir.x * K.FLIP_TORQUE_PITCH;
      alpha.x = car.flipDir.y * K.FLIP_TORQUE_ROLL;
    } else {
      car.flipping = false;
    }
    // Spec float: normal vertical momentum for 0.15 s, then vertical speed -35% per tick (until 0.21 s)
    if (car.flipTime >= K.FLIP_Z_DAMP_START && car.flipTime <= K.FLIP_Z_DAMP_END) {
      car.vel.z *= 1 - K.FLIP_Z_DAMP_PER_TICK;
    }
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
        car.vel.x -= cn.x * vn; car.vel.y -= cn.y * vn; car.vel.z -= cn.z * vn;
        // surface friction on the body
        car.vel = scale(car.vel, 0.92);
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
