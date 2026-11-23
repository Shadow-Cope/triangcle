"use strict";

/* =====================================================================
   CONFIG  –  all units are studs / seconds.  Tweak here while iterating.
   [R] = value taken from Roblox defaults
   [~] = my best estimate, not verified against Roblox yet
   ===================================================================== */
const CFG = {
  PHYSICS_HZ:      240,      // [R] Roblox simulates at 240 Hz
  GRAVITY:         196.2,    // [R] workspace.Gravity
  WALK_SPEED:      16,       // [R] Humanoid.WalkSpeed
  JUMP_POWER:      50,       // [R] Humanoid.JumpPower (classic). Jump height = v^2/2g
  GROUND_ACCEL:    200,      // [~] how fast horizontal velocity reaches target on ground
  AIR_ACCEL:       100,       // [~] air control; with no input, momentum is kept in air
  AIR_STOP:        120,      // how fast you stop in the air when you let go of the keys
  AUTOJUMP_MAX:    5.5,      // auto-jump onto ledges up to this tall (jump height is ~6.4)
  STEP_HEIGHT:     2.0,      // [R-ish] walk straight up ledges/stairs this tall (R6 legs are 2 studs); taller needs a jump
  TURN_SMOOTH:     11,       // [~] turn responsiveness (higher = snappier), exponential smoothing
  STEP_SMOOTH:     9,        // [~] how fast the visual smooths out after stepping up a ledge
  SHIFTLOCK_OFFSET:1.75,     // [R] shift lock camera offset to the right (studs)
  SHIFTLOCK_TURN:  35,       // [~] how fast the body snaps to camera heading in shift lock
  DEBRIS_RESTITUTION: 0.25,  // bounce of body parts after reset
  DEBRIS_FRICTION:    0.4,
  FALL_DESTROY_Y:  -100,     // [R] is -500; shortened for the obby test
  RESPAWN_TIME:    1.5,      // short beat so you can see the head-cam; set 0 for instant
  FF_TIME:         3,        // spawn forcefield seconds
  TAG_WORLD_H:     0.4,      // name tag height in studs (scales with distance like a part)

  CHAR_HALF_XZ:    1.0,      // [~] collision box half-width (box is 2 x 5 x 2)
  CHAR_HEIGHT:     5.0,

  CAM_FOV:         70,       // [R] Camera.FieldOfView (vertical)
  CAM_ZOOM_START:  12.5,     // [R] default zoom distance
  CAM_ZOOM_MIN:    0.5,      // [R]
  CAM_ZOOM_MAX:    128,      // [R]
  CAM_FOCUS_Y:     4.5,      // camera focus height above feet (head height)
  CAM_SENS:        0.0045,   // [~] radians per pixel of mouse movement
  CAM_ARROW_SPEED: 2.0,      // [~] rad/s for arrow-key camera rotation
  CAM_PITCH_LIMIT: 80 * Math.PI / 180,

  NAME_DISTANCE:   100,      // [R] Humanoid.NameDisplayDistance
  NET_SEND_HZ:     20,       // how often your state is sent to the server
  SERVER_URL:      "",       // optional own Rust WebSocket server; ignored if Supabase is set
  SUPABASE_URL:      "https://dkyqelgdnzsuxgfhzinf.supabase.co",     // https://xxxx.supabase.co   (Project Settings -> API)
  SUPABASE_ANON_KEY: "sb_publishable_69j232n97HQQzJ769gyqxA_YXrju9ld",     // the public "anon" key
  ROOM:              "baseplate-1",  // channel name; players in the same room see each other
  SUPABASE_SEND_HZ:  10,     // keep this low: Supabase Realtime has per-second message limits       // e.g. "wss://my-game.onrender.com". Empty = same host as the page

  MODEL_FRONT_OFFSET: 0,     // set to Math.PI if the model walks backwards

  CLIMB_MAX_SIZE:  1.5,      // ledge-grab only works on parts this tall or shorter; anything bigger is a wall and can't be climbed
  AUTH_EMAIL_DOMAIN: "players.bounded.app",  // usernames become <name>@this-domain behind the scenes (no email is ever sent)
  SAVE_TABLE:      "player_profiles",        // Supabase table that stores each account's saved data (see supabase.sql)
};

/* ---------------------------------------------------------------------
   Player model, baked from triancleRig.fbx (Torso + FemaleTorso)
   (200 FBX units = 1 stud; each part is relative to its joint pivot;
    model forward = +X, up = +Y, lateral = Z)
   --------------------------------------------------------------------- */

const PART_STYLE = {            // Roblox "noob" colours – the FBX has no materials
  Head:     0xf5cd30,
  Torso:    0x0d69ac,
  LeftArm:  0xf5cd30,
  RightArm: 0xf5cd30,
  LeftLeg:  0x287f47,
  RightLeg: 0x287f47,
};
