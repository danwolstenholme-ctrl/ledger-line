// npm run demo          build if needed, start Ledgerline on http://localhost:3000 and open it
// npm run demo:reset    the same, from fresh demo data
// npm run demo -- --build   rebuild first (after changing code)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = new Set(process.argv.slice(2));
const port = process.env.PORT ?? "3000";
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");

// Something already on the port: Ledgerline from an earlier run, or another app.
const running = await fetch(`http://localhost:${port}/api/health`).then(response => response.json()).catch(() => null);
const taken = running ? true : await fetch(`http://localhost:${port}/`).then(() => true).catch(() => false);
if (taken) {
  if (running?.ok && !args.has("--reset") && !args.has("--build")) {
    console.log(`✓ Ledgerline is already running: http://localhost:${port}`);
    if (process.platform === "darwin" && !args.has("--no-open")) spawn("open", [`http://localhost:${port}`]);
    process.exit(0);
  }
  console.error(`! Port ${port} is in use${running?.ok ? " by Ledgerline from an earlier run" : ""}. Stop it first:  kill $(lsof -ti tcp:${port})\n  or run on another port:  PORT=3001 npm run demo`);
  process.exit(1);
}

if (args.has("--reset")) { fs.rmSync(path.join(root, ".data"), { recursive: true, force: true }); console.log("· demo data cleared: it is rebuilt from the seed on start"); }

const env = fs.existsSync(path.join(root, ".env.local")) ? fs.readFileSync(path.join(root, ".env.local"), "utf8") : "";
if (/^\s*ANTHROPIC_API_KEY\s*=\s*\S+/m.test(env)) console.log("· Claude: ANTHROPIC_API_KEY found in .env.local");
else if (process.env.LEDGERLINE_AI_FIXTURES === "1") console.log("· Claude: no key. REHEARSAL MODE: demo files use recorded readings");
else console.log("! Claude: no ANTHROPIC_API_KEY in .env.local. Capture, Explain the figures and Ask the books will say AI is not set up.\n  Add the key, or rehearse with LEDGERLINE_AI_FIXTURES=1 npm run demo");

if (args.has("--build") || !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.log("· building (about a minute)…");
  const built = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

console.log(`· starting on http://localhost:${port}`);
const server = spawn(process.execPath, [next, "start", "-p", port], { cwd: root, stdio: ["ignore", "inherit", "inherit"], env: process.env });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { server.kill("SIGINT"); process.exit(0); });
server.on("exit", code => process.exit(code ?? 0));

for (let attempt = 0; attempt < 120; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  try {
    const health = await fetch(`http://localhost:${port}/api/health`).then(response => response.json());
    if (health.ok) {
      console.log(`\n✓ Ledgerline is ready: http://localhost:${port}  (${health.organisations} companies, ${health.entries} journal entries)\n  Ctrl+C to stop.`);
      if (process.platform === "darwin" && !args.has("--no-open")) spawn("open", [`http://localhost:${port}`]);
      break;
    }
  } catch { /* still starting */ }
}
