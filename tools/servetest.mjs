// Serve accuracy: N serves by the south bot, measure plan vs actual contact and outcome.
import { Game } from '../src/game/game.js';
import { mulberry32 } from '../src/game/ai.js';
const N = +(process.argv[2] || 30); const SIDE = +(process.env.SIDE || -1);
const out = {}; const errs = [];
for (let k = 0; k < N; k++) {
  const g = new Game({ rng: mulberry32(100 + k), playerAI: { missRate: 0 }, botOptions: { missRate: 0 } });
  g.match.server = SIDE; g.setupServe();
  let lastPlan = null, res = null, touched = null;
  for (let i = 0; i < 120 * 12 && !res; i++) {
    g.tick();
    const b = SIDE === -1 ? g.playerBot : g.bot; if (b.plan && !b.plan.leave) lastPlan = { ...b.plan, car: null };
    for (const e of g.drainFeed()) {
      if (e.type === 'touch' && e.team === SIDE && !touched) {
        const car = g.world.cars[SIDE === -1 ? 0 : 1];
        touched = { t: g.time, dt: lastPlan ? g.time - lastPlan.tAbs : null, dx: lastPlan ? car.pos.x - lastPlan.target.x : null, dy: lastPlan ? car.pos.y - lastPlan.target.y : null,
          spd: Math.hypot(car.vel.x, car.vel.y), plan: lastPlan?.speed, heading: lastPlan ? car.R.f.x * lastPlan.aim.x + car.R.f.y * lastPlan.aim.y : null, ballZ: e.pos.z, planZ: lastPlan?.ballZ, jump: !!lastPlan?.jump, carZ: car.pos.z };
      }
      if (e.type === 'call') res = e.call.reason;
    }
  }
  out[res] = (out[res] || 0) + 1;
  if (touched) errs.push(touched);
  if (process.argv[3]) console.log(res, JSON.stringify(touched, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
}
console.log(out);
const m = (f) => (errs.reduce((a, e) => a + Math.abs(f(e)), 0) / errs.length).toFixed(2);
console.log('touched', errs.length, '/', N, 'mean |dt|', m(e => e.dt), 'mean |dx|', m(e => e.dx), 'mean |dy|', m(e => e.dy), 'mean heading', m(e => e.heading));
