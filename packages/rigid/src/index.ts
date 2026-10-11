import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import {
  type CompiledProp,
  type CompiledScene,
  type RigidBodySampler,
  type SceneAssets,
  type SceneDoc,
  type Vec2,
  actorPlacement,
  actorPose,
  apply,
  compileScene,
  multiply,
  propPlacement,
} from "@animestudio/core";

/** Pixels per physics meter. Rapier is tuned for meter-scale worlds. */
const PPM = 100;
let ready: Promise<void> | null = null;

/** Initializes the Rapier WASM module once. */
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export const sceneHasBodies = (scene: CompiledScene): boolean => scene.props.some((p) => p.def.body);

/** Degrees → radians. */
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The shortest signed difference `b − a` between two angles in degrees, in (−180, 180]. */
const angleDelta = (a: number, b: number): number => ((((b - a) % 360) + 540) % 360) - 180;

/** Where a held prop was at a time, as the scene places it in the hand. */
interface HeldSample {
  t: number;
  x: number;
  y: number;
  rotation: number;
}

/**
 * Simulates all rigid bodies of a scene with deterministic Rapier at a fixed rate and attaches
 * the results (`scene.rigid`). Grabs make bodies kinematic and follow the scene's own held
 * placement (the anchor, `fit` and the anchor's `turn` included); releases hand them back to
 * the simulation with the hand's velocity (or the given one). Sample `i` is the state at time
 * `i / rate` for every body, held or free, like the character colliders.
 */
export async function bakeRigidBodies(scene: CompiledScene): Promise<CompiledScene> {
  if (!sceneHasBodies(scene)) return scene;
  await initRapier();
  // The bake reads the scene's own placements (tracks, hands); a sampler left by an earlier bake
  // would feed them its stale samples instead.
  delete scene.rigid;
  const world = scene.doc.world ?? {};
  const rate = world.rate ?? 120;
  const dt = 1 / rate;
  const gravity = world.gravity ?? [0, 1800];
  const physics = new RAPIER.World({ x: gravity[0] / PPM, y: gravity[1] / PPM });
  physics.timestep = dt;

  if (world.ground !== undefined) {
    const ground = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(scene.width / 2 / PPM, (world.ground + 500) / PPM));
    physics.createCollider(RAPIER.ColliderDesc.cuboid(100, 500 / PPM).setFriction(0.8), ground);
  }
  // Walkable surfaces (branches, hills) collide as static polylines.
  for (const surface of Object.values(scene.surfaces)) {
    if (surface.points.length < 2) continue;
    const verts = new Float32Array(surface.points.flatMap(([x, y]) => [x / PPM, y / PPM]));
    const body = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    physics.createCollider(RAPIER.ColliderDesc.polyline(verts).setFriction(0.8), body);
  }
  if (world.walls) {
    for (const x of [-500, scene.width + 500]) {
      const wall = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x / PPM, scene.height / 2 / PPM));
      physics.createCollider(RAPIER.ColliderDesc.cuboid(500 / PPM, 100), wall);
    }
  }

  const scriptedType = (def: NonNullable<CompiledProp["def"]["body"]>) =>
    def.type === "dynamic" ? RAPIER.RigidBodyType.Dynamic : def.type === "kinematic" ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Fixed;
  const bodies = scene.props
    .filter((p) => p.def.body)
    .map((prop) => {
      const def = prop.def.body!;
      const p0 = propPlacement(scene, prop, 0);
      const desc = new RAPIER.RigidBodyDesc(scriptedType(def));
      desc.setTranslation(p0.x / PPM, p0.y / PPM).setRotation(rad(p0.rotation));
      if (def.velocity) desc.setLinvel(def.velocity[0] / PPM, def.velocity[1] / PPM);
      if (def.angularVelocity) desc.setAngvel(rad(def.angularVelocity));
      const body = physics.createRigidBody(desc);
      const shape =
        "circle" in def.shape
          ? RAPIER.ColliderDesc.ball(def.shape.circle / PPM)
          : RAPIER.ColliderDesc.cuboid(def.shape.box[0] / 2 / PPM, def.shape.box[1] / 2 / PPM);
      shape
        .setRestitution(def.restitution ?? 0.3)
        .setFriction(def.friction ?? 0.5)
        .setDensity(def.density ?? 1);
      physics.createCollider(shape, body);
      // `trail`: the last few held placements, oldest first (the hand's velocity at a release).
      return { prop, def, body, samples: [] as number[], held: false, trail: [] as HeldSample[] };
    });
  type Body = (typeof bodies)[number];

  const isHeld = (prop: CompiledProp, time: number) => prop.grabs.some((g) => time >= g.start && time < g.end);
  /** A held placement to move the body to; remembered for the release velocity. */
  const holdAt = (b: Body, time: number): HeldSample => {
    const p = propPlacement(scene, b.prop, time);
    const sample = { t: time, x: p.x, y: p.y, rotation: p.rotation };
    const last = b.trail[b.trail.length - 1];
    if (!last || time > last.t) b.trail = [...b.trail.slice(-3), sample];
    return sample;
  };
  /** The hand's velocity (px/s) and spin (deg/s) over the last held placements. */
  const handVelocity = (trail: HeldSample[]): { v: Vec2; w: number } => {
    const first = trail[0];
    const last = trail[trail.length - 1];
    const span = last && first ? last.t - first.t : 0;
    if (!(span > 0)) return { v: [0, 0], w: 0 };
    return { v: [(last.x - first.x) / span, (last.y - first.y) / span], w: angleDelta(first.rotation, last.rotation) / span };
  };

  // Character colliders: kinematic capsules that follow the animated bones.
  const boneSegment = (actor: CompiledScene["actors"][number], bone: number, t: number) => {
    const pose = actorPose(scene, actor, t);
    const m = multiply(actorPlacement(actor, t), pose.world[bone]);
    const a = apply(m, [0, 0]);
    const b = apply(m, [actor.rig.bones[bone].length, 0]);
    return { a, b, scale: Math.hypot(m[0], m[1]) };
  };
  const colliders = scene.actors.flatMap((actor) =>
    actor.rig.colliders.map((c) => {
      const { a, b, scale } = boneSegment(actor, c.bone, 0);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      const r = (c.radius * scale) / PPM;
      physics.createCollider(len > 1e-3 ? RAPIER.ColliderDesc.capsule(len / 2 / PPM, r) : RAPIER.ColliderDesc.ball(r), body);
      const place = (t: number, teleport: boolean) => {
        const seg = boneSegment(actor, c.bone, t);
        const center = { x: (seg.a[0] + seg.b[0]) / 2 / PPM, y: (seg.a[1] + seg.b[1]) / 2 / PPM };
        const angle = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]) - Math.PI / 2;
        if (teleport) {
          body.setTranslation(center, true);
          body.setRotation(angle, true);
        } else {
          body.setNextKinematicTranslation(center);
          body.setNextKinematicRotation(angle);
        }
      };
      place(0, true);
      return place;
    }),
  );

  // Each iteration samples the state at `t` and then steps the world to `t + dt`: kinematic
  // targets (hands, scripted props, colliders) are therefore set for `t + dt`.
  const steps = Math.ceil(scene.duration * rate) + 1;
  for (let n = 0; n < steps; n++) {
    const t = n * dt;
    for (const b of bodies) {
      const grab = b.prop.grabs.find((g) => t >= g.start && t < g.end);
      if (grab) {
        if (!b.held) {
          // Taken: into the hand right now, so this sample is already held.
          const p = holdAt(b, t);
          b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          b.body.setTranslation({ x: p.x / PPM, y: p.y / PPM }, true);
          b.body.setRotation(rad(p.rotation), true);
          b.held = true;
        }
        // Where the hand is at the next sample; a grab that ends within the step keeps its last position.
        const p = holdAt(b, isHeld(b.prop, t + dt) ? t + dt : t);
        b.body.setNextKinematicTranslation({ x: p.x / PPM, y: p.y / PPM });
        b.body.setNextKinematicRotation(rad(p.rotation));
      } else if (b.held) {
        // Released: back to its scripted type (simulated, scripted or fixed), thrown with the hand's velocity.
        const released = b.prop.grabs.filter((g) => g.end <= t).sort((g1, g2) => g2.end - g1.end)[0];
        b.body.setBodyType(scriptedType(b.def), true);
        if (b.def.type === "dynamic") {
          const hand = handVelocity(b.trail);
          const v = released?.releaseVelocity ?? hand.v;
          b.body.setLinvel({ x: v[0] / PPM, y: v[1] / PPM }, true);
          b.body.setAngvel(rad(hand.w), true);
        }
        b.held = false;
        b.trail = [];
      }
      if (!grab && b.def.type === "kinematic") {
        const p = propPlacement(scene, b.prop, t + dt);
        b.body.setNextKinematicTranslation({ x: p.x / PPM, y: p.y / PPM });
        b.body.setNextKinematicRotation(rad(p.rotation));
      }
      // Impulses are velocity changes in px/s.
      for (const imp of b.prop.impulses) {
        if (imp.at >= t && imp.at < t + dt) {
          const m = b.body.mass();
          b.body.applyImpulse({ x: (imp.vector[0] / PPM) * m, y: (imp.vector[1] / PPM) * m }, true);
        }
      }
      const tr = b.body.translation();
      b.samples.push(tr.x * PPM, tr.y * PPM, (b.body.rotation() * 180) / Math.PI);
    }
    for (const place of colliders) place(t + dt, false);
    physics.step();
  }

  const byId = new Map(bodies.map((b) => [b.prop.id, b.samples]));
  const sampler: RigidBodySampler = {
    sample(propId, t) {
      const s = byId.get(propId);
      if (!s) return undefined;
      const count = s.length / 3;
      const u = Math.min(Math.max(t * rate, 0), count - 1);
      const i = Math.floor(u);
      const j = Math.min(i + 1, count - 1);
      const f = u - i;
      const lerp = (k: number) => s[i * 3 + k] + (s[j * 3 + k] - s[i * 3 + k]) * f;
      // Rapier reports angles in (−180, 180]: interpolate the short way round across the seam.
      const rotation = s[i * 3 + 2] + angleDelta(s[i * 3 + 2], s[j * 3 + 2]) * f;
      return { x: lerp(0), y: lerp(1), rotation };
    },
  };
  physics.free();
  scene.rigid = sampler;
  return scene;
}

/** Compiles a scene and bakes its rigid bodies (if any). */
export async function prepareScene(doc: SceneDoc, assets: SceneAssets): Promise<CompiledScene> {
  return bakeRigidBodies(compileScene(doc, assets));
}
