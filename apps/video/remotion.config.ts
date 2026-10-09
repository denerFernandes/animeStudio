import { existsSync } from "node:fs";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
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
