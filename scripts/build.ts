import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(label: string, cmd: string, cwd?: string) {
  console.log(`\n▸ ${label}`);
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, { cwd: cwd ?? root, stdio: "inherit" });
  } catch (e) {
    console.error(`\n✗ Failed: ${label}`);
    process.exit(1);
  }
}

// Clean previous build
if (existsSync(resolve(root, "dist"))) {
  console.log("▸ Cleaning dist/");
  rmSync(resolve(root, "dist"), { recursive: true, force: true });
}

// Step 1: Build UI
const uiDir = resolve(root, "ui");
run("Install UI dependencies", "npm install", uiDir);
run("Build UI", "npm run build", uiDir);

// Step 2: Copy UI assets into dist/ui/
const uiDist = resolve(uiDir, "dist");
const targetUi = resolve(root, "dist", "ui");

if (!existsSync(uiDist)) {
  console.error("✗ ui/dist/ not found after UI build");
  process.exit(1);
}

mkdirSync(targetUi, { recursive: true });
cpSync(uiDist, targetUi, { recursive: true });
console.log("\n▸ Copied ui/dist/ → dist/ui/");

// Step 3: Compile TypeScript
run("Compile TypeScript", "npx tsc");

console.log("\n✓ Build complete");
