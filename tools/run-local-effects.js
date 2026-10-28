import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
if (process.env.NODE_ENV === "production") throw new Error("Local effect fixtures are disabled in production");
const cwd = fileURLToPath(new URL("../", import.meta.url));
const build = spawnSync(process.execPath, ["server/node_modules/typescript/bin/tsc", "-p", "server/tsconfig.json"], { cwd, stdio: "inherit", windowsHide: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const require = createRequire(import.meta.url);
const { startLocalEffectServer } = require("../server/dist/test/localEffects.js");
const service = await startLocalEffectServer(0);
console.log("LOCAL FIXTURE ONLY: discard one hand card, then draw one. Not real card rules.");
console.log(`Effect backend: ${service.url}`);
console.log("Open the Vite Local URL below in two browser windows. Choose Test Battle in both.");
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5189"], {
  cwd, stdio: "inherit", windowsHide: true, env: { ...process.env, VITE_TEST_SERVER_URL: service.url },
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  vite.kill(); service.io.close(() => process.exit(code));
}
vite.on("error", () => stop(1)); vite.on("exit", code => stop(code ?? 0));
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());
