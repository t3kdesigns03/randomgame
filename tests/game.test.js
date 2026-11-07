import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { mulberry32, AI_MISS_RATE } from '../src/game/ai.js';

// Bot vs bot through the real physics + rules: proves rallies, scoring, misses and game end.
test('bot vs bot matches finish first-to-7 with returns, points and misses on both sides', () => {
  let totalTouches = { [-1]: 0, [1]: 0 }, rallies2plus = 0, points = 0, mistakes = 0;
  const reasons = new Set();
  for (let m = 0; m < 3; m++) {
    const g = new Game({ rng: mulberry32(11 + m * 101), playerAI: {} });
    let ticks = 0;
    while (g.state !== 'over' && ticks < 120 * 60 * 12) {
      g.tick(); ticks++;
      for (const e of g.drainFeed()) {
        if (e.type === 'touch') totalTouches[e.team]++;
        if (e.type === 'call') { points++; reasons.add(e.call.reason); if (e.call.rally >= 2) rallies2plus++; }
      }
    }
    assert.equal(g.state, 'over', 'game ends');
    const s = g.match.score;
    assert.equal(Math.max(s[-1], s[1]), 7, 'winner has 7');
    assert.ok(Math.min(s[-1], s[1]) < 7);
    mistakes += g.bot.stats.mistakes + g.playerBot.stats.mistakes;
  }
  assert.ok(totalTouches[-1] > 20 && totalTouches[1] > 20, `both bots hit the ball (${JSON.stringify(totalTouches)})`);
  assert.ok(rallies2plus >= 5, `returned shots happen (${rallies2plus} points with 2+ hits)`);
  assert.ok(mistakes > 0, 'deliberate mistakes happen');
  assert.ok(reasons.size >= 3, `varied outcomes: ${[...reasons].join(', ')}`);
  assert.ok(AI_MISS_RATE > 0 && AI_MISS_RATE < 1);
});
