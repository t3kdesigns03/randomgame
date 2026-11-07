// Receive test: north bot serves (no mistakes); south bot (no mistakes) receives. Classify legal serves.
import { Game } from '../src/game/game.js';
import { mulberry32 } from '../src/game/ai.js';
const N = +(process.argv[2] || 30), V = process.argv[3];
const out = {};
for (let k = 0; k < N; k++) {
  const g = new Game({ rng: mulberry32(500 + k), playerAI: { missRate: 0 }, botOptions: { missRate: 0 } });
  g.match.server = 1; g.setupServe();
  let legal = false, recvTouch = false, res = null, info = '';
  for (let i = 0; i < 120 * 14 && !res; i++) {
    g.tick();
    const r = g.match.rally;
    if (r && r.phase === 'rally' && r.hitter === 1 && r.bounced) legal = true;
    for (const e of g.drainFeed()) {
      if (e.type === 'touch' && e.team === -1) recvTouch = true;
      if (e.type === 'call') res = e.call.reason;
    }
    if (legal && !recvTouch && V && i % 12 === 0) {
      const car = g.world.cars[0], p = g.playerBot.plan, b = g.world.ball;
      info += `\n   t=${g.time.toFixed(2)} car(${car.pos.x.toFixed(0)},${car.pos.y.toFixed(0)}) v=${Math.hypot(car.vel.x, car.vel.y).toFixed(0)} ball(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) plan=${p ? (p.leave ? 'LEAVE' : `T=${(p.tAbs - g.time).toFixed(2)} tgt(${p.target.x.toFixed(0)},${p.target.y.toFixed(0)}) spd${p.speed} j${p.jump ? 1 : 0}`) : 'none'} job=${!!g.playerBot.job}`;
    }
  }
  const key = !legal ? 'serve-not-legal' : recvTouch ? `returned:${res}` : `no-touch:${res}`;
  out[key] = (out[key] || 0) + 1;
  if (V && legal && !recvTouch) console.log(k, key, info);
}
console.log(out);
