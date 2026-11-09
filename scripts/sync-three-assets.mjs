import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const source = dirname(dirname(require.resolve("three")));
const target = join(root, "public/vendor/three-0.160.0");
const files = [
  ["build/three.module.min.js", "three.module.min.js"],
  ["LICENSE", "LICENSE"],
  ...[
    "controls/OrbitControls.js",
    "controls/PointerLockControls.js",
    "geometries/RoundedBoxGeometry.js",
    "environments/RoomEnvironment.js",
    "renderers/CSS2DRenderer.js",
  ].map((file) => [`examples/jsm/${file}`, `addons/${file}`]),
];
for (const [from, to] of files) {
  const destination = join(target, to);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(source, from), destination);
}
console.log("3D resources copied for same-origin delivery.");
