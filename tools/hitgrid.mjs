// Which straight-on car hits clear the net and land in? Ball at y=-1900 (receiver/serve depth).
import * as K from '../src/physics/constants.js';
import { makeBall } from '../src/physics/ball.js';
import { makeCar, stepCar, neutralControls } from '../src/physics/car.js';
import { collideCarBall } from '../src/physics/collide.js';
import { predictBall } from '../src/game/ai.js';
import { inCourt } from '../src/physics/arena.js';
import { v3 } from '../src/physics/vec.js';
const rows = [];
for (const z of [100, 130, 160, 200, 250, 300]) for (const vz of [-400, 0, 400]) {
  const row = [`z=${z} vz=${vz}`];
  for (const sp of [600, 900, 1200, 1500, 1800, 2100]) {
    let best = '';
    for (const jumpT of [null, 0.1, 0.2, 0.35]) {
      const ball = makeBall(v3(0, -1900, z)); ball.vel = v3(0, 0, vz);
      const car = makeCar(-1, v3(0, -1900 - 260, K.CAR_REST_HEIGHT), Math.PI / 2);
      car.vel = v3(0, sp, 0);
      const c = neutralControls(); c.throttle = 1; c.jump = jumpT !== null;
      let hit = null, t = 0;
      // start jump so that car is jumpT seconds into its jump at about contact time
      const lead = jumpT === null ? 0 : Math.max(0, 260 / sp - jumpT);
      for (let i = 0; i < 80 && !hit; i++) {
        c.jump = jumpT !== null && t >= lead && t < lead + 0.2;
        stepCar(car, c, K.DT); t += K.DT;
        const bb = { ...ball }; 
        hit = collideCarBall(car, ball, 1000 + i * 3);
      }
      if (!hit) { continue; }
      const p = predictBall(ball, 4); const f = p.firstFloor;
      let r = 'X';
      if (p.wallBeforeFloor) r = 'W'; else if (!f) r = '?'; else if (f.y < 0) r = 'n'; else if (!inCourt(f.x, f.y)) r = 'o'; else r = 'IN';
      const tag = (jumpT === null ? 'g' : 'j' + jumpT) + ':' + r;
      if (r === 'IN') { best = tag; break; }
      if (!best) best = tag;
    }
    row.push(best || '-');
  }
  rows.push(row.join('  '));
}
console.log('speeds: 600 900 1200 1500 1800 2100  (g=ground, jT=jump; IN=lands in, n=net/own side, o=out long/wide, W=wall)');
console.log(rows.join('\n'));
