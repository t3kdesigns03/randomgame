// Headless physics measurements — `node tools/measure.mjs`
import * as K from '../src/physics/constants.js';
import { makeBall, stepBall } from '../src/physics/ball.js';
import { makeCar, stepCar, neutralControls } from '../src/physics/car.js';
import { collideCarBall } from '../src/physics/collide.js';
import { v3, len } from '../src/physics/vec.js';

const out = {};
// 1) Drop test: ball centre released at z = 1000 above floor (bottom at 907 uu), record apexes.
{
  const b = makeBall(v3(0, -1500, 1000));
  const apex = []; let prevVz = 0, t = 0, firstImpact = null;
  for (let i = 0; i < 120 * 12; i++) {
    const ev = []; stepBall(b, K.DT, ev); t += K.DT;
    if (ev.length && firstImpact === null) firstImpact = { t: +t.toFixed(4), speed: +ev[0].speed.toFixed(1) };
    if (prevVz > 0 && b.vel.z <= 0) apex.push(+(b.pos.z - K.BALL_RADIUS).toFixed(1));
    prevVz = b.vel.z;
  }
  const drop = 1000 - K.BALL_RADIUS;
  out.drop = {
    releaseBottomHeight: +drop.toFixed(1),
    firstImpact,
    idealFirstImpactNoDrag: { t: +Math.sqrt(2 * drop / K.GRAVITY).toFixed(4), speed: +Math.sqrt(2 * K.GRAVITY * drop).toFixed(1) },
    bounceApexHeights: apex.slice(0, 5),
    ratios: apex.slice(0, 5).map((h, i) => +(h / (i ? apex[i - 1] : drop)).toFixed(3)),
    idealRatioNoDrag: +(K.BALL_RESTITUTION ** 2).toFixed(3),
  };
}
// 2) Full-power hit: car at 2300 uu/s on the ground drives head-on into a resting ball.
function hitTest(speed, ballZ) {
  const car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  car.vel = v3(0, speed, 0);
  const ball = makeBall(v3(0, -2000 + 300, ballZ));
  ball.frozen = false;
  let tick = 0, res = null;
  const c = neutralControls(); c.throttle = 1; c.boost = speed > 1400;
  for (let i = 0; i < 120 && !res; i++) {
    tick++;
    stepCar(car, c, K.DT);
    const h = collideCarBall(car, ball, tick);
    if (h) res = { tick, ballVel: { ...ball.vel }, carVelAfter: { ...car.vel }, impulse: h.impulse, extra: h.extra };
    else { ball.vel = v3(); }
  }
  // travel: flight until ball returns to resting height (ignoring net/walls for an open-field number)
  let x = { ...ball.pos }, v = { ...ball.vel }, t = 0;
  const damp = Math.pow(1 - K.BALL_DRAG, K.DT);
  do { v.z -= K.GRAVITY * K.DT; v.x *= damp; v.y *= damp; v.z *= damp; x.x += v.x * K.DT; x.y += v.y * K.DT; x.z += v.z * K.DT; t += K.DT; } while (x.z > K.BALL_RADIUS && t < 10);
  const carSpeedAtHit = speed;
  // model prediction (no rotation, central hit): common velocity + extra impulse along the flattened hit direction
  const m = K.CAR_MASS, mb = K.BALL_MASS;
  const commonV = carSpeedAtHit * m / (m + mb);
  const fac = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.30]];
  return {
    carSpeed: speed, ballZ,
    ballSpeedAfterHit: +len(res.ballVel).toFixed(1),
    ballVel: Object.fromEntries(Object.entries(res.ballVel).map(([k, q]) => [k, +q.toFixed(1)])),
    rigidPartDeltaV: +(len(res.impulse) / mb).toFixed(1),
    extraImpulseDeltaV: +len(res.extra).toFixed(1),
    carSpeedAfterHit: +len(res.carVelAfter).toFixed(1),
    centralHitModelEstimate: +(commonV + 0).toFixed(1) + ' + extra',
    flightTimeToFirstBounce: +t.toFixed(3),
    travelToFirstBounce: +Math.hypot(x.x - 0, x.y - (-1700)).toFixed(0),
  };
}
out.hits = [hitTest(2300, K.BALL_RADIUS), hitTest(1400, K.BALL_RADIUS), hitTest(1000, 130)];
// 3) Car speeds from rest (sideways across the court so the centre barrier is not in the way)
{
  const run = (boost) => {
    const car = makeCar(-1, v3(-2300, -2000, K.CAR_REST_HEIGHT), 0);
    const c = neutralControls(); c.throttle = 1; c.boost = boost; car.boost = 100;
    let t = 0, tSuper = null, maxSp = 0, t1000 = null;
    for (let i = 0; i < 120 * 2.2; i++) {
      stepCar(car, c, K.DT); t += K.DT; const sp = len(car.vel); maxSp = Math.max(maxSp, sp);
      if (sp >= 1000 && t1000 === null) t1000 = +t.toFixed(3);
      if (car.supersonic && tSuper === null) tSuper = +t.toFixed(3);
    }
    return { maxSpeed: +maxSp.toFixed(1), timeTo1000: t1000, timeToSupersonic: tSuper, distance: +(car.pos.x + 2300).toFixed(0) };
  };
  out.car = { throttleOnly2_2s: run(false), boost2_2s: run(true) };
}
// 4) Single jump apex
{
  const car = makeCar(-1, v3(0, -2000, K.CAR_REST_HEIGHT), Math.PI / 2);
  const c = neutralControls(); c.jump = true; let maxZ = 0, t = 0, tApex = 0;
  for (let i = 0; i < 240; i++) { stepCar(car, c, K.DT); t += K.DT; if (car.pos.z > maxZ) { maxZ = car.pos.z; tApex = t; } }
  out.jump = { singleJumpFullHoldApexRise: +(maxZ - K.CAR_REST_HEIGHT).toFixed(1), tApex: +tApex.toFixed(3) };
}
console.log(JSON.stringify(out, null, 2));
// 5) Flip hit vs drive hit at 1200 uu/s on a ball at z=130
{
  const shot = (flip) => {
    const car = makeCar(-1, v3(0, -2400, K.CAR_REST_HEIGHT), Math.PI / 2);
    car.vel = v3(0, 1200, 0);
    const ball = makeBall(v3(0, -1900, 130));
    const c = neutralControls(); c.throttle = 1;
    for (let i = 1; i < 120; i++) {
      c.jump = flip && (i <= 3 || i === 12); c.stickY = flip && i >= 12 ? 1 : 0;
      stepCar(car, c, K.DT);
      if (collideCarBall(car, ball, i)) return +len(ball.vel).toFixed(0);
    }
    return 0;
  };
  console.log(JSON.stringify({ hitAt1200: { drive: shot(false), frontFlip: shot(true) } }));
}
// 6) Aerial: jump + pitch up + boost for 2 s
{
  const car = makeCar(-1, v3(0, -2500, K.CAR_REST_HEIGHT), Math.PI / 2); car.boost = 100;
  const c = neutralControls(); c.jump = true; c.boost = true; c.pitch = 1; let maxZ = 0;
  for (let i = 0; i < 240; i++) { if (i > 24) c.pitch = 0; stepCar(car, c, K.DT); maxZ = Math.max(maxZ, car.pos.z); }
  console.log(JSON.stringify({ aerialMaxHeight2s: +maxZ.toFixed(0) }));
}
