// Ball: RL constants, linear drag, no Magnus effect, RLUtilities-style surface bounce
// (inelastic rigid-body impulse with Coulomb friction, restitution 0.6).
import {
  BALL_RADIUS, BALL_MASS, BALL_MAX_SPEED, BALL_MAX_ANG_SPEED, BALL_RESTITUTION, BALL_DRAG,
  BALL_SURFACE_MU, BALL_INERTIA, BALL_REST_SPEED, GRAVITY, NET_RESTITUTION,
} from './constants.js';
import { v3, clone, dot, cross, len, scale, clampLen, sub } from './vec.js';
import { arenaQuery, netQuery, isFloorNormal } from './arena.js';

export function makeBall(pos = v3(0, 0, 500)) {
  return { pos: clone(pos), vel: v3(), ang: v3(), radius: BALL_RADIUS, frozen: false };
}

export function cloneBall(b) {
  return { pos: clone(b.pos), vel: clone(b.vel), ang: clone(b.ang), radius: b.radius, frozen: b.frozen };
}

const _q = { d: 0, n: { x: 0, y: 0, z: 1 } };

/**
 * Bounce the ball off a static surface with inward normal n.
 * RLUtilities ball model: J_perp = -(1+e) m v_perp ; J_para = -min(1, mu * |v_perp|/|v_para|) m_red v_para
 * where v_para is the slip velocity of the contact point (includes spin) and m_red the reduced mass
 * of the contact point (so friction transfers slip into spin).
 * Returns the into-surface speed (>0) if a bounce happened.
 */
export function bounceBall(ball, n, restitution) {
  const vn = dot(ball.vel, n);
  if (vn >= 0) return 0;
  const R = ball.radius;
  const L = scale(n, -R); // contact point relative to centre
  const vPerp = scale(n, vn);
  // slip velocity of the contact point: tangential v + (w x L)  (written as v - vPerp - L x w)
  const vPara = sub(sub(ball.vel, vPerp), cross(L, ball.ang));
  const vPerpLen = -vn;
  const e = vPerpLen < BALL_REST_SPEED ? 0 : restitution;
  const mRed = 1 / (1 / BALL_MASS + (R * R) / BALL_INERTIA);
  const vParaLen = len(vPara);
  const ratio = vPerpLen / Math.max(vParaLen, 1e-4);
  const Jperp = scale(vPerp, -(1 + e) * BALL_MASS);
  const Jpara = scale(vPara, -Math.min(1, BALL_SURFACE_MU * ratio) * mRed);
  ball.vel.x += (Jperp.x + Jpara.x) / BALL_MASS;
  ball.vel.y += (Jperp.y + Jpara.y) / BALL_MASS;
  ball.vel.z += (Jperp.z + Jpara.z) / BALL_MASS;
  const dw = scale(cross(L, Jpara), 1 / BALL_INERTIA);
  ball.ang.x += dw.x; ball.ang.y += dw.y; ball.ang.z += dw.z;
  ball.ang = clampLen(ball.ang, BALL_MAX_ANG_SPEED);
  return vPerpLen;
}

/**
 * Integrate the ball one tick against arena + net. Car contacts are handled in collide.js.
 * `events` (optional array) receives { type: 'floor'|'wall'|'ceiling'|'net', pos, speed }.
 */
export function stepBall(ball, dt, events = null) {
  if (ball.frozen) return;
  // gravity + ball-only air drag (no Magnus / curve: spin never changes the flight path)
  ball.vel.z -= GRAVITY * dt;
  const damp = Math.pow(1 - BALL_DRAG, dt);
  ball.vel.x *= damp; ball.vel.y *= damp; ball.vel.z *= damp;
  ball.vel = clampLen(ball.vel, BALL_MAX_SPEED);
  ball.ang = clampLen(ball.ang, BALL_MAX_ANG_SPEED);
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.pos.z += ball.vel.z * dt;

  // Arena (floor, ramps, walls, ceiling) — same 0.6 restitution everywhere
  const q = arenaQuery(ball.pos, _q);
  if (q.d < ball.radius) {
    const n = { x: q.n.x, y: q.n.y, z: q.n.z };
    const pen = ball.radius - q.d;
    ball.pos.x += n.x * pen; ball.pos.y += n.y * pen; ball.pos.z += n.z * pen;
    const speed = bounceBall(ball, n, BALL_RESTITUTION);
    if (events) {
      const type = isFloorNormal(n) ? 'floor' : n.z < -0.7 ? 'ceiling' : 'wall';
      events.push({ type, pos: clone(ball.pos), speed, contact: true });
    }
  }

  // Net (new vs RL)
  const nq = netQuery(ball.pos, ball.radius);
  if (nq) {
    ball.pos.x += nq.n.x * nq.depth; ball.pos.y += nq.n.y * nq.depth; ball.pos.z += nq.n.z * nq.depth;
    const speed = bounceBall(ball, nq.n, NET_RESTITUTION);
    if (events) events.push({ type: 'net', pos: clone(ball.pos), speed, contact: true });
  }
}
