// Bot opponent. Drives with the same controls a player has (throttle/steer/boost/jump) — no
// physics cheats. It predicts the ball with the real sim, test-fires candidate hits in a scratch
// sim to choose a shot that lands in, then drives to meet the ball at the planned speed.
// Mistakes are deliberate and tunable via the named constants below.
import * as K from '../physics/constants.js';
import { v3, len, dot, clamp, curve, toLocal } from '../physics/vec.js';
import { cloneBall, stepBall } from '../physics/ball.js';
import { makeCar, stepCar, neutralControls } from '../physics/car.js';
import { collideCarBall } from '../physics/collide.js';
import { inCourt } from '../physics/arena.js';

// ---- Difficulty (V1 ships one setting: MEDIUM) ----
export const AI_MISS_RATE = 0.2;        // chance per incoming shot that the bot makes a deliberate mistake
export const AI_REACTION_TIME = 0.15;   // s before the bot starts reacting to a new shot
export const AI_AIM_MARGIN = 250;       // uu the bot tries to keep between its landing spot and the lines
export const AI_MISTAKE_KINDS = ['late', 'offset', 'aim', 'power']; // what a "mistake" can be
const PREDICT_SECONDS = 3.5;
export const AI_PLAN_BUDGET_MS = 1.2;   // planning CPU per physics tick; the rest continues next tick (smooth frames on phones)
const now_ms = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Predict the ball's path (no cars). Samples every tick with bounce bookkeeping. */
export function predictBall(ball, seconds = PREDICT_SECONDS, stopAtLanding = false) {
  const b = cloneBall(ball);
  b.frozen = false;
  const out = [];
  const n = Math.round(seconds / K.DT);
  let floorBounces = 0, wallBeforeFloor = false, firstFloor = null, inContact = false, netTouched = false;
  const ev = [];
  for (let i = 1; i <= n; i++) {
    ev.length = 0;
    stepBall(b, K.DT, ev);
    let floor = false;
    for (const e of ev) {
      if (e.type === 'floor') floor = true;
      else if (e.type === 'net') netTouched = true;
      else if (floorBounces === 0) wallBeforeFloor = true;
    }
    if (floor && !inContact) {
      floorBounces++;
      if (!firstFloor) firstFloor = { x: b.pos.x, y: b.pos.y, t: i * K.DT };
    }
    inContact = floor;
    if (stopAtLanding && (firstFloor || wallBeforeFloor)) break;
    out.push({ t: i * K.DT, x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, bounces: floorBounces });
  }
  return { samples: out, firstFloor, wallBeforeFloor, netTouched };
}

// Car origin height over time for a full-hold single jump (from the real car sim).
const JUMP_CURVE = (() => {
  const car = makeCar(1, v3(0, 2000, K.CAR_REST_HEIGHT), 0);
  const c = neutralControls(); c.jump = true;
  const pts = [];
  for (let i = 1; i <= 110; i++) {
    stepCar(car, c, K.DT);
    pts.push({ t: i * K.DT, z: car.pos.z, vz: car.vel.z });
  }
  return pts;
})();

/** Fastest speed reachable from v0 over distance d (rough, throttle + optional boost). */
function reachableSpeed(v0, d, boost) {
  const a = boost ? 1900 : 1100;
  const cap = boost ? K.CAR_MAX_SPEED : 1400;
  return Math.min(cap, Math.sqrt(Math.max(0, v0 * v0 + 2 * a * d)));
}

/** Simulate one candidate hit in a scratch sim. Returns landing info + where the car was at contact. */
function testShot(ballState, team, dir, speed, jump) {
  const ball = cloneBall(ballState);
  ball.frozen = false;
  const yaw = Math.atan2(dir.y, dir.x);
  const car = makeCar(team, v3(0, 0, K.CAR_REST_HEIGHT), yaw);
  const back = 140 + K.BALL_RADIUS;
  car.pos = v3(ball.pos.x - dir.x * back, ball.pos.y - dir.y * back, jump ? jump.z : K.CAR_REST_HEIGHT);
  car.vel = v3(dir.x * speed, dir.y * speed, jump ? jump.vz : 0);
  if (jump) {
    car.onGround = false; car.hasJumped = true;
    car.jumping = jump.t < K.JUMP_MAX_HOLD; car.jumpTime = jump.t; car.prevJump = true;
  }
  const c = neutralControls(); c.throttle = 1; c.jump = !!jump;
  let hit = null, ticks = 0;
  for (; ticks < 40 && !hit; ticks++) {
    stepCar(car, c, K.DT);
    hit = collideCarBall(car, ball, 1000 + ticks * 3);
  }
  if (!hit) return null;
  return { pred: predictBall(ball, 4, true), carAt: { x: car.pos.x, y: car.pos.y }, lead: ticks * K.DT };
}

function scoreLanding(pred, team) {
  const f = pred.firstFloor;
  if (!f || pred.wallBeforeFloor) return -1e6;
  const depth = -team * f.y; // positive = opponent half
  if (depth <= 0) return -5000 - Math.abs(depth); // net / own side
  if (!inCourt(f.x, f.y)) {
    const ox = Math.max(0, Math.abs(f.x) - K.COURT_HALF_X), oy = Math.max(0, Math.abs(f.y) - K.COURT_HALF_Y);
    return -1000 - ox - oy;
  }
  const mx = K.COURT_HALF_X - Math.abs(f.x), my = Math.min(depth, K.COURT_HALF_Y - depth);
  return Math.min(mx, my, AI_AIM_MARGIN * 2) + depth * 0.05;
}

/** Time and distance to accelerate from u to s using the real throttle (+ boost) curves. */
function accelProfile(u, s, boost) {
  let v = u, t = 0, d = 0;
  const h = 1 / 60;
  while (v < s && t < 4) {
    const a = curve(K.THROTTLE_ACCEL_CURVE, v) + (boost ? K.BOOST_ACCEL_GROUND : 0);
    if (a <= 0) return { t: Infinity, d: Infinity };
    const dv = Math.min(a * h, s - v);
    const dt = dv / a;
    d += (v + dv / 2) * dt; t += dt; v += dv;
  }
  return { t, d };
}

/** Cruise speed u so that cruising then accelerating to s covers D in exactly T. */
function cruiseSpeed(D, T, s, boost) {
  let lo = 0, hi = s;
  for (let i = 0; i < 14; i++) {
    const u = (lo + hi) / 2;
    const ap = accelProfile(u, s, boost);
    const cover = ap.t > T ? Infinity : ap.d + u * (T - ap.t);
    if (cover > D) hi = u; else lo = u;
  }
  return lo;
}

const FLOOR_X = K.ARENA_HALF_X - K.ARENA_CORNER_RADIUS - 150;
const FLOOR_Y = K.ARENA_HALF_Y - K.ARENA_CORNER_RADIUS - 150;

/**
 * Path from the car to a contact point `t` arriving along aim `a`: if the car is not already behind
 * the contact point inside a ~35 degree cone, it first drives to a staging point G behind it.
 */
export function approachPath(px, py, hdg, t, a) {
  const toX = t.x - px, toY = t.y - py;
  const along = toX * a.x + toY * a.y;
  const side = toX * -a.y + toY * a.x;
  const direct = Math.hypot(toX, toY);
  const inCone = along > 80 && Math.abs(side) < along * 0.7;
  let gx = t.x, gy = t.y, len = direct, turn2 = 0;
  if (!inCone) {
    const pull = clamp(Math.abs(side) * 1.2 + Math.max(0, 450 - along), 350, 1400);
    gx = clamp(t.x - a.x * pull, -FLOOR_X, FLOOR_X);
    gy = clamp(t.y - a.y * pull, -FLOOR_Y, FLOOR_Y);
    const d1 = Math.hypot(gx - px, gy - py), d2 = Math.hypot(t.x - gx, t.y - gy);
    len = d1 + d2;
    turn2 = Math.abs(wrap(Math.atan2(a.y, a.x) - Math.atan2(gy - py, gx - px)));
  }
  const turn1 = Math.abs(wrap(Math.atan2(gy - py, gx - px) - hdg));
  return { gx, gy, len, turn1, turn2, inCone, along, side, direct };
}
export const approachTime = (ap, vAvg) => ap.turn1 * 0.35 + ap.turn2 * 0.35 + ap.len / vAvg;

const norm2 = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class BotAI {
  constructor(team, opts = {}) {
    this.team = team;
    this.rng = opts.rng || Math.random;
    this.missRate = opts.missRate ?? AI_MISS_RATE;
    this.reaction = opts.reactionTime ?? AI_REACTION_TIME;
    this.c = neutralControls();
    this.shotKey = null;
    this.plan = null;
    this.job = null;
    this.mistake = null;
    this.waitUntil = 0;
    this.jumpHeld = 0;
    this.retryAt = 0;
    this.stats = { shots: 0, mistakes: 0, leaves: 0, planned: 0, noPlan: 0 };
  }

  update(world, match, now) {
    const car = world.cars.find((c) => c.team === this.team);
    const r = match.rally;
    const c = this.c;
    Object.assign(c, neutralControls());
    if (!r || r.phase === 'dead') { this.plan = null; this.job = null; return this.idle(car, c); }

    const key = `${match.pointsPlayed}:${r.phase}:${r.hitter}:${r.hits}:${world.ball.frozen}`;
    if (key !== this.shotKey) {
      this.shotKey = key;
      this.plan = null;
      this.job = null;
      this.mistake = null;
      this.jumpHeld = 0;
      this.retryAt = 0;
      this.waitUntil = now + this.reaction;
      if (this.isOurBall(match, r) && !world.ball.frozen) {
        this.stats.shots++;
        if (this.rng() < this.missRate) {
          this.mistake = AI_MISTAKE_KINDS[Math.floor(this.rng() * AI_MISTAKE_KINDS.length)];
          this.stats.mistakes++;
          if (this.mistake === 'late') this.waitUntil = now + 0.8 + this.rng() * 0.6;
        }
      }
    }
    if (world.ball.frozen || !this.isOurBall(match, r)) return this.idle(car, c);
    if (now < this.waitUntil) return this.shadow(car, c, world.ball);

    if (!this.plan && !this.job && now >= this.retryAt) this.job = this.planJob(world, match, now);
    if (this.job) {
      const res = this.job.next();
      if (res.done) {
        this.job = null;
        this.plan = res.value;
        if (this.plan && !this.plan.leave) this.stats.planned++;
        else if (!this.plan) { this.stats.noPlan++; this.retryAt = now + 0.1; }
      }
    }
    if (!this.plan) return this.shadow(car, c, world.ball);
    if (this.plan.leave) return this.idle(car, c);
    this.execute(car, c, now);
    this.jumpHeld = Math.max(0, this.jumpHeld - K.DT);
    return c;
  }

  isOurBall(match, r) {
    if (r.phase === 'serve') return match.server === this.team;
    return r.hitter !== this.team;
  }

  /** Generator: spreads candidate-shot simulations over several ticks. */
  *planJob(world, match, now) {
    const r = match.rally;
    const team = this.team;
    const car = world.cars.find((c) => c.team === team);
    const pred = predictBall(world.ball);

    // Leave a shot that will land out or hit a wall first — the rules give us the point.
    if (r.phase === 'rally' && !r.bounced) {
      const f = pred.firstFloor;
      if (pred.wallBeforeFloor || (f && f.y * team > 0 && !inCourt(f.x, f.y))) {
        this.stats.leaves++;
        return { leave: true };
      }
    }

    const prevBounces = r.phase === 'serve' ? r.serveBounces : (r.bounced ? 1 : 0);
    const maxBounces = r.phase === 'serve' ? 2 : 1;
    const v0 = len(car.vel);
    const samples = [];
    let lastT = -1;
    for (let i = 8; i < pred.samples.length && samples.length < 9; i += 3) {
      const s = pred.samples[i];
      if (s.bounces + prevBounces > maxBounces) break;
      const depth = s.y * team;
      if (depth < 300 || depth > K.ARENA_HALF_Y - 300 || Math.abs(s.x) > K.ARENA_HALF_X - 300) continue;
      if (r.phase === 'rally' && s.bounces === 0 && !r.bounced && depth < 1200) continue; // no volleys at the net
      if (s.z > 215) continue;
      if (s.z < K.BALL_RADIUS + 3 && Math.abs(s.vz) < 60) continue; // rolling
      if (s.t - lastT < 0.12) continue;
      // can we get there? (direct drive estimate)
      const dx = s.x - car.pos.x, dy = s.y - car.pos.y;
      const dist = Math.hypot(dx, dy);
      const ang = Math.abs(wrap(Math.atan2(dy, dx) - Math.atan2(car.R.f.y, car.R.f.x)));
      const vAvg = Math.max(700, (v0 + reachableSpeed(v0, dist, car.boost > 15)) / 2);
      const eta = ang * 0.4 + dist / vAvg;
      if (eta > s.t) continue;
      lastT = s.t;
      let jump = null;
      if (s.z > 140) {
        const need = s.z - 80;
        jump = JUMP_CURVE.find((p) => p.z >= need && p.vz > 0) || null;
        if (!jump) continue;
      }
      samples.push({ s, jump, dist, i, eta });
    }
    if (!samples.length) return null;
    yield;

    const cands = [];
    let t0 = now_ms();
    const budget = function* () { if (now_ms() - t0 > AI_PLAN_BUDGET_MS) { yield; t0 = now_ms(); } };
    const toBall = (q) => ({ pos: v3(q.x, q.y, q.z), vel: v3(q.vx, q.vy, q.vz), ang: v3(), radius: K.BALL_RADIUS });
    // pass 1: test-fire every (contact sample, aim, speed)
    for (const { s, jump, dist, i, eta } of samples) {
      const bs = toBall(s);
      const vReach = reachableSpeed(Math.min(v0, 600), Math.max(dist - 150, 0), car.boost > 15);
      const speeds = [800, 1150, 1500, 1850].filter((sp) => sp <= vReach + 50);
      if (!speeds.length) speeds.push(Math.max(500, vReach));
      // aims: the natural line from the car through the ball (easy to execute) plus set targets
      const nat = norm2(s.x - car.pos.x, s.y - car.pos.y);
      const aims = [];
      if (nat.y * -team > 0.35) {
        for (const da of [0, -0.2, 0.2]) {
          const c0 = Math.cos(da), s0 = Math.sin(da);
          aims.push({ d: { x: nat.x * c0 - nat.y * s0, y: nat.x * s0 + nat.y * c0 }, bonus: da === 0 ? 120 : 60 });
        }
      }
      for (const tx of [-900, 0, 900]) for (const td of [1800, 2700]) aims.push({ d: norm2(tx - s.x, -team * td - s.y), bonus: 0 });
      const hdg = Math.atan2(car.R.f.y, car.R.f.x);
      for (const { d, bonus } of aims) {
        const turn = Math.abs(wrap(Math.atan2(d.y, d.x) - Math.atan2(nat.y, nat.x)));
        const ap = approachPath(car.pos.x, car.pos.y, hdg, { x: s.x - d.x * 140, y: s.y - d.y * 140 }, d);
        const vAvg = Math.max(650, (v0 + reachableSpeed(v0, ap.len, car.boost > 15)) / 2);
        if (approachTime(ap, vAvg) > s.t) continue;
        for (const sp of speeds) {
          const res = testShot(bs, team, d, sp, jump);
          yield* budget();
          if (!res) continue;
          cands.push({ s, i, jump, d, sp, carAt: res.carAt, lead: res.lead, base: scoreLanding(res.pred, team), bonus, turn });
        }
      }
    }
    // pass 2: robustness for the best few — still good if we arrive ~1/30 s late and 8% slow, or 1/40 s early?
    cands.sort((a, b) => b.base - a.base);
    for (const cd of cands.slice(0, 10)) {
      if (cd.base <= 0) break;
      const late = pred.samples[Math.min(cd.i + 4, pred.samples.length - 1)];
      const early = pred.samples[Math.max(cd.i - 3, 0)];
      const rl = testShot(toBall(late), team, cd.d, cd.sp * 0.92, cd.jump);
      const re = testShot(toBall(early), team, cd.d, cd.sp, cd.jump);
      yield* budget();
      cd.base = Math.min(cd.base, rl ? scoreLanding(rl.pred, team) : -800, re ? scoreLanding(re.pred, team) : -800);
      cd.robust = true;
    }
    for (const cd of cands) {
      cd.score = cd.base + (cd.base > 0 && cd.robust ? cd.bonus - cd.turn * 150 + 200 : 0) - cd.s.t * 40 - cd.sp * 0.02;
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    let pick;
    if (this.mistake === 'aim' || this.mistake === 'power') {
      const bad = cands.filter((cd) => cd.score < -500 && cd.score > -3000);
      pick = bad.length ? bad[Math.floor(this.rng() * bad.length)] : cands[0];
    } else {
      const top = cands.filter((cd) => cd.score > cands[0].score - 120).slice(0, 4);
      pick = top[Math.floor(this.rng() * top.length)];
    }
    let offset = 0;
    if (this.mistake === 'offset') offset = (this.rng() < 0.5 ? -1 : 1) * (55 + this.rng() * 60);
    const { s, d } = pick;
    const perp = { x: -d.y, y: d.x };
    return {
      leave: false,
      tAbs: now + s.t,                             // scratch sim holds the ball at the sample while the car closes in
      ballZ: s.z,
      aim: d,
      speed: pick.sp,
      jump: pick.jump ? { t: pick.jump.t + pick.lead } : null, // press jump this long before contact
      target: { x: pick.carAt.x + perp.x * offset, y: pick.carAt.y + perp.y * offset },
      expected: pick.score,
    };
  }

  execute(car, c, now) {
    if (car.onGround && car.groundN.z < 0.75) return this.wallRecover(car, c);
    const p = this.plan;
    const T = p.tAbs - now;
    if (T < -0.25) { this.plan = null; return c; }
    {
      const ax = p.target.x - car.pos.x, ay = p.target.y - car.pos.y;
      // overshot the contact point with time to spare: plan again
      const hd = car.R.f.x * p.aim.x + car.R.f.y * p.aim.y;
      if (ax * p.aim.x + ay * p.aim.y < -120 && T > 0.25 && car.onGround && hd < 0.85) { this.plan = null; this.retryAt = now + 0.05; return c; }
    }
    const hdg = Math.atan2(car.R.f.y, car.R.f.x);
    const ap = approachPath(car.pos.x, car.pos.y, hdg, p.target, p.aim);
    const { along, side } = ap;
    const dist = ap.len;
    let gx = ap.gx, gy = ap.gy;
    if (ap.inCone) {
      // in the approach cone: steer at a point past the contact point, over-correcting toward the aim line
      gx = p.target.x + p.aim.x * 350 + -p.aim.y * side * 0.6;
      gy = p.target.y + p.aim.y * 350 + p.aim.x * side * 0.6;
    }
    // not enough run-up to reach the contact speed? reverse straight back along the aim line first
    const aRun = p.speed > 1350 ? 1300 : 900;
    const runup = (p.speed * p.speed) / (2 * aRun);
    const headingDot = car.R.f.x * p.aim.x + car.R.f.y * p.aim.y;
    if (car.onGround && headingDot > 0.85 && Math.abs(side) < 120 && along < runup - 60 &&
        T > (runup - along) / 700 + p.speed / aRun + 0.25) {
      const fsb = dot(car.vel, car.R.f);
      c.throttle = fsb > -700 ? -1 : 0;
      c.steer = clamp(-side * 0.01, -1, 1);
      c.stickX = 0; c.stickY = 0;
      return c;
    }
    const lx = (gx - car.pos.x) * car.R.f.x + (gy - car.pos.y) * car.R.f.y;
    const ly = (gx - car.pos.x) * car.R.l.x + (gy - car.pos.y) * car.R.l.y;
    const ang = Math.atan2(ly, lx); // + = left
    const fs = dot(car.vel, car.R.f);

    if (car.onGround) {
      c.steer = clamp(-ang * 3.2, -1, 1);
      // speed planning: cruise at u, then accelerate to the planned contact speed s, arriving at T
      const s = p.speed;
      const boostOK = car.boost > 2;
      const jt = p.jump ? p.jump.t : 0; // be at contact speed by take-off
      const Tr = Math.max(T - jt, 0.02);
      const D = Math.max(dist - s * jt, 0);
      let want;
      if (D / Tr >= s) {
        want = D / Tr; // late: go as fast as needed
      } else {
        const u = cruiseSpeed(D, Tr, s, boostOK && s > 1300);
        const tA = accelProfile(Math.max(fs, 0), s, boostOK && s > 1300).t;
        want = Tr <= tA + 0.03 ? s : u; // cruise (or wait), then run up to the contact speed
      }
      if (Math.abs(ang) > 1.0 && dist > 400) want = Math.min(want, 1100);
      want = clamp(want, 0, K.CAR_MAX_SPEED);
      const err = want - fs;
      c.throttle = clamp(err / 200, -1, 1);
      c.boost = err > 250 && Math.abs(ang) < 0.3 && fs > -100 && car.boost > 0;
      if (Math.abs(ang) > 2.4 && dist < 700 && fs < 400) { c.throttle = -1; c.steer = -c.steer; c.boost = false; }
      c.handbrake = Math.abs(ang) > 1.7 && fs > 800;
      c.stickX = c.steer; c.stickY = c.throttle;
    } else {
      this.airLevel(car, c);
    }
    if (p.jump && car.onGround && this.jumpHeld <= 0 && T <= p.jump.t + 0.005 && T > 0.02) {
      this.jumpHeld = K.JUMP_MAX_HOLD + 0.02;
    }
    if (this.jumpHeld > 0) c.jump = true;
    return c;
  }

  /** On a wall or ramp: turn the nose downhill and drive back to the floor. */
  wallRecover(car, c) {
    const dl = toLocal(car.R, v3(0, 0, -1));
    const ang = Math.atan2(dl.y, dl.x);
    c.steer = clamp(-ang * 2.5, -1, 1);
    c.throttle = 1;
    c.handbrake = Math.abs(ang) > 1.5;
    return c;
  }

  airLevel(car, c) {
    c.pitch = clamp(-car.R.f.z * 3, -1, 1);
    c.roll = clamp(car.R.l.z * 3, -1, 1);
    c.throttle = 1;
    return c;
  }

  /** Before a plan exists: drift toward where the ball is heading, staying on our side. */
  shadow(car, c, ball) {
    // wait behind where the ball is going so there is room for a run-up
    const vy = ball.vel.y * this.team;
    const hy = this.team * (vy > 0 ? 3500 : clamp(Math.abs(ball.pos.y) + 900, 2600, 3500));
    return this.driveTo(car, c, clamp(ball.pos.x * 0.7, -1600, 1600), hy, 1000);
  }

  idle(car, c) {
    if (!car.onGround) return this.airLevel(car, c);
    const hx = 0, hy = this.team * 3300;
    if (Math.hypot(hx - car.pos.x, hy - car.pos.y) > 250) return this.driveTo(car, c, hx, hy, 1200);
    const fs = dot(car.vel, car.R.f);
    const ang = wrap(Math.atan2(-this.team, 0) - Math.atan2(car.R.f.y, car.R.f.x));
    c.throttle = Math.abs(ang) > 0.3 ? 0.4 : clamp(-fs / 300, -1, 1);
    c.steer = Math.abs(ang) > 0.3 ? clamp(-ang * 2, -1, 1) : 0;
    return c;
  }

  driveTo(car, c, x, y, maxSpeed) {
    if (!car.onGround) return this.airLevel(car, c);
    if (car.groundN.z < 0.75) return this.wallRecover(car, c);
    const toX = x - car.pos.x, toY = y - car.pos.y;
    const dist = Math.hypot(toX, toY);
    const lx = toX * car.R.f.x + toY * car.R.f.y, ly = toX * car.R.l.x + toY * car.R.l.y;
    const ang = Math.atan2(ly, lx);
    const fs = dot(car.vel, car.R.f);
    c.steer = clamp(-ang * 3, -1, 1);
    const want = Math.min(maxSpeed, dist * 1.5);
    c.throttle = clamp((want - fs) / 300, -1, 1);
    if (Math.abs(ang) > 2.2 && dist < 900) { c.throttle = -1; c.steer = -c.steer; }
    return c;
  }
}
