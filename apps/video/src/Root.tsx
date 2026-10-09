import { type LipsyncDoc, type SceneDoc, type ToonDoc, previewSceneDoc } from "@animestudio/core";
import { ToonComposition, toonMetadata } from "@animestudio/remotion";
import { Composition, Folder } from "remotion";
import pip from "../../../examples/characters/pip.toon.json";
import hello from "../../../examples/scenes/hello.scene.json";
import l1 from "../../../examples/scenes/audio/l1.cues.json";
import l2 from "../../../examples/scenes/audio/l2.cues.json";
import l3 from "../../../examples/scenes/audio/l3.cues.json";

const pipDoc = pip as unknown as ToonDoc;
const helloScene = hello as unknown as SceneDoc;
const helloAssets = {
  characters: { pip: pipDoc },
  lipsync: { l1, l2, l3 } as Record<string, LipsyncDoc>,
};

const clipScenes = Object.keys(pipDoc.clips ?? {}).map((clip) => ({
  clip,
  scene: previewSceneDoc(pipDoc, { clip, width: 1080, height: 1080, scale: 2.2, duration: 4, fps: 60 }),
}));
const clipAssets = { characters: { pip: pipDoc } };

export const RemotionRoot = () => (
  <>
    <Composition
      id="Hello"
      component={ToonComposition}
      {...toonMetadata(helloScene)}
      defaultProps={{ scene: helloScene, assets: helloAssets }}
    />
    <Folder name="Pip-clips">
      {clipScenes.map(({ clip, scene }) => (
        <Composition
          key={clip}
          id={`Pip-${clip}`}
          component={ToonComposition}
          {...toonMetadata(scene)}
          defaultProps={{ scene, assets: clipAssets }}
        />
      ))}
    </Folder>
  </>
);
