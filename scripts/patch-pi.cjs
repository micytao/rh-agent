/**
 * Build-time patch for Pi's source files.
 * Rebrands to rh-agent, suppresses update notices, and removes the
 * built-in /model command so our extension's /model takes over.
 */
const fs = require("fs");
const path = require("path");

const piRoot = path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent");

// 1. Patch package.json: version + branding
const pkgPath = path.join(piRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
pkg.version = "99.0.0";
pkg.piConfig = { ...pkg.piConfig, name: "rh-agent", configDir: ".rh-agent" };
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("  patched package.json (version=99.0.0, name=rh-agent)");

// 2. Remove built-in /model handler from interactive-mode.js
const imPath = path.join(
  piRoot, "dist", "modes", "interactive", "interactive-mode.js",
);
if (fs.existsSync(imPath)) {
  let src = fs.readFileSync(imPath, "utf-8");
  const modelBlock =
    /if\s*\(text\s*===\s*["']\/model["']\s*\|\|\s*text\.startsWith\(["']\/model ["']\)\)\s*\{[^}]*\}/;
  if (modelBlock.test(src)) {
    src = src.replace(modelBlock, "/* rh-agent: /model handled by extension */");
    fs.writeFileSync(imPath, src);
    console.log("  patched interactive-mode.js (removed /model handler)");
  } else {
    console.log("  interactive-mode.js: /model handler not found (already patched?)");
  }
} else {
  console.log("  interactive-mode.js not found, skipping");
}

// 3. Rebrand the project trust prompt
const ptPath = path.join(piRoot, "dist", "core", "project-trust.js");
if (fs.existsSync(ptPath)) {
  let src = fs.readFileSync(ptPath, "utf-8");
  const original = "This allows pi to load .pi settings";
  const replacement = "This allows rh-agent to load .rh-agent settings";
  if (src.includes(original)) {
    src = src.replace(original, replacement);
    fs.writeFileSync(ptPath, src);
    console.log("  patched project-trust.js (rebranded trust prompt)");
  } else {
    console.log("  project-trust.js: trust prompt not found (already patched?)");
  }
} else {
  console.log("  project-trust.js not found, skipping");
}

// 4. Remove "model" from BUILTIN_SLASH_COMMANDS in slash-commands.js
const scPath = path.join(piRoot, "dist", "core", "slash-commands.js");
if (fs.existsSync(scPath)) {
  let src = fs.readFileSync(scPath, "utf-8");
  const modelEntry = /\{\s*name:\s*["']model["'][^}]*\},?\s*/;
  if (modelEntry.test(src)) {
    src = src.replace(modelEntry, "");
    fs.writeFileSync(scPath, src);
    console.log("  patched slash-commands.js (removed model entry)");
  } else {
    console.log("  slash-commands.js: model entry not found (already patched?)");
  }
} else {
  console.log("  slash-commands.js not found, skipping");
}
