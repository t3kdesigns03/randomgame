// Headless bot-vs-bot matches — `node tools/botmatch.mjs [matches] [seed]`
import { Game } from '../src/game/game.js';
import { mulberry32 } from '../src/game/ai.js';

const N = +(process.argv[2] || 5), seed0 = +(process.argv[3] || 1);
const totals = { points: 0, reasons: {}, rallyHits: [], ticks: 0, winners: { '-1': 0, '1': 0 }, shots: 0, mistakes: 0, leaves: 0, lets: 0 };
const t0 = Date.now();
for (let m = 0; m < N; m++) {
  const rng = mulberry32(seed0 + m * 7919);
  const g = new Game({ rng, playerAI: {} });
  let ticks = 0;
  while (g.state !== 'over' && ticks < 120 * 60 * 15) {
    g.tick(); ticks++;
    for (const e of g.drainFeed()) {
      if (e.type === 'touch') totals['touch' + e.team] = (totals['touch' + e.team] || 0) + 1;
      if (e.type === 'call') {
        totals.points++;
        const key = `${e.call.kind}:${e.call.reason}:winner${e.call.winner}`;
        totals.reasons[key] = (totals.reasons[key] || 0) + 1;
        totals.rallyHits.push(e.call.rally);
      }
    }
  }
  totals.ticks += ticks;
  if (g.state === 'over') totals.winners[g.match.winner]++;
  for (const b of [g.bot, g.playerBot]) for (const k in b.stats) totals[k + b.team] = (totals[k + b.team] || 0) + b.stats[k];
  console.log(`match ${m}: ${g.match.score[-1]}-${g.match.score[1]} ${g.state} in ${(ticks / 120).toFixed(0)}s game time`);
}
const avg = totals.rallyHits.reduce((a, b) => a + b, 0) / Math.max(1, totals.rallyHits.length);
console.log(JSON.stringify({ ...totals, rallyHits: undefined, avgHitsPerPoint: +avg.toFixed(2), maxHits: Math.max(...totals.rallyHits), gameSeconds: +(totals.ticks / 120).toFixed(0), wallMs: Date.now() - t0 }, null, 1));
