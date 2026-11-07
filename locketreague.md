# TASK: Rocket Pong — mobile-first browser game, V1 prototype (Opus 5.5)

Repo: NEW git repo for this game (create it locally if it does not exist yet — do NOT push, do NOT deploy, do NOT merge anything without explicit approval; ask before any push/deploy). Static front end, Netlify later. Single-player vs AI in V1. No online multiplayer in V1.

## The game

Rocket League controls and physics, ping pong / pickleball rules, in a browser. A grounded RL-style car hits a ball over a net on a neon court. NOT soccer — there are no goals. You score when the ball lands on the opponent's side and they fail to return it, or they hit it into the net / out.

Visual reference: a wireframe grid arena, neon shapes, glowing ball, boost trails — dark court, neon lines, low-poly. That look is cheap to render and reads well on a phone. Do NOT copy Rocket League art, names, or branding — RL-style cars, original look.

## Platform — browser first, mobile is the target

- Build for the browser, mobile-first in layout and performance. Test at 390px first, landscape orientation for play.
- Desktop keyboard controls must work fully in V1. Touch controls are V1 too (this is a mobile game): virtual joystick + buttons, see Controls below. Do NOT ship a desktop-only build and promise mobile later.
- 60fps target on a modern phone. Three.js, low-poly, no shadows, no heavy models. Static site, no server in V1.

## Physics — Rocket League's, not a generic arcade bounce

Use RL's actual numbers and model, scaled to the court. These are the researched values — do not invent different ones without saying so in the PR:
- Units: 1 uu = 1 cm. Gravity 650 uu/s². Ball radius ~92.75 uu, mass 30, max speed 6000 uu/s, restitution 0.6 (ball loses 40% of into-surface velocity on a bounce), max ball angular velocity 6.0 rad/s, ball-only air drag (cars have no drag).
- Car: top speed 2300 uu/s (~83 kph), supersonic at 2200 uu/s (~79 kph, trail + FOV kick). Gravity weakens slightly at max speed (650 → ~626 uu/s²) — implement it, it is part of the feel.
- Collisions: cars use oriented bounding boxes (OBBs), NOT the visual car geometry. Ball-car collision = inelastic rigid-body collision with Coulomb friction, PLUS Psyonix's extra predictable impulse on the ball (applied to the ball only — it deliberately breaks Newton's 3rd law, momentum is not conserved on a hit; that is the tuning that makes hits feel controllable). The community model predicts real RL hits to 0.1–3% error — aim for that class of predictability, and say in the PR what you measured.
- No curve / Magnus effect. The ball flies straight; drag and camera may make it look curved, but the sim is linear.
- Physics tick: fixed timestep (RL uses 8ms). No continuous collision detection in V1 — note it as a known limitation, with tunneling as the accepted edge case.
- Flips/dodges: a dodge lasts 0.65s. After a flip, the car is under normal vertical momentum for 0.15s, then vertical speed reduces 35% per tick — implement the float, it is why flips feel the way they do. Flip window on touch must be GENEROUS in V1 (tap jump, then flick joystick within ~0.3s) — do not ship RL's strict timing on a phone; note the window in the PR and tighten later only with playtesting.
- NEW vs RL, the ping pong bounce: the ball must bounce on the court/table surface with the same 0.6 restitution, and a rally is only legal if the ball bounces on the opponent's side after crossing the net. Wall bounces (arena walls) use the same restitution.

## Directional freedom — full 3D arena, no rails

- The car moves freely in all directions on the court — full steering, reversing, turning, drifting. NO lane locking, NO left-right-only movement, NO auto-drive toward the ball.
- The ball moves freely in 3D — ground, wall, and aerial play all count. Aerials, wall shots, and flip hits must all be possible, same as RL.
- Camera: chase cam behind the car, automatic. No manual camera control on mobile. Ball cam toggle on desktop (optional in V1, do not block on it).

## Rules — ping pong / pickleball hybrid

- Court: a net across the middle, two halves. Ball must cross the net and bounce on the opponent's side to count.
- Serve: ball drops in from the server's side; server hits it over the net. Alternate serve every 2 points (ping pong style).
- Scoring: point when the ball lands on the opponent's side and is not returned, or the opponent hits it into the net / out / fails to bounce it on your side. First to 7 wins a quick game (V1 default), first to 11 win-by-2 as a full-game option. Show the score big, rally count, and a "point" / "fault" call after each rally.
- Boost: boost pads on the court, 100 boost max, boost drains while held. Boost is for speed and aerials, not for scoring directly.
- AI opponent in V1: a bot car that chases the ball, returns it over the net, and makes mistakes at a tunable rate. Difficulty: one setting in V1 (medium), with the miss rate as a named constant so it can be tuned later. No online multiplayer, no local 2-player in V1.

## Controls

Desktop (keyboard + mouse):
- W/A/S/D or arrows — drive / steer / reverse
- Space — jump; Space again mid-air (with a joystick/arrow direction held) — dodge/flip in that direction
- Shift — boost (hold)
- Q / E or mouse — air roll while airborne
- R — reset / re-serve, Esc — pause

Mobile (touch, landscape):
- Left thumb — virtual joystick to drive/steer (full directional freedom, analog)
- Right thumb — big buttons: JUMP (tap again mid-air to flip), BOOST (hold), AIR ROLL (while airborne)
- No manual camera. Buttons must be thumb-sized, not overlap the ball/court, and must not be covered by the keyboard (there is no keyboard in play).
- Controls must be visible and labelled on first play; a 10-second "how to play" overlay on first load, dismissible, never shown again unless the player asks.

## Visuals

- Three.js. Dark wireframe grid court, neon net, glowing ball with a trail, RL-style car (original design, boxy, with boost flames/trail), boost pads glowing on the court.
- Score HUD: big score, rally count, boost meter, speed indicator. Minimal, readable at 390px.
- No real-world branding, no Rocket League logos/names.

## Hard rules

- No online multiplayer, no accounts, no backend, no real data. All local, single-player vs AI.
- Do NOT deploy to Netlify in this PR. Branch off main, open a PR, and ask before merging — never merge, push, or deploy without explicit approval.
- Mobile 390px landscape first; desktop second. No new backend/worker unless it can be shown to save requests or bandwidth.

## V1 succeeds when (verify ALL of these before finishing)

- A player can drive freely in any direction, jump, flip, boost, and air-roll — grounded car, full directional freedom, no rails.
- The ball obeys the RL numbers above (gravity, bounce, drag, collision model) — show the constants in code and in the PR, and report a simple measured check (e.g. a dropped ball's bounce heights, a full-power hit's travel distance).
- A full rally works: serve, cross the net, bounce on the opponent's side, return, point awarded correctly, score updates, first to 7 wins and the game ends cleanly.
- The AI returns the ball, scores sometimes, and misses sometimes — a real game, not a demo loop.
- Touch controls work at 390px landscape: joystick drives, JUMP/BOOST/AIR ROLL all fire, buttons do not overlap the play area, 60fps on a modern phone (report the device/frame rate you measured, or say you could not measure it).
- Desktop keyboard controls all work.
- PR description lists: what changed, the physics constants used, the flip window used, the AI miss rate, what is NOT built (online multiplayer, local 2-player, full 11-point mode as default), and that nothing was merged, pushed, or deployed.

Open a PR and ask before merging. Do not merge, do not push, do not deploy.
