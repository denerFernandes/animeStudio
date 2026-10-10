import { z } from "zod";
import { EASING_NAMES } from "../easing";
import { CAPTION_STYLES, FX_TYPES } from "../fx";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const Vec2Schema = z.tuple([z.number(), z.number()]).describe("[x, y]");

export const EaseSchema = z
  .union([
    z.enum(EASING_NAMES as [string, ...string[]]),
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
  ])
  .describe("Easing name or cubic-bezier [x1, y1, x2, y2]. Shapes the segment arriving at this key.");

export const ValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
  Vec2Schema,
  z.record(z.string(), z.number()),
]);

export const KeyframeSchema = z
  .union([
    z.tuple([z.number(), ValueSchema]),
    z.tuple([z.number(), ValueSchema, EaseSchema]),
    z.strictObject({ t: z.number(), v: ValueSchema, ease: EaseSchema.optional() }),
  ])
  .describe("[time, value] | [time, value, ease] | { t, v, ease }");

export const TracksSchema = z
  .record(z.string(), z.array(KeyframeSchema))
  .describe("Channel path → keyframes sorted by time");

const ArtRef = z
  .string()
  .describe("Art id from `art`, or inline SVG markup (a string starting with '<')");

const Space = z.enum(["setup", "bone"]).describe("Coordinate space of the art (default: setup)");

const VisibleWhen = z
  .strictObject({
    part: z.string(),
    variant: z.union([z.string(), z.array(z.string())]),
    and: z.strictObject({ part: z.string(), variant: z.union([z.string(), z.array(z.string())]) }).optional().describe("A second switch condition that must hold too"),
  })
  .describe("Only show this part while another switch part shows one of these variants");

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

export const BoneSchema = z
  .strictObject({
    id: z.string().min(1),
    parent: z.string().optional(),
    from: Vec2Schema.optional().describe("Setup form: joint position in setup space"),
    to: Vec2Schema.optional().describe("Setup form: tip position in setup space"),
    x: z.number().optional().describe("Local form: x in parent space"),
    y: z.number().optional().describe("Local form: y in parent space"),
    rotation: z.number().optional().describe("Local form: rotation in degrees relative to parent"),
    length: z.number().min(0).optional(),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    mass: z.number().positive().optional().describe("Physics mass (default 1)"),
    limits: z.strictObject({ rotation: z.tuple([z.number(), z.number()]).optional() }).optional(),
    inheritRotation: z.boolean().optional(),
    inheritScale: z.boolean().optional(),
  })
  .describe("A bone, in setup form (from/to) or local form (x/y/rotation/length)");

const PartBase = {
  id: z.string().min(1),
  z: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  visibleWhen: VisibleWhen.optional(),
};

const PathStyle = {
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  attrs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
};

export const RigidPartSchema = z.strictObject({
  ...PartBase,
  type: z.literal("rigid"),
  bone: z.string(),
  art: ArtRef,
  space: Space.optional(),
});

export const SwitchPartSchema = z.strictObject({
  ...PartBase,
  type: z.literal("switch"),
  bone: z.string(),
  variants: z.record(z.string(), ArtRef).describe("Variant name → art (use '' for an empty variant)"),
  default: z.string(),
  space: Space.optional(),
});

export const SkinnedPartSchema = z.strictObject({
  ...PartBase,
  ...PathStyle,
  type: z.literal("skinned"),
  path: z.string().describe("SVG path data in setup space"),
  bones: z.array(z.string()).min(1),
  weights: z.array(z.array(z.number())).optional(),
  falloff: z.number().positive().optional(),
});

export const HosePartSchema = z.strictObject({
  ...PartBase,
  ...PathStyle,
  type: z.literal("hose"),
  bones: z.array(z.string()).min(1),
  width: z.union([z.number(), z.array(z.number()).min(1)]),
  cap: z.enum(["round", "butt"]).optional(),
  smooth: z.number().min(0).max(1).optional(),
});

export const HullPartSchema = z.strictObject({
  ...PartBase,
  ...PathStyle,
  type: z.literal("hull"),
  points: z
    .array(z.strictObject({ bone: z.string(), at: Vec2Schema.describe("Setup space"), r: z.number().min(0).describe("Radius around the point") }))
    .min(2),
}).describe("A soft shape stretched over points of the skeleton (the rounded convex hull of circles): a skirt over the waist and the knees, a cape, a belly");

const SolidPointSchema = z.strictObject({
  bone: z.string().describe("A bone of the rig3d"),
  t: z.number().optional().describe("Along the 3D bone: 0 = its joint (default), 1 = its tip"),
  at: z.tuple([z.number(), z.number(), z.number()]).optional().describe("Offset [x, y, z] in body space (rest pose), turned with the bone"),
});

export const SolidShapeSchema = z
  .strictObject({
    from: SolidPointSchema,
    to: SolidPointSchema.optional().describe("The other end of a cone (none: a sphere)"),
    r: z.union([z.number().min(0), z.tuple([z.number().min(0), z.number().min(0)])]).optional().describe("Radius, or [at from, at to]"),
    box: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional().describe("A box of these half sizes [x, y, z] centred on `from`, turned with its bone"),
    ellipsoid: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional().describe("An ellipsoid of these radii [x, y, z] centred on `from`, turned with its bone"),
    round: z.number().min(0).optional().describe("Rounding of a box's edges"),
  })
  .describe("A cone between two points of the skeleton (a sphere without `to`), or a rounded box");

export const SolidPartSchema = z.strictObject({
  ...PartBase,
  type: z.literal("solid"),
  step: z.number().positive().optional().describe("Grid size of the drawing in character units (default 2)"),
  bodies: z
    .array(
      z.strictObject({
        fill: z.string().optional().describe("No fill: an occluder (hides the bodies behind it, draws nothing)"),
        shade: z.string().optional().describe("Colour of the side turned away from the light"),
        stroke: z.string().optional(),
        strokeWidth: z.number().min(0).optional(),
        blend: z.number().min(0).optional().describe("Smooth union of the shapes over this distance"),
        seamless: z.boolean().optional().describe("No outline where it meets an occluder: cloth continuing the drawing under it (a dress's skirt out of the torso)"),
        shapes: z.array(SolidShapeSchema).min(1),
      }),
    )
    .min(1),
}).describe("Volumes on the bones of a 2.5D rig (rig3d), drawn each frame from the view: cel shaded, composited per pixel by depth (legs, a lap, a skirt)");

export const MorphPartSchema = z.strictObject({
  ...PartBase,
  ...PathStyle,
  type: z.literal("morph"),
  bone: z.string(),
  base: z.string(),
  shapes: z.record(z.string(), z.string()),
  clip: z.string().optional().describe("Another morph part whose current shape clips this one (teeth and tongue inside the mouth)"),
  space: Space.optional(),
});

export const PartSchema = z.discriminatedUnion("type", [
  RigidPartSchema,
  SwitchPartSchema,
  SkinnedPartSchema,
  HosePartSchema,
  HullPartSchema,
  SolidPartSchema,
  MorphPartSchema,
]);

export const AnchorSchema = z.strictObject({
  bone: z.string(),
  at: Vec2Schema.describe("Setup space"),
  turn: z.number().min(0).max(1).optional().describe("How much a prop held at this anchor turns with the bone (0 = stays upright, 1 = turns with the hand)"),
});

export const ColliderSchema = z
  .strictObject({
    bone: z.string(),
    radius: z.number().positive(),
  })
  .describe("Capsule along the bone (a circle for zero-length bones) that rigid bodies collide with");

export const IkSchema = z.strictObject({
  id: z.string(),
  bones: z.array(z.string()).min(2),
  bend: z.union([z.literal(1), z.literal(-1)]).optional(),
  mix: z.number().min(0).max(1).optional(),
});

const Unit = z.number().min(0).max(1);

export const SpringPhysicsSchema = z.strictObject({
  type: z.literal("spring"),
  bones: z.array(z.string()).min(1),
  stiffness: Unit.optional(),
  damping: Unit.optional(),
  gravity: Vec2Schema.optional(),
  inertia: Unit.optional(),
  mix: Unit.optional(),
});

export const JigglePhysicsSchema = z.strictObject({
  type: z.literal("jiggle"),
  bone: z.string(),
  stiffness: Unit.optional(),
  damping: Unit.optional(),
  translate: Unit.optional(),
  squash: Unit.optional(),
  mix: Unit.optional(),
});

export const PhysicsSchema = z.discriminatedUnion("type", [SpringPhysicsSchema, JigglePhysicsSchema]);

export const VISEMES = ["A", "B", "C", "D", "E", "F", "G", "H", "X"] as const;
export type Viseme = (typeof VISEMES)[number];

export const VisemeControlSchema = z.strictObject({
  type: z.literal("viseme"),
  part: z
    .union([z.string(), z.array(z.string()).min(1)])
    .describe("Switch part (mouth variants) or morph part (mouth shapes, smooth blending); a list drives several mouths at once (e.g. one per view)"),
  map: z.record(z.string(), z.string()).optional().describe("Viseme → variant name"),
});

export const AimControlSchema = z.strictObject({
  type: z.literal("aim"),
  targets: z
    .array(
      z.strictObject({
        bone: z.string(),
        weight: z.number().optional(),
        mode: z.enum(["rotate", "translate"]).optional(),
        forward: z.number().optional(),
        maxAngle: z.number().optional(),
        radius: z.number().optional(),
      }),
    )
    .min(1),
});

export const PoseControlSchema = z.strictObject({
  type: z.literal("pose"),
  poses: z.record(z.string(), z.record(z.string(), ValueSchema)),
  override: z.boolean().optional().describe("Numbers set their channels instead of adding to them (a later control placing points a former one also moved)"),
});

export const ControlSchema = z.discriminatedUnion("type", [
  VisemeControlSchema,
  AimControlSchema,
  PoseControlSchema,
]);

export const BehaviorSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("blink"),
    id: z.string(),
    part: z.string(),
    open: z.string(),
    closed: z.string(),
    interval: z.tuple([z.number(), z.number()]).optional(),
    duration: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("breathe"),
    id: z.string(),
    bone: z.string(),
    amount: z.number().optional(),
    period: z.number().positive().optional(),
  }),
  z.strictObject({
    type: z.literal("sway"),
    id: z.string(),
    bone: z.string(),
    angle: z.number().optional(),
    period: z.number().positive().optional(),
  }),
]);

export const ClipSchema = z.strictObject({
  duration: z.number().positive(),
  loop: z.boolean().optional(),
  stride: z.number().min(0).optional().describe("Travel distance per cycle for locomotion clips"),
  tracks: TracksSchema,
});

export const ToonSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal("toon"),
  version: z.literal(1),
  name: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
  palette: z.record(z.string(), z.string()).optional(),
  defs: z.string().optional(),
  art: z.record(z.string(), z.string()).optional(),
  skeleton: z.array(BoneSchema).min(1),
  parts: z.array(PartSchema),
  anchors: z.record(z.string(), AnchorSchema).optional(),
  ik: z.array(IkSchema).optional(),
  physics: z.array(PhysicsSchema).optional(),
  colliders: z.array(ColliderSchema).optional(),
  controls: z.record(z.string(), ControlSchema).optional(),
  behaviors: z.array(BehaviorSchema).optional(),
  clips: z.record(z.string(), ClipSchema).optional(),
  rig3d: z
    .strictObject({
      bones: z
        .record(z.string(), z.strictObject({ from: z.tuple([z.number(), z.number(), z.number()]), to: z.tuple([z.number(), z.number(), z.number()]) }))
        .describe("Bones posed in 3D: rest joint and tip in body space (the front view: x right, y down, z towards the viewer)"),
      views: z.record(z.string(), z.number()).describe("Each view of the `view` control → the yaw (degrees) its drawings were made at"),
      pitch: z.number().optional().describe("How far above the drawings are seen from (degrees, default 0)"),
      chains: z
        .array(z.strictObject({ bones: z.array(z.string()), parts: z.array(z.string()), tip: z.boolean().optional().describe("Ranked by the depth of the last bone's tip (a hand), not the bones' middles"), margin: z.number().min(0).optional().describe("How much nearer or farther than the body to move (default 25)") }))
        .optional()
        .describe("Limbs drawn in front of or behind the body by their depth"),
      front: z.string().optional().describe("Part before which a limb nearer than the body is drawn"),
      back: z.string().optional().describe("Part after which a limb farther than the body is drawn"),
      body: z.array(z.string()).optional().describe("Bones whose depth is the body's (default body, neck)"),
      points: z
        .record(z.string(), z.strictObject({ bone: z.string(), at: z.tuple([z.number(), z.number(), z.number()]).describe("Offset from the bone's rest joint, body space") }))
        .optional()
        .describe("Named points on the 3D bones (the mouth, the chest): where the director's 3D reaches go"),
    })
    .optional()
    .describe("A 2.5D rig: its bones posed in 3D (rotations about the body's sideways axis, plus `turn` and `spread`) and projected for the current view each frame"),
});

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const Placement = {
  x: z.number().optional(),
  y: z.number().optional(),
  rotation: z.number().optional(),
  scale: z.union([z.number(), Vec2Schema]).optional(),
  z: z.number().optional(),
  parallax: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
};

export const BodySchema = z.strictObject({
  type: z.enum(["dynamic", "static", "kinematic"]),
  shape: z.union([z.strictObject({ circle: z.number().positive() }), z.strictObject({ box: Vec2Schema })]),
  restitution: z.number().optional(),
  friction: z.number().optional(),
  density: z.number().optional(),
  velocity: Vec2Schema.optional(),
  angularVelocity: z.number().optional(),
});

export const LayerSchema = z.strictObject({ id: z.string(), art: z.string(), ...Placement });

export const SurfaceSchema = z
  .strictObject({
    id: z.string(),
    path: z.string().describe("SVG path of the walkable top edge in scene space, drawn left to right"),
  })
  .describe("A ground line: actors/props with `ground` stand on it; rigid bodies collide with it");

const GroundRef = z
  .strictObject({
    surface: z.string(),
    offset: z.number().optional().describe("How far the feet sink into the surface (px, default 0)"),
    feet: z.array(z.string()).optional().describe("IK chain ids of the feet, adapted to the slope"),
  })
  .describe("Stand on a surface: y follows the ground at the current x");

// ---------------------------------------------------------------------------
// Lighting (scene)
// ---------------------------------------------------------------------------

const Color = z.string().describe("CSS color; hex colors (#rgb / #rrggbb) interpolate smoothly when animated");
const BlendMode = z.enum(["normal", "multiply", "screen", "overlay", "soft-light", "color", "color-dodge"]);

export const LightSchema = z
  .strictObject({
    id: z.string(),
    type: z.enum(["point", "directional"]),
    x: z.number().optional().describe("point: scene x"),
    y: z.number().optional().describe("point: scene y"),
    angle: z.number().optional().describe("directional: direction the light travels, degrees (90 = from above)"),
    color: Color.optional(),
    intensity: z.number().min(0).optional(),
    radius: z.number().positive().optional().describe("point: reach of the light in px"),
    glow: z.number().min(0).optional().describe("point: strength of the visible additive glow (0 = invisible light)"),
    parallax: z.number().optional(),
    flicker: z
      .strictObject({ amount: z.number().min(0).max(1).describe("How much of the intensity it loses at most"), speed: z.number().positive().optional().describe("Changes per second (default 6)") })
      .optional()
      .describe("A light that flickers by itself (a TV on, a candle, a fire): deterministic, by time"),
  })
  .describe("A light. Point lights glow and open the ambient darkness; the key light shades characters");

export const LightingSchema = z
  .strictObject({
    ambient: z
      .strictObject({ color: Color.optional(), opacity: z.number().min(0).max(1).optional() })
      .optional()
      .describe("Darkness laid over the whole scene (multiply); point lights cut through it"),
    lights: z.array(LightSchema).optional(),
    shading: z
      .strictObject({
        light: z.string().optional().describe("Key light id (default: first light)"),
        color: Color.optional(),
        opacity: z.number().min(0).max(1).optional(),
        rim: Color.optional(),
        rimOpacity: z.number().min(0).max(1).optional(),
        offset: z.number().min(0).optional().describe("Size of the shadow/rim crescents in scene px"),
        inset: z
          .number()
          .min(0)
          .optional()
          .describe("Keep shading this many scene px inside the silhouette edge, so outlines stay crisp (default 3.5)"),
        crowd: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("With more lit actors than this on screen, only the shadow crescent is drawn (no rim light): half the cost in crowd shots"),
        minHeight: z.number().min(0).optional().describe("Actors shorter than this on screen (px) get no shading (default 90: too small to see it)"),
      })
      .optional()
      .describe("Automatic cel shading on actors: shadow on the side away from the key light, rim light on the lit side"),
    grade: z
      .strictObject({ color: Color.optional(), opacity: z.number().min(0).max(1).optional(), blend: BlendMode.optional() })
      .optional()
      .describe("Full-frame color grading"),
    vignette: z.strictObject({ color: Color.optional(), opacity: z.number().min(0).max(1).optional() }).optional(),
  })
  .describe("Scene lighting: lights, ambient darkness, character cel shading, grading and vignette");

export const ActorSchema = z.strictObject({
  id: z.string(),
  character: z.string(),
  shading: z.boolean().optional().describe("Receive automatic cel shading from scene lighting (default true)"),
  ground: GroundRef.optional(),
  flip: z.boolean().optional(),
  palette: z.record(z.string(), z.string()).optional(),
  seed: z.union([z.number(), z.string()]).optional(),
  ...Placement,
});

export const CordSchema = z
  .strictObject({
    point: Vec2Schema.optional().describe("Where it is tied on this prop (its art's coordinates, default the origin)"),
    to: z
      .union([
        Vec2Schema.describe("A scene point (a phone box)"),
        z.strictObject({ actor: z.string(), anchor: z.string() }),
        z.strictObject({ prop: z.string(), point: Vec2Schema.optional() }),
        z.literal("up").describe("Straight up out of the picture (a prop hanging on a string)"),
      ])
      .describe("The other end"),
    length: z.number().positive().optional().describe("Rest length (scene px): shorter than the distance it stretches (coils open up), longer it sags"),
    coils: z.number().min(0).optional().describe("Loops of a coiled cord (a phone's); 0 = a plain string (default)"),
    radius: z.number().min(0).optional().describe("Coil radius (default 7)"),
    width: z.number().positive().optional().describe("Line width (default 3)"),
    color: z.string().optional(),
    cut: z.number().min(0).optional().describe("Time (s) it snaps: the far part springs back to `to`, the prop is let go"),
    z: z.number().optional().describe("Depth (default just behind the prop, or behind whoever holds it)"),
  })
  .describe("A cord or string from the prop to a point, an actor's anchor, another prop or up out of the picture, drawn every frame");

export const PropSchema = z.strictObject({
  id: z.string(),
  art: z.string(),
  body: BodySchema.optional(),
  ground: GroundRef.optional(),
  cord: CordSchema.optional(),
  ...Placement,
});

export const MouthCueSchema = z.strictObject({
  start: z.number(),
  end: z.number(),
  value: z.enum(VISEMES),
});

export const LipsyncSchema = z.object({ mouthCues: z.array(MouthCueSchema) });

const At = { at: z.number().min(0).describe("Start time in seconds") };
const ActorRef = { actor: z.string() };

export const ActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("play"),
    clip: z.string(),
    duration: z.number().positive().optional(),
    loop: z.boolean().optional(),
    speed: z.number().positive().optional(),
    fadeIn: z.number().min(0).optional(),
    fadeOut: z.number().min(0).optional(),
    layer: z.number().optional(),
    blend: z.enum(["override", "additive"]).optional(),
    weight: z.number().min(0).max(1).optional(),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("set"),
    channel: z.string(),
    value: ValueSchema,
    duration: z.number().min(0).optional(),
    ease: EaseSchema.optional(),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("pose"),
    control: z.string(),
    value: z.union([z.string(), z.null(), z.record(z.string(), z.number())]),
    duration: z.number().min(0).optional(),
    ease: EaseSchema.optional(),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("walkTo"),
    x: z.number(),
    y: z.number().optional(),
    duration: z.number().positive().optional(),
    speed: z.number().positive().optional(),
    clip: z.string().optional(),
    ease: EaseSchema.optional(),
  }),
  z.strictObject({ ...At, ...ActorRef, action: z.literal("face"), direction: z.enum(["left", "right"]) }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("mount"),
    on: z.union([z.string(), z.null()]).describe("Actor to ride (a bicycle, a horse…): this actor follows its anchor, rotation and facing; null gets off"),
    anchor: z.string().optional().describe('Anchor of the ridden actor that carries this one (default "seat")'),
    point: Vec2Schema.optional().describe("Point of this actor (character space, e.g. the hip joint) placed on the anchor (default the origin)"),
    duration: z.number().min(0).optional().describe("Blend from the previous placement (default 0.3 s)"),
    behind: z
      .array(z.string())
      .optional()
      .describe("Parts of this actor drawn just behind the ridden actor (e.g. the far leg behind a bicycle's frame)"),
    facing: z
      .enum(["ridden", "own"])
      .optional()
      .describe('"ridden" (default): face the way the ridden actor faces (a horse turning round); "own": keep this actor\'s own facing (seated on furniture drawn turned, facing the way the seat is turned)'),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("reach"),
    chain: z.string().describe("IK chain id (e.g. footF, handF)"),
    target: z
      .union([z.strictObject({ actor: z.string(), anchor: z.string() }), z.strictObject({ prop: z.string(), point: Vec2Schema, from: z.number().optional().describe("Where the forearm comes from at that point, degrees in the reaching actor's frame (0 = forward, 90 = from below): the elbow goes there, the upper arm foreshortened if needed") }), Vec2Schema, z.null()])
      .describe("Anchor of another actor (followed every frame: pedals, handlebar), a point of a prop (its grip, even one fitted to this actor's own body), a scene point, or null to let go"),
    duration: z.number().min(0).optional().describe("Blend in/out (default 0.3 s)"),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("lookAt"),
    target: z.union([z.string(), Vec2Schema, z.null()]),
    control: z.string().optional(),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("say"),
    audio: z.string().optional(),
    lipsync: z.string().optional(),
    cues: z.array(MouthCueSchema).optional(),
    text: z.string().optional(),
    duration: z.number().positive().optional(),
    control: z.string().optional(),
    volume: z.number().optional(),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("grab"),
    prop: z.string(),
    anchor: z.string(),
    fit: z
      .array(
        z.union([
          z.strictObject({ point: Vec2Schema.describe("A point of the prop's art"), anchor: z.string().describe("An anchor of the actor") }),
          z.strictObject({
            point: Vec2Schema,
            angle: z.number().describe("Second point only: the direction from the first point to this one, in degrees in the actor's frame (0 = forward, -90 = up), turning with the first anchor's bone"),
            fixed: z.boolean().optional().describe("Keep the direction in the actor's frame, not turning with the bone (a cigarette held upright between the fingers)"),
          }),
          z.strictObject({
            point: Vec2Schema,
            dir: z.tuple([z.number(), z.number(), z.number()]).describe("Second point only (2.5D rigs): the direction from the first point to this one in body space (x right, y down, z towards the viewer seen from the front), projected for the view every frame — the prop turns and foreshortens (along its x axis) as the body or head turns"),
            view: z.string().optional().describe("The pose control whose view the direction is seen in (default `view`; `head` for something on a head turned on its own)"),
          }),
        ]),
      )
      .min(1)
      .max(2)
      .optional()
      .describe("Fit the prop to the body: its first point on the first anchor, turned so its second point points at the second anchor (a phone: ear on the ear, mouthpiece towards the mouth) or in a direction (`angle`: a bottle's bottom up and forward); one point keeps the prop turning with that anchor's bone"),
  }),
  z.strictObject({
    ...At,
    ...ActorRef,
    action: z.literal("release"),
    prop: z.string(),
    velocity: Vec2Schema.optional(),
  }),
  z.strictObject({ ...At, action: z.literal("impulse"), prop: z.string(), vector: Vec2Schema }),
  z.strictObject({
    ...At,
    action: z.literal("camera"),
    x: z.number().optional(),
    y: z.number().optional(),
    zoom: z.number().positive().optional(),
    rotation: z.number().optional(),
    duration: z.number().min(0).optional(),
    ease: EaseSchema.optional(),
    follow: z
      .union([z.string(), z.null()])
      .optional()
      .describe("Actor id to follow from `at` (for `duration`, or until the next follow/frame); null stops"),
    offset: Vec2Schema.optional().describe("follow: framing offset from the actor's position (scene px)"),
    lag: z.number().min(0).optional().describe("follow / frame: smoothing lag in seconds (follow 0.3, frame 0.4)"),
    axes: z.enum(["x", "xy"]).optional().describe("follow: track only x (default) or x and y"),
    deadZone: Vec2Schema.optional().describe("follow: half size of the zone the actor can move in without moving the camera"),
    lookAhead: z.number().min(0).optional().describe("follow: lead the camera by this many seconds of the actor's velocity"),
    frame: z
      .union([z.array(z.string()).min(1), z.null()])
      .optional()
      .describe("Keep these actors/props framed (auto position + zoom) from `at`; null stops"),
    padding: z.number().min(0).optional().describe("frame: margin around the targets in scene px (default 80)"),
    on: z.enum(["body", "face"]).optional().describe('frame: what to keep in shot — whole bodies (default) or faces (the posed "face" anchor, else "head": close-ups that follow a sitting or moving character)'),
    minZoom: z.number().positive().optional(),
    maxZoom: z.number().positive().optional(),
    band: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("frame: fixed vertical extent [top, bottom] (scene y): the targets are framed horizontally only, so a jump or a flight does not move the camera up and down"),
    blend: z.number().min(0).optional().describe("follow/frame: transition time in and out (default 0.6 s)"),
    path: z.array(Vec2Schema).min(1).optional().describe("Move through these scene points along a smooth curve"),
    punch: z.number().optional().describe("Punch-in zoom: quick zoom multiplier pulse (e.g. 0.15)"),
    handheld: z.number().min(0).optional().describe("Handheld drift amplitude in px (0 = locked off)"),
    dolly: z.number().optional().describe("Vertigo/dolly zoom: background scale vs subject (0 = none)"),
    focus: z.union([z.number(), z.string()]).optional().describe("Depth in focus: a parallax value or an actor/prop/layer id"),
    blur: z.number().min(0).optional().describe("Depth-of-field strength: max blur in screen px (0 = off)"),
    focusRange: z.number().positive().optional().describe("Depth distance at which blur reaches `blur` (default 0.5)"),
    motionBlur: z.number().min(0).max(1).optional().describe("Motion blur shutter (0 = off, 0.5 = typical)"),
  }),
  z.strictObject({
    ...At,
    action: z.literal("transition"),
    type: z.enum(["fade", "iris", "wipe", "flash"]),
    duration: z.number().positive().optional(),
    mode: z.enum(["out", "in", "outIn"]).optional().describe("out = cover, in = uncover, outIn = cover then uncover (default)"),
    color: z.string().optional(),
    direction: z.enum(["left", "right", "up", "down"]).optional().describe("wipe direction (default right)"),
    target: z.union([z.string(), Vec2Schema]).optional().describe("iris center: actor/prop id or scene point (default screen center)"),
  }),
  z.strictObject({
    ...At,
    action: z.literal("fx"),
    type: z.enum(FX_TYPES).describe("Cartoon effect"),
    actor: z.string().optional().describe("Attach to this actor (follows it, flips and scales with it)"),
    anchor: z.string().optional().describe('Actor anchor (default "head" if present); "origin" = between the feet'),
    offset: Vec2Schema.optional().describe("Offset from the anchor in the character's setup space"),
    prop: z.string().optional().describe("At this prop (follows it as it moves)"),
    x: z.number().optional().describe("Scene x when not attached to an actor"),
    y: z.number().optional().describe("Scene y when not attached to an actor"),
    duration: z.number().positive().optional(),
    scale: z.number().positive().optional(),
    color: z.string().optional().describe("Ink color (default #1D2833)"),
    fill: z.string().optional().describe("Secondary color (drops, hearts, sparkles…)"),
    text: z.string().optional().describe("caption: the text"),
    style: z.enum(CAPTION_STYLES).optional().describe("caption: title | impact | ko | place"),
    angle: z.number().optional().describe("speedLines: direction of travel in degrees (0 = to the right)"),
  }),
  z.strictObject({
    ...At,
    action: z.literal("shake"),
    duration: z.number().positive().optional(),
    amount: z.number().optional(),
    frequency: z.number().positive().optional(),
  }),
  z.strictObject({ ...At, action: z.literal("sound"), audio: z.string(), volume: z.number().optional() }),
  z.strictObject({
    ...At,
    action: z.literal("light"),
    channel: z.string().describe("Lighting channel, e.g. lights.sun.intensity, lighting.ambient.opacity"),
    value: ValueSchema,
    duration: z.number().min(0).optional(),
    ease: EaseSchema.optional(),
  }),
]);

export const SceneSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal("toon-scene"),
  version: z.literal(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  duration: z.number().positive(),
  background: z.string().optional(),
  characters: z.record(z.string(), z.string()).describe("Character id → path/URL of a .toon.json"),
  audio: z.record(z.string(), z.string()).optional(),
  lipsync: z.record(z.string(), z.string()).optional(),
  world: z
    .strictObject({
      gravity: Vec2Schema.optional(),
      ground: z.number().optional(),
      walls: z.boolean().optional(),
      rate: z.number().positive().optional(),
      surfaces: z.array(SurfaceSchema).optional().describe("Walkable ground lines (branches, hills, floors)"),
    })
    .optional(),
  camera: z
    .strictObject({
      x: z.number().optional(),
      y: z.number().optional(),
      zoom: z.number().positive().optional(),
      rotation: z.number().optional(),
      handheld: z.number().min(0).optional(),
      dolly: z.number().optional(),
      focus: z.union([z.number(), z.string()]).optional(),
      blur: z.number().min(0).optional(),
      focusRange: z.number().positive().optional(),
      motionBlur: z.number().min(0).max(1).optional(),
      bounds: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional()
        .describe("[minX, minY, maxX, maxY]: the view never shows outside this scene area"),
    })
    .optional(),
  lighting: LightingSchema.optional(),
  layers: z.array(LayerSchema).optional(),
  actors: z.array(ActorSchema).optional(),
  props: z.array(PropSchema).optional(),
  tracks: TracksSchema.optional(),
  script: z.array(ActionSchema).optional(),
});

// ---------------------------------------------------------------------------
// Sequence (shots)
// ---------------------------------------------------------------------------

export const ShotTransitionSchema = z.strictObject({
  type: z.enum(["cut", "crossfade", "fade", "iris", "wipe", "flash"]),
  duration: z.number().min(0).optional(),
  color: z.string().optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  target: z.union([z.string(), Vec2Schema]).optional().describe("iris center: actor id or screen point"),
});

export const SequenceSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal("toon-sequence"),
  version: z.literal(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  scenes: z.record(z.string(), z.string()).describe("Scene id → path/URL of a .scene.json"),
  shots: z
    .array(
      z.strictObject({
        scene: z.string(),
        from: z.number().min(0).optional().describe("Start time inside the scene (default 0)"),
        duration: z.number().positive().optional().describe("Shot length (default: rest of the scene)"),
        transition: ShotTransitionSchema.optional().describe("Transition from the previous shot into this one"),
        muteSpeech: z.boolean().optional().describe("Show the scene without its speech (no lip sync, no voice audio): replays under other audio"),
          speed: z.number().refine((v) => v !== 0, "speed cannot be 0").optional().describe("Scene seconds per shot second (default 1); negative plays it backwards from `from` (a tape rewinding). A shot not at speed 1 is silent"),
          overlay: z.enum(["vhs"]).optional().describe("Drawn over the shot: `vhs` — a tape rewinding (scanlines, a rolling tracking band, colour fringes, ◀◀)"),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Value = z.infer<typeof ValueSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Tracks = z.infer<typeof TracksSchema>;
export type BoneDef = z.infer<typeof BoneSchema>;
export type PartDef = z.infer<typeof PartSchema>;
export type RigidPartDef = z.infer<typeof RigidPartSchema>;
export type SwitchPartDef = z.infer<typeof SwitchPartSchema>;
export type SkinnedPartDef = z.infer<typeof SkinnedPartSchema>;
export type HosePartDef = z.infer<typeof HosePartSchema>;
export type MorphPartDef = z.infer<typeof MorphPartSchema>;
export type AnchorDef = z.infer<typeof AnchorSchema>;
export type IkDef = z.infer<typeof IkSchema>;
export type ColliderDef = z.infer<typeof ColliderSchema>;
export type PhysicsDef = z.infer<typeof PhysicsSchema>;
export type SpringPhysicsDef = z.infer<typeof SpringPhysicsSchema>;
export type JigglePhysicsDef = z.infer<typeof JigglePhysicsSchema>;
export type ControlDef = z.infer<typeof ControlSchema>;
export type VisemeControlDef = z.infer<typeof VisemeControlSchema>;
export type AimControlDef = z.infer<typeof AimControlSchema>;
export type PoseControlDef = z.infer<typeof PoseControlSchema>;
export type BehaviorDef = z.infer<typeof BehaviorSchema>;
export type ClipDef = z.infer<typeof ClipSchema>;
export type ToonDoc = z.infer<typeof ToonSchema>;

export type BodyDef = z.infer<typeof BodySchema>;
export type LayerDef = z.infer<typeof LayerSchema>;
export type LightDef = z.infer<typeof LightSchema>;
export type LightingDef = z.infer<typeof LightingSchema>;
export type ActorDef = z.infer<typeof ActorSchema>;
export type PropDef = z.infer<typeof PropSchema>;
export type MouthCue = z.infer<typeof MouthCueSchema>;
export type LipsyncDoc = z.infer<typeof LipsyncSchema>;
export type ActionDef = z.infer<typeof ActionSchema>;
export type SceneDoc = z.infer<typeof SceneSchema>;
export type SurfaceDef = z.infer<typeof SurfaceSchema>;
export type SequenceDoc = z.infer<typeof SequenceSchema>;
export type ShotTransitionDef = z.infer<typeof ShotTransitionSchema>;
