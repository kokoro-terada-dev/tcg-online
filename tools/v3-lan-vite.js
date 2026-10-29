import { createServer } from "vite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPrivateV3Host } from "./v3-lan-options.js";

export async function startV3LanVite({ host, port, target }) {
  if (process.env.NODE_ENV === "production" || !isPrivateV3Host(host) || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid isolated v3 LAN configuration");
  const backend = new URL(target);
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || !backend.port || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) throw Error("V3 proxy target must be a local loopback backend");
  const server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), clearScreen: false,
    plugins: [{ name: "v3-lan-exact-host", configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.headers.host === `${host}:${port}`) next(); else { res.statusCode = 403; res.end("Host not allowed"); }
    }); } }],
    server: { host, port, strictPort: true, allowedHosts: [host], proxy: { "/v3-socket.io": { target: backend.origin, ws: true, changeOrigin: true,
      rewrite: path => path.replace(/^\/v3-socket\.io/, "/socket.io") } } },
  });
  try { await server.listen(); return server; } catch (error) { await server.close(); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startV3LanVite({ host: process.env.TCG_V3_LAN_HOST, port: Number(process.env.TCG_V3_LAN_PORT), target: process.env.TCG_V3_BACKEND });
  server.printUrls();
  const stop = async () => { await server.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
