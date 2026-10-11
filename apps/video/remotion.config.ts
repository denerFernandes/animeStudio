import { existsSync } from "node:fs";
import { Config } from "@remotion/cli/config";

// Picture quality first: frames captured as PNG (JPEG rings round a cartoon's hard black lines and
// flat colours), encoded at a near-lossless CRF with x264's slow preset. For a sharper upload render
// at `--scale 2` (4K): the raster path draws at the device pixel ratio, and video sites give a 4K
// upload a far higher bitrate.
Config.setVideoImageFormat("png");
Config.setCrf(14);
Config.setX264Preset("slow");
Config.setOverwriteOutput(true);

// Scene audio paths ("audio/l1.wav") resolve against the examples folder.
Config.setPublicDir("../../examples/scenes");

// On some macOS setups Remotion's bundled headless shell crashes at GPU init.
// Prefer an explicit REMOTION_BROWSER, then a system Chrome when available.
const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = process.env.REMOTION_BROWSER ?? (existsSync(systemChrome) ? systemChrome : undefined);
if (browser) {
  Config.setBrowserExecutable(browser);
  Config.setChromeMode("chrome-for-testing");
}
