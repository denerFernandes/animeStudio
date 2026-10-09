import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import {
  type CompiledScene,
  type RigidBodySampler,
  type SceneAssets,
  type SceneDoc,
  type Vec2,
  actorPlacement,
  actorPose,
  anchorPosition,
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

/**
 * Simulates all rigid bodies of a scene with deterministic Rapier at a fixed rate and attaches
 * the results (`scene.rigid`). Grabs make bodies kinematic and follow the actor's anchor;
 * releases hand them back to the simulation with the anchor's velocity (or the given one).
 */
export async function bakeRigidBodies(scene: CompiledScene): Promise<CompiledScene> {
  if (!sceneHasBodies(scene)) return scene;
  await initRapier();
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

  const bodies = scene.props
    .filter((p) => p.def.body)
    .map((prop) => {
      const def = prop.def.body!;
      const p0 = propPlacement(scene, prop, 0);
      const desc =
        def.type === "dynamic"
          ? RAPIER.RigidBodyDesc.dynamic()
          : def.type === "kinematic"
            ? RAPIER.RigidBodyDesc.kinematicPositionBased()
            : RAPIER.RigidBodyDesc.fixed();
      desc.setTranslation(p0.x / PPM, p0.y / PPM).setRotation((p0.rotation * Math.PI) / 180);
      if (def.velocity) desc.setLinvel(def.velocity[0] / PPM, def.velocity[1] / PPM);
      if (def.angularVelocity) desc.setAngvel((def.angularVelocity * Math.PI) / 180);
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
      return { prop, def, body, samples: [] as number[], held: false, lastAnchor: null as Vec2 | null };
    });

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

  const steps = Math.ceil(scene.duration * rate) + 1;
  for (let n = 0; n < steps; n++) {
    const t = n * dt;
    for (const b of bodies) {
      // Grabs: follow the anchor kinematically.
      const grab = b.prop.grabs.find((g) => t >= g.start && t < g.end);
      if (grab) {
        const p = anchorPosition(scene, grab.actor, grab.anchor, t);
        if (!b.held) {
          b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          b.body.setTranslation({ x: p[0] / PPM, y: p[1] / PPM }, true);
          b.held = true;
        }
        b.body.setNextKinematicTranslation({ x: p[0] / PPM, y: p[1] / PPM });
        b.lastAnchor = p;
      } else if (b.held) {
        const released = b.prop.grabs.find((g) => g.end <= t && g.end > t - dt * 1.5);
        b.body.setBodyType(b.def.type === "dynamic" ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.Fixed, true);
        let v: Vec2 = [0, 0];
        if (released?.releaseVelocity) v = released.releaseVelocity;
        else if (released && b.lastAnchor) {
          const prev = anchorPosition(scene, released.actor, released.anchor, Math.max(0, t - dt * 4));
          v = [(b.lastAnchor[0] - prev[0]) / (dt * 3), (b.lastAnchor[1] - prev[1]) / (dt * 3)];
        }
        b.body.setLinvel({ x: v[0] / PPM, y: v[1] / PPM }, true);
        b.held = false;
      } else if (b.def.type === "kinematic") {
        const p = propPlacement(scene, b.prop, t);
        b.body.setNextKinematicTranslation({ x: p.x / PPM, y: p.y / PPM });
        b.body.setNextKinematicRotation((p.rotation * Math.PI) / 180);
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
      return { x: lerp(0), y: lerp(1), rotation: lerp(2) };
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
