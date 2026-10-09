/**
 * Building blocks for storybook cartoon characters (profile view, facing right, feet at y = 0).
 *
 * Characters built with the kit share bone names — root, ground, hips, body, head, pupils,
 * armF1/armF2/handF (near arm), armB1/armB2/handB (far arm), legF1/legF2/footF and
 * legB1/legB2/footB — so one set of gesture clips (`characterClips`), emotion poses and the
 * director's staging work for every character. Colours use palette tokens; `palette(ink)` is the
 * outline colour.
 */

export type P = [number, number];
export type Tracks = Record<string, (number | string)[][]>;
export const r = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ shared pieces

/** Mouth as one closed path (morph-compatible): corners L/R, top and bottom lips. */
export function mouthPath(L: P, R: P, open: number, smile: number, round: number): string {
  const w = R[0] - L[0];
  const l: P = [L[0] + w * round * 0.22, L[1] - smile * 4];
  const rr: P = [R[0] - w * round * 0.22, R[1] - smile * 6];
  const mx = (l[0] + rr[0]) / 2;
  const topY = (l[1] + rr[1]) / 2 + smile * 3 - open * 0.15;
  const botY = (l[1] + rr[1]) / 2 + smile * 4 + open;
  return `M${r(l[0])} ${r(l[1])} Q${r(mx)} ${r(topY)} ${r(rr[0])} ${r(rr[1])} Q${r(mx)} ${r(botY + open * 0.4)} ${r(l[0])} ${r(l[1])} Z`;
}

/** Viseme mouths + expression shapes for a mouth with corners L/R. */
export function mouthShapes(L: P, R: P, scale = 1) {
  const m = (o: number, s: number, rd: number) => mouthPath(L, R, o * scale, s, rd);
  return {
    base: m(1.5, 0.7, 0),
    shapes: {
      A: m(0.8, 0.4, 0.05),
      B: m(6, 0.6, 0.05),
      C: m(12, 0.5, 0.1),
      D: m(18, 0.4, 0),
      E: m(13, 0.2, 0.45),
      F: m(7, 0, 0.75),
      G: m(4, 0.5, 0.1),
      H: m(10, 0.4, 0.15),
      smile: m(4, 2.2, 0),
      frown: m(1.5, -1.4, 0.1),
      grin: m(14, 2.4, 0),
    },
  };
}

/** A round storybook eye (white + outline). */
export const eyeWhite = (c: P, rad: number, extra = "") =>
  `<circle cx="${c[0]}" cy="${c[1]}" r="${rad}" fill="#fff" stroke="palette(ink)" stroke-width="3"/>${extra}`;
export const eyeArc = (c: P, rad: number, up: boolean) =>
  `<path d="M${c[0] - rad} ${c[1]} Q${c[0]} ${c[1] + (up ? -rad * 1.1 : rad * 0.9)} ${c[0] + rad} ${c[1]}" fill="none" stroke="palette(ink)" stroke-width="3.6" stroke-linecap="round"/>`;
/** Eye with the top covered by a lid of the skin colour (half-closed / sleepy). */
export const eyeLid = (c: P, rad: number, k: number, skin: string, id: string) => {
  const y = c[1] - rad + 2 * rad * k;
  return (
    `<clipPath id="${id}"><circle cx="${c[0]}" cy="${c[1]}" r="${rad}"/></clipPath>` +
    `<rect x="${c[0] - rad - 2}" y="${c[1] - rad - 2}" width="${rad * 2 + 4}" height="${r(y - c[1] + rad + 2)}" fill="${skin}" clip-path="url(#${id})"/>` +
    `<path d="M${c[0] - rad + 1} ${r(y)} H${c[0] + rad - 1}" stroke="palette(ink)" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="${c[0]}" cy="${c[1]}" r="${rad}" fill="none" stroke="palette(ink)" stroke-width="3"/>`
  );
};

export interface EyeSpec {
  eyes: [P, P];
  rad: number;
  skin: string;
  /** Pupil radius. */
  pupil: number;
  /** Always draw a resting lid at this height (0..1), e.g. sleepy or elderly characters. */
  restLid?: number;
}

export function eyeArt(e: EyeSpec) {
  const both = (fn: (c: P, i: number) => string) => e.eyes.map(fn).join("");
  const rest = (c: P, i: number) => (e.restLid ? eyeLid(c, e.rad, e.restLid, e.skin, `lid${i}`) : "");
  return {
    open: both((c, i) => eyeWhite(c, e.rad)),
    wide: both((c) => eyeWhite(c, e.rad + 2.5)),
    closed: both((c) => eyeArc(c, e.rad * 0.85, false)),
    happy: both((c) => eyeArc(c, e.rad * 0.85, true)),
    half: both((c, i) => eyeWhite(c, e.rad)),
    lids: both(rest),
    halfLids: both((c, i) => eyeLid(c, e.rad, Math.max(0.45, e.restLid ?? 0), e.skin, `hl${i}`)),
    pupils: both(
      (c) =>
        `<circle cx="${r(c[0] + e.rad * 0.3)}" cy="${r(c[1] + 1)}" r="${e.pupil}" fill="palette(ink)"/><circle cx="${r(c[0] + e.rad * 0.3 + e.pupil * 0.35)}" cy="${r(c[1] - e.pupil * 0.4)}" r="${r(Math.max(1.5, e.pupil * 0.3))}" fill="#fff"/>`,
    ),
  };
}

/** Brows as one morph path (two strokes), with raised / sad / cross / smug shapes. */
export function browShapes(eyes: [P, P], rad: number, lift = 10) {
  const brow = (c: P, dy: number, tiltIn: number) => {
    const y = c[1] - rad - lift + dy;
    return `M${r(c[0] - rad * 0.7)} ${r(y + tiltIn)} Q${r(c[0])} ${r(y - 4)} ${r(c[0] + rad * 0.7)} ${r(y - tiltIn)}`;
  };
  const both = (dy: number, tilt: number) => brow(eyes[0], dy, tilt) + " " + brow(eyes[1], dy, tilt);
  return { base: both(0, 0), shapes: { up: both(-8, 0), sad: both(-2, -5), cross: both(3, 5), smug: brow(eyes[0], 2, 2) + " " + brow(eyes[1], -6, -2) } };
}

/** Bones every cast member has (near/far arm and leg chains, feet that stay flat). */
export function limbBones(o: {
  shoulderF: P; elbowF: P; handF: P;
  shoulderB: P; elbowB: P; handB: P;
  hipF: P; kneeF: P; footF: P; toeF: number;
  hipB: P; kneeB: P; footB: P; toeB: number;
}) {
  return [
    { id: "armB1", parent: "body", from: o.shoulderB, to: o.elbowB, mass: 0.5 },
    { id: "armB2", parent: "armB1", from: o.elbowB, to: o.handB, mass: 0.4 },
    { id: "handB", parent: "armB2", from: o.handB },
    { id: "armF1", parent: "body", from: o.shoulderF, to: o.elbowF, mass: 0.5 },
    { id: "armF2", parent: "armF1", from: o.elbowF, to: o.handF, mass: 0.4 },
    { id: "handF", parent: "armF2", from: o.handF },
    { id: "legB1", parent: "hips", from: o.hipB, to: o.kneeB, mass: 0.6 },
    { id: "legB2", parent: "legB1", from: o.kneeB, to: o.footB, mass: 0.5 },
    { id: "footB", parent: "legB2", from: o.footB, to: [o.footB[0] + o.toeB, o.footB[1]], inheritRotation: false },
    { id: "legF1", parent: "hips", from: o.hipF, to: o.kneeF, mass: 0.6 },
    { id: "legF2", parent: "legF1", from: o.kneeF, to: o.footF, mass: 0.5 },
    { id: "footF", parent: "legF2", from: o.footF, to: [o.footF[0] + o.toeF, o.footF[1]], inheritRotation: false },
  ];
}

export const limbIk = [
  // Knees bend forward, in the walking direction (like the rest pose).
  { id: "footF", bones: ["legF1", "legF2"], bend: 1 },
  { id: "footB", bones: ["legB1", "legB2"], bend: 1 },
  // Off by default; `hold_hands` turns them on and aims the hand at the partner's hand.
  { id: "handF", bones: ["armF1", "armF2"], bend: 1, mix: 0 },
  { id: "handB", bones: ["armB1", "armB2"], bend: 1, mix: 0 },
];

// ------------------------------------------------------------------ clips

export interface Gait {
  /** Half step amplitude (px): the foot travels ±a while planted. */
  a: number;
  lift: number;
  dur: number;
  bob: number;
  lean: number;
  armSwing: number;
}

/** Locomotion cycle: feet glide linearly while planted (no sliding), body bobs twice per cycle. */
export function gait(g: Gait, arms = true): { duration: number; loop: boolean; stride: number; tracks: Tracks } {
  const d = g.dur;
  const q = d / 4;
  const t: Tracks = {
    "ik.footF.x": [[0, g.a], [2 * q, -g.a, "linear"], [3 * q, 0], [d, g.a]],
    "ik.footF.y": [[0, 0], [2 * q, 0, "linear"], [3 * q, -g.lift], [d, 0]],
    "ik.footB.x": [[0, -g.a], [q, 0], [2 * q, g.a], [d, -g.a, "linear"]],
    "ik.footB.y": [[0, 0], [q, -g.lift], [2 * q, 0], [d, 0, "linear"]],
    "bones.hips.y": [[0, g.bob], [q, -g.bob], [2 * q, g.bob], [3 * q, -g.bob], [d, g.bob]],
    "bones.body.rotation": [[0, g.lean], [q, g.lean + 1.5], [2 * q, g.lean], [3 * q, g.lean + 1.5], [d, g.lean]],
    "bones.head.rotation": [[0, -g.lean * 0.6], [q, -g.lean * 0.6 + 2], [2 * q, -g.lean * 0.6], [3 * q, -g.lean * 0.6 + 2], [d, -g.lean * 0.6]],
  };
  if (arms) {
    t["bones.armF1.rotation"] = [[0, g.armSwing], [2 * q, -g.armSwing], [d, g.armSwing]];
    t["bones.armF2.rotation"] = [[0, -6], [2 * q, -g.armSwing * 0.8], [d, -6]];
    t["bones.armB1.rotation"] = [[0, -g.armSwing], [2 * q, g.armSwing], [d, -g.armSwing]];
    t["bones.armB2.rotation"] = [[0, -g.armSwing * 0.8], [2 * q, -6], [d, -g.armSwing * 0.8]];
  }
  return { duration: d, loop: true, stride: 4 * g.a, tracks: t };
}

export interface ClipOptions {
  walk: Gait;
  run: Gait;
  /** The far hand is busy (e.g. holding a walking stick): gestures leave it alone. */
  busyFarHand?: boolean;
  /** Scale of gesture energy (< 1 for calmer characters). */
  energy?: number;
  jump: number;
  /** How far the forearm swings up in gestures (< 1 keeps a held object away from the face). */
  forearmLift?: number;
}

export function characterClips(o: ClipOptions) {
  const e = o.energy ?? 1;
  const k = (v: number) => r(v * e);
  const B = !o.busyFarHand; // far arm free?
  const fl = (v: number) => r(v * (o.forearmLift ?? 1));
  const farArm = (t: Tracks) => (B ? t : {});
  const clips: Record<string, unknown> = {
    idle: {
      duration: 3.2,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, 0], [1.6, 1.2], [3.2, 0]],
        "bones.head.rotation": [[0, 0], [1.1, -2.5], [2.2, 1.5], [3.2, 0]],
        "bones.armF1.rotation": [[0, 0], [1.6, -3], [3.2, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [1.6, 2.5], [3.2, 0]] }),
      },
    },
    walk: gait(o.walk),
    run: gait(o.run),
    // Talking gesture: the near hand opens out on stressed beats, head nods.
    talk: {
      duration: 1.6,
      loop: true,
      tracks: {
        "bones.head.rotation": [[0, 0], [0.3, -4], [0.6, 2], [0.95, -3], [1.3, 1], [1.6, 0]],
        "bones.body.rotation": [[0, 0], [0.8, -1.5], [1.6, 0]],
        "bones.armF1.rotation": [[0, k(-18)], [0.4, k(-38)], [0.8, k(-24)], [1.2, k(-42)], [1.6, k(-18)]],
        "bones.armF2.rotation": [[0, fl(-30)], [0.4, fl(-55)], [0.8, fl(-35)], [1.2, fl(-60)], [1.6, fl(-30)]],
      },
    },
    wave: {
      duration: 1.2,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, k(-92)], [0.6, k(-98)], [1.2, k(-92)]],
        "bones.armF2.rotation": [[0, fl(-18)], [0.3, fl(-58)], [0.6, fl(-14)], [0.9, fl(-58)], [1.2, fl(-18)]],
        "bones.armF1.squash": [[0, 0.2], [1.2, 0.2]],
        "bones.armF2.squash": [[0, 0.25], [1.2, 0.25]],
        "bones.head.rotation": [[0, -3], [0.6, -6], [1.2, -3]],
        "bones.body.rotation": [[0, -1], [0.6, -3], [1.2, -1]],
      },
    },
    point: {
      duration: 1,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, -88], [0.5, -92], [1, -88]],
        "bones.armF2.rotation": [[0, -4], [1, -4]],
        "bones.body.rotation": [[0, 3], [1, 3]],
        "bones.head.rotation": [[0, -2], [1, -2]],
      },
    },
    present: {
      duration: 1.4,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, -70], [0.7, -78], [1.4, -70]],
        "bones.armF2.rotation": [[0, -40], [0.7, -48], [1.4, -40]],
        "bones.head.rotation": [[0, -4], [1.4, -4]],
      },
    },
    clap: {
      duration: 0.5,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, -55], [0.25, -62], [0.5, -55]],
        "bones.armF2.rotation": [[0, -70], [0.25, -40, "easeIn"], [0.5, -70]],
        ...farArm({
          "bones.armB1.rotation": [[0, -70], [0.25, -66], [0.5, -70]],
          "bones.armB2.rotation": [[0, -10], [0.25, -48, "easeIn"], [0.5, -10]],
        }),
        "bones.head.rotation": [[0, -4], [0.25, -6], [0.5, -4]],
        "bones.hips.y": [[0, 0], [0.25, 2], [0.5, 0]],
      },
    },
    cheer: {
      duration: 0.8,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, k(-155)], [0.4, k(-165)], [0.8, k(-155)]],
        "bones.armF2.rotation": [[0, -10], [0.4, 10], [0.8, -10]],
        ...farArm({ "bones.armB1.rotation": [[0, k(155)], [0.4, k(165)], [0.8, k(155)]], "bones.armB2.rotation": [[0, 10], [0.4, -10], [0.8, 10]] }),
        "bones.root.y": [[0, 0], [0.12, 0], [0.4, -o.jump * 0.5, "sineOut"], [0.68, 0, "sineIn"], [0.8, 0]],
        "bones.head.rotation": [[0, -8], [0.8, -8]],
      },
    },
    dance: {
      duration: 1.2,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, -6], [0.6, 6], [1.2, -6]],
        "bones.head.rotation": [[0, 6], [0.6, -6], [1.2, 6]],
        "bones.hips.y": [[0, 0], [0.3, 5], [0.6, 0], [0.9, 5], [1.2, 0]],
        "bones.armF1.rotation": [[0, k(-120)], [0.6, k(-40)], [1.2, k(-120)]],
        "bones.armF2.rotation": [[0, -30], [0.6, -60], [1.2, -30]],
        ...farArm({ "bones.armB1.rotation": [[0, k(40)], [0.6, k(120)], [1.2, k(40)]], "bones.armB2.rotation": [[0, -60], [0.6, -30], [1.2, -60]] }),
        "ik.footF.y": [[0, 0], [0.3, -10], [0.6, 0], [1.2, 0]],
        "ik.footB.y": [[0, 0], [0.6, 0], [0.9, -10], [1.2, 0]],
      },
    },
    sing: {
      duration: 2,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, -3], [1, 3], [2, -3]],
        "bones.head.rotation": [[0, -6], [1, -2], [2, -6]],
        "bones.armF1.rotation": [[0, k(-60)], [1, k(-80)], [2, k(-60)]],
        "bones.armF2.rotation": [[0, -50], [1, -30], [2, -50]],
      },
    },
    think: {
      duration: 2.4,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, -30], [2.4, -30]],
        "bones.armF2.rotation": [[0, -128], [1.2, -122], [2.4, -128]],
        "bones.head.rotation": [[0, -8], [1.2, -11], [2.4, -8]],
        "bones.body.rotation": [[0, -2], [2.4, -2]],
      },
    },
    shrug: {
      duration: 1.2,
      tracks: {
        "bones.armF1.rotation": [[0, 0], [0.3, -40, "backOut"], [0.9, -40], [1.2, 0]],
        "bones.armF2.rotation": [[0, 0], [0.3, -80, "backOut"], [0.9, -80], [1.2, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [0.3, 30, "backOut"], [0.9, 30], [1.2, 0]], "bones.armB2.rotation": [[0, 0], [0.3, -70, "backOut"], [0.9, -70], [1.2, 0]] }),
        "bones.head.rotation": [[0, 0], [0.3, 10], [0.9, 10], [1.2, 0]],
        "bones.hips.y": [[0, 0], [0.3, -3], [0.9, -3], [1.2, 0]],
      },
    },
    laugh: {
      duration: 0.6,
      loop: true,
      tracks: {
        "bones.head.rotation": [[0, -12], [0.15, -6], [0.3, -13], [0.45, -6], [0.6, -12]],
        "bones.body.rotation": [[0, -3], [0.3, -1], [0.6, -3]],
        "bones.hips.y": [[0, 0], [0.15, 2], [0.3, 0], [0.45, 2], [0.6, 0]],
        "bones.armF1.rotation": [[0, -30], [0.6, -30]],
        "bones.armF2.rotation": [[0, -90], [0.3, -95], [0.6, -90]],
      },
    },
    cry: {
      duration: 0.8,
      loop: true,
      tracks: {
        "bones.head.rotation": [[0, 14], [0.2, 11], [0.4, 14], [0.6, 11], [0.8, 14]],
        "bones.body.rotation": [[0, 4], [0.8, 4]],
        "bones.armF1.rotation": [[0, -40], [0.8, -40]],
        "bones.armF2.rotation": [[0, -110], [0.4, -115], [0.8, -110]],
        "bones.hips.y": [[0, 1], [0.2, 3], [0.4, 1], [0.6, 3], [0.8, 1]],
      },
    },
    scared: {
      duration: 0.24,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, -3], [0.06, -5], [0.12, -3], [0.18, -5], [0.24, -3]],
        "bones.root.x": [[0, -1.5], [0.06, 1.5], [0.12, -1.5], [0.18, 1.5], [0.24, -1.5]],
        "bones.armF1.rotation": [[0, -60], [0.24, -60]],
        "bones.armF2.rotation": [[0, -90], [0.24, -90]],
        "bones.hips.y": [[0, 3], [0.24, 3]],
      },
    },
    jump: {
      duration: 0.8,
      tracks: {
        "bones.root.y": [[0, 0], [0.14, 0], [0.4, -o.jump, "sineOut"], [0.66, 0, "sineIn"], [0.8, 0]],
        "ik.footF.y": [[0, 0], [0.14, 0], [0.4, -12], [0.66, 0], [0.8, 0]],
        "ik.footB.y": [[0, 0], [0.14, 0], [0.4, -16], [0.66, 0], [0.8, 0]],
        "bones.hips.y": [[0, 0], [0.12, 8, "easeOut"], [0.24, -3], [0.62, 0], [0.7, 7, "easeOut"], [0.8, 0, "backOut"]],
        "bones.body.squash": [[0, 0], [0.12, -0.08, "easeOut"], [0.26, 0.08], [0.55, 0], [0.7, -0.07, "easeOut"], [0.8, 0, "backOut"]],
        "bones.armF1.rotation": [[0, 0], [0.12, 20], [0.34, k(-150)], [0.66, k(-60)], [0.8, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [0.12, -20], [0.34, k(150)], [0.66, k(60)], [0.8, 0]] }),
      },
    },
    // Bouncing a ball with the near hand (the scene animates the ball in sync, period 0.6 s).
    dribble: {
      duration: 0.6,
      loop: true,
      tracks: {
        // The hand meets the ball at the top (t = 0), rides it down, lets go, rises and waits.
        "bones.armF1.rotation": [[0, -62], [0.12, -40, "easeOut"], [0.45, -64], [0.6, -62]],
        "bones.armF2.rotation": [[0, -40], [0.12, -22, "easeOut"], [0.45, -42], [0.6, -40]],
        "bones.body.rotation": [[0, 3], [0.3, 5], [0.6, 3]],
        "bones.head.rotation": [[0, 6], [0.3, 9], [0.6, 6]],
        "bones.hips.y": [[0, 0], [0.3, 2], [0.6, 0]],
      },
    },
    // Throwing something up high with both hands.
    toss: {
      duration: 0.9,
      tracks: {
        "bones.hips.y": [[0, 0], [0.2, 6, "easeOut"], [0.4, -4, "backOut"], [0.9, 0]],
        "bones.armF1.rotation": [[0, -30], [0.2, -10], [0.4, -160, "backOut"], [0.9, -40]],
        ...farArm({ "bones.armB1.rotation": [[0, 20], [0.2, 10], [0.4, 160, "backOut"], [0.9, 40]] }),
        "bones.head.rotation": [[0, 0], [0.4, -14], [0.9, -10]],
      },
    },
    // Stopping right at the kerb: leaning forward, arms windmilling.
    teeter: {
      duration: 1.1,
      tracks: {
        "bones.body.rotation": [[0, 0], [0.15, 12, "easeOut"], [0.55, 8], [1.1, 0, "backOut"]],
        "bones.armF1.rotation": [[0, 0], [0.15, -150], [0.35, -60], [0.55, -150], [0.75, -60], [1.1, 0]],
        ...farArm({ "bones.armB1.rotation": [[0, 0], [0.15, 150], [0.35, 60], [0.55, 150], [0.75, 60], [1.1, 0]] }),
        "bones.hips.y": [[0, 0], [0.15, 3], [1.1, 0]],
      },
    },
    // Pointing up and forward (at a traffic light across the road).
    pointUp: {
      duration: 1.2,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, -104], [0.6, -108], [1.2, -104]],
        "bones.armF2.rotation": [[0, -20], [1.2, -20]],
        "bones.head.rotation": [[0, -10], [1.2, -10]],
      },
    },
    // Flapping both arms (wings) fast: arriving in a hurry, excitement, a bird taking off.
    flap: {
      duration: 0.28,
      loop: true,
      tracks: {
        "bones.armF1.rotation": [[0, k(-40)], [0.14, k(-120), "easeOut"], [0.28, k(-40), "easeIn"]],
        "bones.armF2.rotation": [[0, -10], [0.14, 20], [0.28, -10]],
        ...farArm({ "bones.armB1.rotation": [[0, k(40)], [0.14, k(120), "easeOut"], [0.28, k(40), "easeIn"]], "bones.armB2.rotation": [[0, 10], [0.14, -20], [0.28, 10]] }),
        "bones.hips.y": [[0, 0], [0.14, -3], [0.28, 0]],
        "bones.head.rotation": [[0, -4], [0.28, -4]],
      },
    },
    // Hand in hand (the IK target is set by the scene); a gentle sway.
    hold: {
      duration: 2,
      loop: true,
      tracks: {
        "bones.body.rotation": [[0, 0], [1, 1.5], [2, 0]],
        "bones.head.rotation": [[0, -3], [1, -5], [2, -3]],
      },
    },
  };
  return clips;
}

export const blinkAndBreathe = (period = 3.2) => [
  { type: "blink", id: "blink", part: "eyes", open: "open", closed: "closed", interval: [2, 4.6], duration: 0.14 },
  { type: "breathe", id: "breathe", bone: "body", amount: 0.012, period },
];

/** Emotion poses shared by the cast (mouth/brow morph weights, eye variants, head tilt). */
export const emotions = (extra: Record<string, Record<string, unknown>> = {}) => ({
  type: "pose" as const,
  poses: {
    neutral: { "parts.eyes.variant": "open" },
    happy: { "parts.eyes.variant": "open", "parts.mouth.morph.smile": 0.9, "parts.brows.morph.up": 0.35, "bones.head.rotation": -3 },
    joy: { "parts.eyes.variant": "happy", "parts.mouth.morph.grin": 0.8, "parts.brows.morph.up": 0.5, "bones.head.rotation": -6 },
    surprised: { "parts.eyes.variant": "wide", "parts.mouth.morph.E": 0.5, "parts.brows.morph.up": 1, "bones.head.rotation": -5 },
    sad: { "parts.eyes.variant": "open", "parts.mouth.morph.frown": 1, "parts.brows.morph.sad": 1, "bones.head.rotation": 8 },
    smug: { "parts.eyes.variant": "half", "parts.mouth.morph.smile": 0.7, "parts.brows.morph.smug": 1, "bones.head.rotation": -4 },
    scared: { "parts.eyes.variant": "wide", "parts.mouth.morph.frown": 0.7, "parts.brows.morph.sad": 1 },
    angry: { "parts.eyes.variant": "open", "parts.mouth.morph.frown": 0.9, "parts.brows.morph.cross": 1, "bones.head.rotation": 4 },
    ...extra,
  },
});

export const eyeSwitch = (bone: string) => ({
  id: "eyes",
  type: "switch",
  bone,
  variants: { open: "eyeOpen", wide: "eyeWide", closed: "eyeClosed", happy: "eyeHappy", half: "eyeOpen" },
  default: "open",
});

