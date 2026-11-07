// Ball vs car OBB collision.
//  1) Inelastic (restitution 0) rigid-body impulse at the contact point with Coulomb friction
//     (mu = 2.0), using the full car inertia tensor and the ball's sphere inertia.
//  2) Psyonix's extra impulse: added to the BALL ONLY. It deliberately breaks Newton's 3rd law —
//     the car does not receive an equal and opposite push, so momentum is not conserved on a hit.
import * as K from './constants.js';
import {
  v3, dot, cross, len, scale, sub, add, norm, curve, toLocal, toWorld, m3inv, m3mulv, worldInvInertia, clampLen,
} from './vec.js';
import { hitboxCenter } from './car.js';

const HALF = { x: K.CAR_HITBOX.x / 2, y: K.CAR_HITBOX.y / 2, z: K.CAR_HITBOX.z / 2 };
const CAR_INV_I = { x: 1 / K.CAR_INERTIA.x, y: 1 / K.CAR_INERTIA.y, z: 1 / K.CAR_INERTIA.z };

/** Closest-point test between the ball sphere and the car OBB. */
export function carBallContact(car, ball) {
  const c = hitboxCenter(car);
  const local = toLocal(car.R, sub(ball.pos, c));
  const cl = {
    x: Math.max(-HALF.x, Math.min(HALF.x, local.x)),
    y: Math.max(-HALF.y, Math.min(HALF.y, local.y)),
    z: Math.max(-HALF.z, Math.min(HALF.z, local.z)),
  };
  let diff = sub(local, cl);
  let dist = len(diff);
  let nLocal;
  if (dist > 1e-6) {
    if (dist >= ball.radius) return null;
    nLocal = scale(diff, 1 / dist);
  } else {
    // ball centre inside the box (fast hit / tunnelling): exit through the nearest face
    const px = HALF.x - Math.abs(local.x), py = HALF.y - Math.abs(local.y), pz = HALF.z - Math.abs(local.z);
    if (px <= py && px <= pz) { nLocal = v3(Math.sign(local.x) || 1, 0, 0); cl.x = HALF.x * nLocal.x; dist = -px; }
    else if (py <= pz) { nLocal = v3(0, Math.sign(local.y) || 1, 0); cl.y = HALF.y * nLocal.y; dist = -py; }
    else { nLocal = v3(0, 0, Math.sign(local.z) || 1); cl.z = HALF.z * nLocal.z; dist = -pz; }
  }
  const n = toWorld(car.R, nLocal);
  const p = add(c, toWorld(car.R, cl));
  return { n, p, depth: ball.radius - dist };
}

const skew = (r) => [0, -r.z, r.y, r.z, 0, -r.x, -r.y, r.x, 0];
const mmul = (a, b) => {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return o;
};

/**
 * Resolve a ball-car hit. Returns null when not touching, else info about the hit.
 * `tick` is the global tick counter (extra impulse is skipped on consecutive ticks, as in RL).
 */
export function collideCarBall(car, ball, tick) {
  const hit = carBallContact(car, ball);
  if (!hit) return null;
  const { n, p, depth } = hit;

  // push the ball out of the car (ball is 6x lighter; car keeps its line)
  ball.pos.x += n.x * depth; ball.pos.y += n.y * depth; ball.pos.z += n.z * depth;
  const pc = { x: p.x + n.x * depth, y: p.y + n.y * depth, z: p.z + n.z * depth };

  const preBallVel = { ...ball.vel };
  const preCarVel = { ...car.vel };

  // ---- 1) rigid-body impulse with Coulomb friction ----
  const rb = sub(pc, ball.pos);
  const rc = sub(pc, car.pos);
  const vb = add(ball.vel, cross(ball.ang, rb));
  const vc = add(car.vel, cross(car.angVel, rc));
  const vrel = sub(vb, vc);
  const vn = dot(vrel, n);
  let J = v3();
  if (vn < 0) {
    const invMb = 1 / K.BALL_MASS, invMc = 1 / K.CAR_MASS;
    const invIb = 1 / K.BALL_INERTIA;
    const IcInv = worldInvInertia(car.R, CAR_INV_I);
    const Sb = skew(rb), Sc = skew(rc);
    // K = (1/mb + 1/mc) I - Sb Ib^-1 Sb - Sc Ic^-1 Sc
    const SbSb = mmul(Sb, Sb);
    const ScIcSc = mmul(mmul(Sc, IcInv), Sc);
    const Km = new Array(9);
    for (let i = 0; i < 9; i++) {
      Km[i] = ((i % 4 === 0) ? invMb + invMc : 0) - SbSb[i] * invIb - ScIcSc[i];
    }
    // target: zero relative contact velocity (restitution 0, sticking friction)
    const target = scale(n, -(1 + K.CARBALL_RESTITUTION) * vn);
    const vt = sub(vrel, scale(n, vn));
    const want = sub(target, vt); // delta-v needed: kill tangential + normal
    const Kinv = m3inv(Km);
    J = Kinv ? m3mulv(Kinv, want) : scale(n, -vn / (invMb + invMc));
    const jn = dot(J, n);
    const jt = sub(J, scale(n, jn));
    if (len(jt) > K.CARBALL_FRICTION * jn) {
      // sliding: friction at the cone limit along -slip direction
      const t = norm(vt);
      const dir = sub(n, scale(t, K.CARBALL_FRICTION));
      const kd = dot(n, m3mulv(Km, dir));
      const jn2 = kd > 1e-9 ? (-(1 + K.CARBALL_RESTITUTION) * vn) / kd : 0;
      J = scale(dir, jn2);
    }
    ball.vel = add(ball.vel, scale(J, invMb));
    ball.ang = add(ball.ang, scale(cross(rb, J), invIb));
    car.vel = sub(car.vel, scale(J, invMc));
    car.angVel = sub(car.angVel, m3mulv(IcInv, cross(rc, J)));
  }

  // ---- 2) Psyonix extra impulse (ball only) ----
  let extra = v3();
  if (car.lastExtraImpulseTick !== tick - 1 && car.lastExtraImpulseTick !== tick) {
    const relPos = sub(ball.pos, car.pos);
    const relSpeed = Math.min(len(sub(preBallVel, preCarVel)), K.EXTRA_IMPULSE_MAX_REL_SPEED);
    if (relSpeed > 0) {
      let hitDir = norm(v3(relPos.x, relPos.y, relPos.z * K.EXTRA_IMPULSE_Z_SCALE));
      const fwd = car.R.f;
      const fwdAdj = dot(hitDir, fwd) * (1 - K.EXTRA_IMPULSE_FORWARD_SCALE);
      hitDir = norm(sub(hitDir, scale(fwd, fwdAdj)));
      extra = scale(hitDir, relSpeed * curve(K.EXTRA_IMPULSE_FACTOR_CURVE, relSpeed));
      ball.vel = add(ball.vel, extra);
    }
  }
  car.lastExtraImpulseTick = tick;

  ball.vel = clampLen(ball.vel, K.BALL_MAX_SPEED);
  ball.ang = clampLen(ball.ang, K.BALL_MAX_ANG_SPEED);
  car.angVel = clampLen(car.angVel, K.CAR_MAX_ANG_SPEED);
  return { n, p: pc, impulse: J, extra, relSpeed: len(sub(preBallVel, preCarVel)) };
}
