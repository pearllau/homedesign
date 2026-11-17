import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".tmp", "deploy", "jianzhu-windows-source.zip");
await mkdir(dirname(output), { recursive: true });
// An explicit allowlist keeps local credentials, Git history, build caches,
// screenshots, and dependency directories out of the deployment archive.
const entries = [
  "src", "public", "data/prices", "scripts/import-price-book.mjs", "scripts/sync-three-assets.mjs", "deploy/windows",
  "package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs",
  "tsconfig.json", "tsconfig.node.json", ".env.example",
];
const result = spawnSync("tar", ["-a", "-cf", output, ...entries], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Deployment archive creation failed");
const listing = spawnSync("tar", ["-tf", output], { encoding: "utf8" });
if (listing.status !== 0) throw new Error("Deployment archive verification failed");
const paths = listing.stdout.trim().split(/\r?\n/);
if (paths.some(path => /(^|\/)(?:\.git|node_modules|\.env\.local|\.dev\.vars[^/]*)(\/|$)/.test(path))) {
  throw new Error("Deployment archive contains a forbidden private file");
}
await readFile(output);
console.log(`Created ${output} (${paths.length} entries; no credentials included)`);
