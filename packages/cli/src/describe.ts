import { type ToonDoc, compileRig } from "@animestudio/core";

/**
 * Human/AI-readable summary of a character: everything that can be animated and how.
 * Designed to be pasted into an LLM prompt before asking it to write a scene.
 */
export function describeCharacter(doc: ToonDoc): string {
  const rig = compileRig(doc);
  const lines: string[] = [];
  lines.push(`# Character "${rig.name}"`);
  if (doc.meta?.description) lines.push(String(doc.meta.description));
  lines.push("");
  lines.push("## Controls (prefer these)");
  for (const c of Object.values(rig.controls)) {
    if (c.type === "pose") lines.push(`- controls.${c.name} (pose): ${Object.keys(c.poses).join(" | ")} — or a weight blend {name: weight}`);
    else if (c.type === "viseme") lines.push(`- controls.${c.name} (viseme): A B C D E F G H X — driven by the "say" action`);
    else lines.push(`- controls.${c.name} (aim): [x, y] or an actor/prop id — driven by the "lookAt" action`);
  }
  lines.push("");
  lines.push("## Clips");
  for (const c of Object.values(rig.clips)) {
    lines.push(`- ${c.name}: ${c.duration}s${c.loop ? ", loop" : ""}${c.stride ? `, stride ${c.stride}px` : ""}`);
  }
  lines.push("");
  lines.push("## Anchors");
  for (const [k, a] of Object.entries(rig.anchors)) lines.push(`- ${k} (bone ${rig.bones[a.bone].id})`);
  lines.push("");
  lines.push("## Channels");
  lines.push(`- bones.<id>.(rotation|x|y|scaleX|scaleY|squash) for bones: ${rig.bones.map((b) => b.id).join(", ")}`);
  const switches = rig.parts.filter((p) => p.type === "switch");
  for (const p of switches) if (p.type === "switch") lines.push(`- parts.${p.id}.variant: ${Object.keys(p.variants).join(" | ")}`);
  for (const p of rig.parts) if (p.type === "morph") lines.push(`- parts.${p.id}.morph.<shape>: ${Object.keys(p.shapes).join(", ")}`);
  lines.push(`- parts.<id>.opacity for parts: ${rig.parts.map((p) => p.id).join(", ")}`);
  for (const k of rig.ik) lines.push(`- ik.${k.id}.(x|y|mix): IK target offset for ${k.bones.map((b) => rig.bones[b].id).join(" → ")}`);
  for (const b of rig.behaviors) lines.push(`- behaviors.${b.id}.mix (${b.type})`);
  return lines.join("\n");
}
