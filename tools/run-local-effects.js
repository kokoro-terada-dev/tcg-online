import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { v3LanOptions } from "./v3-lan-options.js";
if (process.env.NODE_ENV === "production") throw new Error("Local effect fixtures are disabled in production");
const cwd = fileURLToPath(new URL("../", import.meta.url));
const lan = v3LanOptions(process.argv.slice(2), networkInterfaces());
const build = spawnSync(process.execPath, ["server/node_modules/typescript/bin/tsc", "-p", "server/tsconfig.json"], { cwd, stdio: "inherit", windowsHide: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const require = createRequire(import.meta.url);
const v3 = process.argv.includes("--v3");
const start = v3 ? require("../server/dist/test/effects/v3/localServer.js").startLocalV3Server : require("../server/dist/test/localEffects.js").startLocalEffectServer;
const service = await start(0, lan ? { lanOrigin: lan.origin } : {});
console.log(v3 ? "V3 LOCAL DEVELOPMENT: synthetic fixtures and a limited reviewed real-card preset. Not production or full card coverage." : "LOCAL FIXTURE ONLY: discard one hand card, then draw one. Not real card rules.");
console.log(`Effect backend: ${service.url}`);
console.log("Open the Vite Local URL below in two browser windows. Choose Test Battle in both.");
if (lan) console.log(`Trusted LAN devices only: open ${lan.origin} on both devices. Do not expose this development server to the Internet.`);
const vite = spawn(process.execPath, lan ? ["tools/v3-lan-vite.js"] : ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", v3 ? "5190" : "5189"], {
  cwd, stdio: "inherit", windowsHide: true, env: { ...process.env, VITE_TEST_SERVER_URL: lan ? "/" : service.url, VITE_V3_FIXTURE: v3 ? "1" : "0",
    VITE_V3_SOCKET_PATH: lan ? "/v3-socket.io" : "/socket.io", ...(lan ? { TCG_V3_LAN_HOST: lan.host, TCG_V3_LAN_PORT: String(lan.port), TCG_V3_BACKEND: service.url } : {}) },
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  vite.kill(); service.io.close(() => process.exit(code));
}
vite.on("error", () => stop(1)); vite.on("exit", code => stop(code ?? 0));
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());
