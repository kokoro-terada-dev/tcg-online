import { isIPv4 } from "node:net";

export function isPrivateV3Host(host) {
  if (typeof host !== "string" || !isIPv4(host)) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}
export function v3LanOptions(argv, interfaces) {
  const requested = argv.includes("--lan"), hostArg = argv.find(arg => arg.startsWith("--lan-host=")), portArg = argv.find(arg => arg.startsWith("--lan-port="));
  if (!requested) { if (hostArg || portArg) throw Error("Use --lan with LAN options"); return null; }
  if (!argv.includes("--v3")) throw Error("LAN mode is available only for the isolated v3 server");
  const hosts = [...new Set(Object.values(interfaces).flatMap(rows => rows ?? []).filter(row => !row.internal && (row.family === "IPv4" || row.family === 4) && isPrivateV3Host(row.address)).map(row => row.address))];
  const host = hostArg?.slice("--lan-host=".length) ?? (hosts.length === 1 ? hosts[0] : null), port = portArg ? Number(portArg.slice("--lan-port=".length)) : 5191;
  if (!host || !hosts.includes(host)) throw Error(`Choose a local private IPv4 address with --lan-host=ADDRESS. Available: ${hosts.join(", ") || "none"}`);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("LAN port must be an integer from 1024 to 65535");
  return { host, port, origin: `http://${host}:${port}` };
}
