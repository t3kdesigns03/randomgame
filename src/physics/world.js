// World: fixed-timestep simulation of two cars, the ball and the boost pads.
import * as K from './constants.js';
import { v3, len, sub } from './vec.js';
import { makeBall, stepBall } from './ball.js';
import { makeCar, stepCar, neutralControls } from './car.js';
import { collideCarBall } from './collide.js';

/** Boost pads (south half; mirrored for the north half). */
const PAD_LAYOUT = [
  { x: -2050, y: -3650, big: true },
  { x: 2050, y: -3650, big: true },
  { x: 0, y: -900, big: false },
  { x: -1400, y: -1600, big: false },
  { x: 1400, y: -1600, big: false },
  { x: 0, y: -2500, big: false },
  { x: -1400, y: -3050, big: false },
  { x: 1400, y: -3050, big: false },
];

export function makePads() {
  const pads = [];
  for (const s of [1, -1]) {
    for (const p of PAD_LAYOUT) pads.push({ x: p.x, y: p.y * s, big: p.big, timer: 0 });
  }
  return pads;
}

export const PLAYER_SPAWN = { pos: v3(0, -3300, K.CAR_REST_HEIGHT), yaw: Math.PI / 2 };
export const BOT_SPAWN = { pos: v3(0, 3300, K.CAR_REST_HEIGHT), yaw: -Math.PI / 2 };

export function makeWorld(opts = {}) {
  return {
    tick: 0,
    time: 0,
    ball: makeBall(v3(0, -1900, 600)),
    cars: [
      makeCar(-1, PLAYER_SPAWN.pos, PLAYER_SPAWN.yaw, opts.playerProfile),
      makeCar(1, BOT_SPAWN.pos, BOT_SPAWN.yaw, opts.botProfile),
    ],
    controls: [neutralControls(), neutralControls()],
    pads: makePads(),
    events: [],
  };
}

/**
 * One fixed tick. Emits events into world.events:
 *   { type: 'touch', team, ... } { type: 'floor'|'wall'|'ceiling'|'net', pos, speed } { type: 'pad', team, big }
 */
export function stepWorld(w) {
  const dt = K.DT;
  w.tick++;
  w.time += dt;
  for (let i = 0; i < w.cars.length; i++) stepCar(w.cars[i], w.controls[i], dt);

  const ballEvents = [];
  stepBall(w.ball, dt, ballEvents);
  for (const e of ballEvents) w.events.push(e);

  if (!w.ball.frozen) {
    for (const car of w.cars) {
      const hit = collideCarBall(car, w.ball, w.tick);
      if (hit) w.events.push({ type: 'touch', team: car.team, relSpeed: hit.relSpeed, pos: { ...w.ball.pos } });
    }
  }

  // boost pads
  for (const pad of w.pads) {
    if (pad.timer > 0) { pad.timer = Math.max(0, pad.timer - dt); continue; }
    const r = pad.big ? K.BOOST_PAD_BIG_RADIUS : K.BOOST_PAD_SMALL_RADIUS;
    for (const car of w.cars) {
      if (car.boost >= K.BOOST_MAX) continue;
      const dx = car.pos.x - pad.x, dy = car.pos.y - pad.y;
      if (dx * dx + dy * dy < r * r && car.pos.z < 200) {
        car.boost = Math.min(K.BOOST_MAX, car.boost + (pad.big ? K.BOOST_PAD_BIG_AMOUNT : K.BOOST_PAD_SMALL_AMOUNT));
        pad.timer = pad.big ? K.BOOST_PAD_BIG_RESPAWN : K.BOOST_PAD_SMALL_RESPAWN;
        w.events.push({ type: 'pad', team: car.team, big: pad.big });
        break;
      }
    }
  }
}

export { len, sub };
