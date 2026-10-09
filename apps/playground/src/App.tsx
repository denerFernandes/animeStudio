import {
  type ActionDef,
  type CompiledScene,
  type LipsyncDoc,
  type SceneDoc,
  type ToonDoc,
  actorPlacement,
  actorPose,
  apply,
  cameraAt,
  compileScene,
  evaluateScene,
  multiply,
  previewSceneDoc,
  validateScene,
  validateToon,
  viewMatrix,
} from "@animestudio/core";
import { ToonFrame } from "@animestudio/react";
import { bakeRigidBodies } from "@animestudio/rigid";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import pipJson from "../../../examples/characters/pip.toon.json";
import helloJson from "../../../examples/scenes/hello.scene.json";
import l1 from "../../../examples/scenes/audio/l1.cues.json";
import l2 from "../../../examples/scenes/audio/l2.cues.json";
import l3 from "../../../examples/scenes/audio/l3.cues.json";

const pip = pipJson as unknown as ToonDoc;
const hello = helloJson as unknown as SceneDoc;
const helloLipsync = { l1, l2, l3 } as Record<string, LipsyncDoc>;

type Mode = "character" | "scene";

export function App() {
  const [mode, setMode] = useState<Mode>("character");
  const [character, setCharacter] = useState<ToonDoc>(pip);
  const [sceneDoc, setSceneDoc] = useState<SceneDoc>(hello);
  const [clip, setClip] = useState("idle");
  const [extra, setExtra] = useState<ActionDef[]>([]);
  const [lookAt, setLookAt] = useState<[number, number] | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [bonesOverlay, setBonesOverlay] = useState(false);
  const [sayText, setSayText] = useState("Olá! Eu sou o Pip e adoro pular!");
  const [json, setJson] = useState("");
  const [issues, setIssues] = useState("");
  const [compiled, setCompiled] = useState<CompiledScene | null>(null);
  const [muted, setMuted] = useState(false);

  // Build + compile ------------------------------------------------------------
  const doc = useMemo<SceneDoc>(() => {
    if (mode === "scene") return sceneDoc;
    const script: ActionDef[] = [];
    if (clip !== "idle" && character.clips?.idle) {
      script.push({ at: 0, actor: "actor", action: "play", clip: "idle", loop: true, layer: -1, fadeIn: 0 });
    }
    if (lookAt) script.push({ at: 0, actor: "actor", action: "lookAt", target: lookAt });
    script.push(...extra);
    return previewSceneDoc(character, {
      clip: clip === "rest" ? null : clip,
      width: 960,
      height: 720,
      scale: 1.7,
      duration: 20,
      script,
    });
  }, [mode, sceneDoc, character, clip, extra, lookAt]);

  useEffect(() => {
    let alive = true;
    try {
      const assets = mode === "scene" ? { characters: { pip: character }, lipsync: helloLipsync } : { characters: { [character.name]: character } };
      const c = compileScene(doc, assets);
      bakeRigidBodies(c).then((s) => alive && setCompiled({ ...s }));
      setIssues("");
    } catch (e) {
      setIssues((e as Error).message);
    }
    return () => {
      alive = false;
    };
  }, [doc, mode, character]);

  // Transport --------------------------------------------------------------------
  const duration = compiled?.duration ?? 1;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setTime((t) => (t + dt) % duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  // Audio (scene mode): restart sounds when playback (re)starts.
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  useEffect(() => {
    audioRefs.current.forEach((a) => a.pause());
    audioRefs.current = [];
    if (!compiled || !playing || muted || mode !== "scene" || speed !== 1) return;
    const timers = compiled.audio.map((ev) => {
      const el = new Audio(`/${ev.src}`);
      el.volume = Math.min(1, ev.volume);
      audioRefs.current.push(el);
      const delay = ev.start - time;
      if (delay >= 0) return window.setTimeout(() => el.play().catch(() => {}), delay * 1000);
      el.currentTime = -delay;
      el.play().catch(() => {});
      return 0;
    });
    return () => {
      timers.forEach((id) => clearTimeout(id));
      audioRefs.current.forEach((a) => a.pause());
    };
    // Only on play/pause or scene changes, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled, playing, muted, mode, speed]);

  const frame = useMemo(() => (compiled ? evaluateScene(compiled, time) : null), [compiled, time]);

  // Skeleton overlay ---------------------------------------------------------------
  const overlay = useMemo(() => {
    if (!compiled || !bonesOverlay) return null;
    const cam = cameraAt(compiled, time);
    return compiled.actors.flatMap((actor) => {
      const pose = actorPose(compiled, actor, time);
      const m = multiply(viewMatrix(compiled, cam, actor.def.parallax ?? 1), actorPlacement(actor, time));
      return actor.rig.bones.map((b, i) => {
        const w = multiply(m, pose.world[i]);
        const a = apply(w, [0, 0]);
        const tip = apply(w, [b.length, 0]);
        return (
          <g key={`${actor.id}-${b.id}`}>
            {b.length > 0 ? <line x1={a[0]} y1={a[1]} x2={tip[0]} y2={tip[1]} stroke="#1e88e5" strokeWidth={4} strokeLinecap="round" opacity={0.75} /> : null}
            <circle cx={a[0]} cy={a[1]} r={5} fill="#fff" stroke="#1e88e5" strokeWidth={2} />
          </g>
        );
      });
    });
  }, [compiled, bonesOverlay, time]);

  // Interactions -------------------------------------------------------------------
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (mode !== "character" || !compiled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * compiled.width;
    const y = ((e.clientY - rect.top) / rect.height) * compiled.height;
    setLookAt([Math.round(x), Math.round(y)]);
  };

  const at = Math.round(time * 100) / 100;
  const addAction = (a: ActionDef) => setExtra((xs) => [...xs, a]);
  const clips = ["rest", ...Object.keys(character.clips ?? {})];
  const emotions = Object.entries(character.controls ?? {}).flatMap(([name, c]) =>
    c.type === "pose" ? Object.keys(c.poses).map((p) => ({ control: name, pose: p })) : [],
  );

  const loadJson = () => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.format === "toon-scene") {
        const r = validateScene(parsed, { characters: { pip: character }, lipsync: helloLipsync });
        if (!r.ok) return setIssues(r.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
        setSceneDoc(r.value);
        setMode("scene");
      } else {
        const r = validateToon(parsed);
        if (!r.ok) return setIssues(r.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
        setCharacter(r.value);
        setClip(Object.keys(r.value.clips ?? {})[0] ?? "rest");
        setExtra([]);
        setMode("character");
      }
      setIssues("");
      setTime(0);
    } catch (e) {
      setIssues((e as Error).message);
    }
  };

  return (
    <div className="app">
      <aside className="side">
        <h1>animeStudio</h1>
        <label>
          Mode
          <select value={mode} onChange={(e) => (setMode(e.target.value as Mode), setTime(0))}>
            <option value="character">Character preview</option>
            <option value="scene">Scene (hello.scene.json)</option>
          </select>
        </label>

        {mode === "character" ? (
          <>
            <label>
              Clip
              <select value={clip} onChange={(e) => (setClip(e.target.value), setTime(0))}>
                {clips.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Emotion (at current time)
              <div className="row">
                {emotions.map(({ control, pose }) => (
                  <button key={pose} onClick={() => addAction({ at, actor: "actor", action: "pose", control, value: pose })}>
                    {pose}
                  </button>
                ))}
                <button onClick={() => addAction({ at, actor: "actor", action: "pose", control: emotions[0]?.control ?? "emotion", value: null })}>
                  neutral
                </button>
              </div>
            </label>
            <label>
              Say (text → lip sync)
              <input type="text" value={sayText} onChange={(e) => setSayText(e.target.value)} />
              <button className="primary" onClick={() => addAction({ at, actor: "actor", action: "say", text: sayText })}>
                Say at {at.toFixed(2)}s
              </button>
            </label>
            <div className="row">
              <button onClick={() => setLookAt(null)}>Stop looking</button>
              <button onClick={() => setExtra([])}>Clear actions</button>
            </div>
            <p className="hint">Click the stage to make the character look at that point.</p>
          </>
        ) : (
          <label className="check">
            <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} /> Audio
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={bonesOverlay} onChange={(e) => setBonesOverlay(e.target.checked)} /> Show skeleton
        </label>

        <label>
          Load a .toon.json or .scene.json
          <textarea rows={6} value={json} onChange={(e) => setJson(e.target.value)} placeholder="Paste JSON here" />
          <button onClick={loadJson}>Validate &amp; load</button>
        </label>
        {issues ? <div className="issues">{issues}</div> : null}
      </aside>

      <main className="stage">
        <div className="viewport" onClick={onStageClick}>
          {frame ? <ToonFrame frame={frame} width="100%" /> : null}
          {frame && overlay ? (
            <svg className="overlay" viewBox={`0 0 ${frame.width} ${frame.height}`}>
              {overlay}
            </svg>
          ) : null}
        </div>
        <div className="transport">
          <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
          <input
            type="range"
            min={0}
            max={duration}
            step={1 / 120}
            value={time}
            onChange={(e) => (setPlaying(false), setTime(Number(e.target.value)))}
          />
          <span>
            {time.toFixed(2)}s / {duration.toFixed(1)}s
          </span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
          </select>
        </div>
      </main>
    </div>
  );
}
