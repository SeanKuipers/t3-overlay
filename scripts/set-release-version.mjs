// CI only: stamps the release version and turns on signed updater artifacts.
// Local builds keep version 0.1.0 and skip signing, so they don't need the private key.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error(`usage: node scripts/set-release-version.mjs <x.y.z> (got "${version}")`);
  process.exit(1);
}

const path = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = JSON.parse(readFileSync(path, "utf8"));
config.version = version;
config.bundle.createUpdaterArtifacts = true;
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Release version ${version}, updater artifacts on.`);
