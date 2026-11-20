// =====================================================================
//  Rocket Pong physics constants.
//  Units: Unreal units (1 uu = 1 cm), seconds, Z-up.
//  Values marked [RL] are Rocket League's values as implemented in RocketSim
//  (github.com/ZealanL/RocketSim, src/RLConst.h + Car.cpp + btVehicleRL.cpp),
//  the open-source sim RLBot uses to match the real game. [RLU] = RLUtilities
//  (Sam Mish) fitted model. Values marked [RP] are new for Rocket Pong (court,
//  net, rules) and are not part of RL.
// =====================================================================

// ---- Simulation ----
export const TICK_RATE = 120;            // [RL] physics ticks per second (~8.33 ms tick)
export const DT = 1 / TICK_RATE;

// ---- World ----
export const GRAVITY = 650;              // [RL] GRAVITY_Z = -650, the same for cars and ball at every speed

// ---- Ball ----
export const BALL_RADIUS = 91.25;        // [RL] BALL_COLLISION_RADIUS_SOCCAR (physics)
export const BALL_VISUAL_RADIUS = 92.75; // [RL] rendered ball size
export const BALL_MASS = 30;             // [RL]
export const BALL_MAX_SPEED = 6000;      // [RL] uu/s
export const BALL_MAX_ANG_SPEED = 6.0;   // [RL] rad/s
export const BALL_RESTITUTION = 0.6;     // [RL] keeps 60% of into-surface speed on a bounce
export const BALL_DRAG = 0.03;           // [RL] linear damping: v *= (1 - 0.03)^dt  (ball only — cars have no drag)
export const BALL_SURFACE_MU = 2.0;      // [RLU] RLUtilities fitted Coulomb-friction coefficient for ball-surface bounces
export const BALL_INERTIA = 0.4 * BALL_MASS * BALL_RADIUS * BALL_RADIUS; // solid sphere
// Below this into-surface speed the ball rests instead of bouncing (stops 1-tick micro-bounces
// caused by gravity integrating ~5.4 uu/s per tick). Not an RL constant; it only affects rolling.
export const BALL_REST_SPEED = 15;

// ---- Car (Octane-like hitbox, original visual design) ----
export const CAR_MASS = 180;                                          // [RL]
export const CAR_HITBOX = { x: 120.507, y: 86.6994, z: 38.6591 };     // [RL] Octane OBB full extents
export const CAR_HITBOX_OFFSET = { x: 13.8757, y: 0, z: 20.755 };     // [RL] OBB centre relative to car origin (local)
export const CAR_REST_HEIGHT = 17.01;                                 // [RL] origin height when resting on the floor
// [RL] box inertia of the Octane hitbox at mass 180 (= Bullet's btBoxShape inertia; local roll, pitch, yaw)
export const CAR_INERTIA = { x: CAR_MASS * 751, y: CAR_MASS * 1334, z: CAR_MASS * 1836 };

export const CAR_MAX_SPEED = 2300;            // [RL] uu/s (~83 kph)
export const CAR_SUPERSONIC = 2200;           // [RL] uu/s (~79 kph)
export const CAR_SUPERSONIC_MAINTAIN = 2100;  // [RL] stays supersonic above this once reached ...
export const CAR_SUPERSONIC_MAINTAIN_TIME = 1; // [RL] ... for at most 1 s while below 2200
export const CAR_MAX_ANG_SPEED = 5.5;         // [RL] rad/s

// Ground driving — RocketSim's raycast-vehicle model, applied per wheel (see car.js groundStep)
// Octane wheel contact points, car-local uu (x forward, y left). [RL] CarConfig OCTANE
export const WHEELS = [
  { x: 51.25, y: 25.90, front: true }, { x: 51.25, y: -25.90, front: true },
  { x: -33.75, y: 29.50, front: false }, { x: -33.75, y: -29.50, front: false },
];
export const THROTTLE_ACCEL_PER_WHEEL = 400;  // [RL] THROTTLE_TORQUE_AMOUNT = mass * 400 per wheel -> 1600 uu/s^2 total
export const DRIVE_SPEED_TORQUE_FACTOR_CURVE = [[0, 1.0], [1400, 0.1], [1410, 0.0]]; // [RL] vs |forward speed|
export const BRAKE_ACCEL = 3500;              // [RL] BRAKE_TORQUE_AMOUNT = mass * (14.25 + 1/3) per wheel / (mass/3) -> 3500 total
export const COASTING_BRAKE_FACTOR = 0.15;    // [RL] coasting = 15% brake (525 uu/s^2)
export const STOPPING_FORWARD_VEL = 25;       // [RL] below this, coasting is a full brake / reversing is allowed
export const THROTTLE_DEADZONE = 0.001;       // [RL]
export const BOOST_ACCEL_GROUND = 2975 / 3;   // [RL] 991.67 uu/s^2
export const BOOST_ACCEL_AIR = 3175 / 3;      // [RL] 1058.33 uu/s^2
export const BOOST_MIN_TIME = 0.1;            // [RL] a tap boosts for at least 0.1 s
export const AIR_THROTTLE_ACCEL = 200 / 3;    // [RL] 66.67 uu/s^2
// [RL] max front-wheel steer angle (rad) vs |forward speed|
export const STEER_ANGLE_FROM_SPEED_CURVE = [[0, 0.53356], [500, 0.31930], [1000, 0.18203], [1500, 0.10570], [1750, 0.08507], [3000, 0.03454]];
// [RL] powerslide blends the steer angle toward this curve by the handbrake amount
export const POWERSLIDE_STEER_ANGLE_FROM_SPEED_CURVE = [[0, 0.39235], [2500, 0.12610]];
export const POWERSLIDE_RISE_RATE = 5;        // [RL] handbrake is analog 0..1: full in 0.2 s ...
export const POWERSLIDE_FALL_RATE = 2;        // [RL] ... and back to 0 in 0.5 s after release
// [RL] tyre friction. Input = lateral share of contact-point slip |lat| / (|lat| + |long|)
export const LAT_FRICTION_CURVE = [[0, 1.0], [1, 0.2]];
export const HANDBRAKE_LAT_FRICTION_FACTOR = 0.1;                  // [RL] powerslide keeps 10% of lateral grip
export const HANDBRAKE_LONG_FRICTION_FACTOR_CURVE = [[0, 0.5], [1, 0.9]];
export const NON_STICKY_FRICTION_FACTOR_CURVE = [[0, 0.1], [0.7075, 0.5], [1, 1.0]]; // [RL] vs surface normal z, when not throttling
export const WHEEL_CONTACT_DAMPING = 0.2;     // [RL] Bullet resolveSingleBilateral contactDamping (side impulse)
export const STICKY_FORCE_SCALE = 0.5;        // [RL] 0.5 g into the surface, + (1 - |n.z|) g while throttling or moving > 25 uu/s

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
export const JUMP_MIN_HOLD_ACCEL_SCALE = 0.62; // [RL] hold accel is 62% during the first 0.025 s
export const DOUBLE_JUMP_IMPULSE = 291.667;   // [RL]
export const DODGE_WINDOW = 1.25;             // [RL] s after the first jump that a 2nd jump / flip is available
export const DODGE_DEADZONE = 0.5;            // [RL] |pitch| + |yaw| + |roll| needed for a flip instead of a double jump
export const FLIP_DURATION = 0.65;            // [RL] FLIP_TORQUE_TIME: s of flip torque
export const FLIP_PITCHLOCK_EXTRA_TIME = 0.3; // [RL] pitch input stays locked until 0.95 s after the flip starts
export const FLIP_INITIAL_VEL = 500;          // [RL] uu/s dodge impulse
export const FLIP_FORWARD_MAX_SPEED_SCALE = 1;        // [RL]
export const FLIP_SIDE_MAX_SPEED_SCALE = 1.9;         // [RL]
export const FLIP_BACKWARD_MAX_SPEED_SCALE = 2.5;     // [RL]
export const FLIP_BACKWARD_IMPULSE_SCALE_X = 16 / 15; // [RL]
export const FLIP_TORQUE_PITCH = 224;         // [RL] rad/s^2 forward/back flip
export const FLIP_TORQUE_ROLL = 260;          // [RL] rad/s^2 side flip
// [RL] the float: from 0.15 s into the flip, vertical speed is cut 35% per 120 Hz tick while the car is
// falling (any time until the flip ends) or before 0.21 s.
export const FLIP_Z_DAMP_START = 0.15;
export const FLIP_Z_DAMP_END = 0.21;
export const FLIP_Z_DAMP_PER_TICK = 0.35;

// [RL] Air control: angular accel = (input * torque - damping * w) * CAR_TORQUE_SCALE.
// Pitch / yaw damping fades out with input (1 - |input|); roll damping is always on.
export const CAR_TORQUE_SCALE = (2 * Math.PI / (1 << 16)) * 1000; // 0.0958738
export const AIR_TORQUE = { pitch: 130 * CAR_TORQUE_SCALE, yaw: 95 * CAR_TORQUE_SCALE, roll: 400 * CAR_TORQUE_SCALE };
export const AIR_DAMP = { pitch: 30 * CAR_TORQUE_SCALE, yaw: 20 * CAR_TORQUE_SCALE, roll: 50 * CAR_TORQUE_SCALE };

// ---- Car-world body contacts (roof / side / nose hits) ----
export const CARWORLD_FRICTION = 0.3;         // [RL]
export const CARWORLD_RESTITUTION = 0.3;      // [RL]

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
