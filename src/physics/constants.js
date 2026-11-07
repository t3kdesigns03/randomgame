// =====================================================================
//  Rocket Pong physics constants.
//  Units: Unreal units (1 uu = 1 cm), seconds, Z-up.
//  Values marked [RL] are Rocket League's community-measured values
//  (RLBot wiki / RocketSim / RLUtilities). Values marked [RP] are new
//  for Rocket Pong (court, net, rules) and are not part of RL.
// =====================================================================

// ---- Simulation ----
export const TICK_RATE = 120;            // [RL] physics ticks per second (~8.33 ms tick)
export const DT = 1 / TICK_RATE;

// ---- World ----
export const GRAVITY = 650;              // [RL] uu/s^2 (ball + car at rest)
// Spec: car gravity weakens slightly at max speed (650 -> ~626 uu/s^2).
// Linear in car speed from 0 to CAR_MAX_SPEED. Applied to cars only.
export const CAR_GRAVITY_AT_MAX_SPEED = 626;

// ---- Ball ----
export const BALL_RADIUS = 92.75;        // [RL] uu
export const BALL_MASS = 30;             // [RL]
export const BALL_MAX_SPEED = 6000;      // [RL] uu/s
export const BALL_MAX_ANG_SPEED = 6.0;   // [RL] rad/s
export const BALL_RESTITUTION = 0.6;     // [RL] keeps 60% of into-surface speed on a bounce
export const BALL_DRAG = 0.03;           // [RL] linear damping: v *= (1 - 0.03)^dt  (ball only — cars have no drag)
export const BALL_SURFACE_MU = 2.0;      // [RL] RLUtilities fitted Coulomb-friction coefficient for ball-surface bounces
export const BALL_INERTIA = 0.4 * BALL_MASS * BALL_RADIUS * BALL_RADIUS; // solid sphere
// Below this into-surface speed the ball rests instead of bouncing (stops 1-tick micro-bounces
// caused by gravity integrating ~5.4 uu/s per tick). Not an RL constant; it only affects rolling.
export const BALL_REST_SPEED = 15;

// ---- Car (Octane-like hitbox, original visual design) ----
export const CAR_MASS = 180;                                          // [RL]
export const CAR_HITBOX = { x: 120.507, y: 86.6994, z: 38.6591 };     // [RL] Octane OBB full extents
export const CAR_HITBOX_OFFSET = { x: 13.8757, y: 0, z: 20.755 };     // [RL] OBB centre relative to car origin (local)
export const CAR_REST_HEIGHT = 17.01;                                 // [RL] origin height when resting on the floor
// [RL] RLUtilities car inertia tensor (local principal axes: roll, pitch, yaw)
export const CAR_INERTIA = { x: CAR_MASS * 751, y: CAR_MASS * 1334, z: CAR_MASS * 1836 };

export const CAR_MAX_SPEED = 2300;            // [RL] uu/s (~83 kph)
export const CAR_SUPERSONIC = 2200;           // [RL] uu/s (~79 kph)
export const CAR_SUPERSONIC_MAINTAIN = 2100;  // [RL] stays supersonic above this once reached
export const CAR_MAX_ANG_SPEED = 5.5;         // [RL] rad/s

// Ground driving
export const THROTTLE_ACCEL_CURVE = [[0, 1600], [1400, 160], [1410, 0]]; // [RL] uu/s^2 vs forward speed
export const BRAKE_ACCEL = 3500;              // [RL]
export const COAST_DECEL = 525;               // [RL] 3500 * 0.15
export const BOOST_ACCEL_GROUND = 2975 / 3;   // [RL] 991.67 uu/s^2
export const BOOST_ACCEL_AIR = 3175 / 3;      // [RL] 1058.33 uu/s^2
export const AIR_THROTTLE_ACCEL = 200 / 3;    // [RL] 66.67 uu/s^2
// [RL] turning curvature (1/uu) vs speed — yaw rate = speed * curvature * steer
export const STEER_CURVATURE = [[0, 0.0069], [500, 0.00398], [1000, 0.00235], [1500, 0.001375], [1750, 0.0011], [2300, 0.00088]];
export const POWERSLIDE_TURN_SCALE = 1.6;     // [RP-approx] extra yaw while powersliding
export const GRIP_LATERAL_DAMP = 30;          // [RP-approx] 1/s lateral slip decay with grip
export const POWERSLIDE_LATERAL_DAMP = 1.2;   // [RP-approx] 1/s lateral slip decay while powersliding
export const STICKY_FORCE_SCALE = 0.5;        // [RL] wheels-on-surface sticky force = 0.5 g (+ (1-|n.z|) g while throttling)

// Boost
export const BOOST_MAX = 100;                 // [RL]
export const BOOST_START = 33;                // [RL] boost at kickoff
export const BOOST_USE_PER_SEC = 100 / 3;     // [RL] 33.3 per second
export const BOOST_PAD_SMALL_AMOUNT = 12;     // [RL]
export const BOOST_PAD_BIG_AMOUNT = 100;      // [RL]
export const BOOST_PAD_SMALL_RESPAWN = 4;     // [RL] s
export const BOOST_PAD_BIG_RESPAWN = 10;      // [RL] s
export const BOOST_PAD_SMALL_RADIUS = 144;    // [RL] pickup radius
export const BOOST_PAD_BIG_RADIUS = 208;      // [RL]

// Jump / dodge
export const JUMP_IMPULSE = 291.667;          // [RL] uu/s along car up on press
export const JUMP_HOLD_ACCEL = 1458.333;      // [RL] uu/s^2 while held
export const JUMP_MAX_HOLD = 0.2;             // [RL] s
export const JUMP_MIN_HOLD = 0.025;           // [RL] s (3 ticks)
export const DOUBLE_JUMP_IMPULSE = 291.667;   // [RL]
export const DODGE_WINDOW = 1.25;             // [RL] s after the first jump that a 2nd jump / flip is available
export const DODGE_DEADZONE = 0.5;            // [RL] stick magnitude for a flip instead of a double jump
export const FLIP_DURATION = 0.65;            // [RL] s of flip torque
export const FLIP_INITIAL_VEL = 500;          // [RL] uu/s dodge impulse
export const FLIP_FORWARD_MAX_SPEED_SCALE = 1;        // [RL]
export const FLIP_SIDE_MAX_SPEED_SCALE = 1.9;         // [RL]
export const FLIP_BACKWARD_MAX_SPEED_SCALE = 16 / 15; // [RL]
export const FLIP_BACKWARD_IMPULSE_SCALE_X = 16 / 15; // [RL]
export const FLIP_TORQUE_PITCH = 224;         // [RL] rad/s^2 forward/back flip
export const FLIP_TORQUE_ROLL = 260;          // [RL] rad/s^2 side flip
// Spec: after a flip the car keeps normal vertical momentum for 0.15 s, then vertical speed is cut
// 35% per tick ("the float"). FLIP_Z_DAMP_END bounds the window (RocketSim's 0.21 s) so the car does
// not hover for the rest of the dodge.
export const FLIP_Z_DAMP_START = 0.15;
export const FLIP_Z_DAMP_END = 0.21;
export const FLIP_Z_DAMP_PER_TICK = 0.35;

// [RL] Air control — RLUtilities (Sam Mish) torque / damping coefficients, rad/s^2
export const AIR_TORQUE = { roll: 36.07956616966136, pitch: 12.14599781908070, yaw: 8.91962804287785 };
export const AIR_DAMP = { roll: 4.47166302201591, pitch: 2.798194258050845, yaw: 1.886491900437232 };

// ---- Ball-car collision ----
export const CARBALL_FRICTION = 2.0;          // [RL] Coulomb friction for the rigid-body part
export const CARBALL_RESTITUTION = 0.0;       // [RL] fully inelastic rigid-body part
// [RL] Psyonix extra impulse — applied to the BALL ONLY (momentum is deliberately not conserved)
export const EXTRA_IMPULSE_Z_SCALE = 0.35;
export const EXTRA_IMPULSE_FORWARD_SCALE = 0.65;
export const EXTRA_IMPULSE_MAX_REL_SPEED = 4600;
export const EXTRA_IMPULSE_FACTOR_CURVE = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.30]];

// ---- Arena / court [RP] ----
// The arena is the inside of a rounded box: flat floor, curved floor-to-wall ramps (so cars can
// drive up the walls), walls, curved ceiling edges. The painted court sits inside the flat floor.
export const ARENA_HALF_X = 2800;     // side walls at x = ±2800
export const ARENA_HALF_Y = 4300;     // back walls at y = ±4300
export const ARENA_HEIGHT = 2000;     // ceiling
export const ARENA_CORNER_RADIUS = 350;
export const COURT_HALF_X = 2050;     // court lines (in = inside these)
export const COURT_HALF_Y = 3400;     // each half is 3400 uu deep
export const NET_HEIGHT = 200;        // net top
export const NET_THICKNESS = 16;
export const NET_RESTITUTION = 0.25;  // [RP] a net is soft; not an RL surface
// Cars stay on their own half: an invisible car-only wall at y = 0 (the ball passes freely above the net).
export const CAR_CENTER_BARRIER = 0;
