/**
 * Lola extension -- browse & install Red Hat agentic skill collections.
 *
 * Hybrid approach:
 *   - Default: pure TypeScript (fetch marketplace YAML + git clone)
 *   - Optional: delegates to `lola` CLI if detected on PATH
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  cpSync,
  statSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { LOLA_SKILLS_DIR, LOLA_MANIFEST } from "./config.js";

const execFile = promisify(execFileCb);

const RH_MARKETPLACE_URL =
  "https://raw.githubusercontent.com/RHEcosystemAppEng/agentic-collections/main/marketplace/rh-agentic-collection.yml";
const RH_REPO_URL =
  "https://github.com/RHEcosystemAppEng/agentic-collections.git";

// ── Manifest helpers ────────────────────────────────────────────────

interface LolaManifest {
  [module: string]: string[];
}

function readManifest(): LolaManifest {
  if (!existsSync(LOLA_MANIFEST)) return {};
  try {
    return JSON.parse(readFileSync(LOLA_MANIFEST, "utf-8"));
  } catch {
    return {};
  }
}

function writeManifest(manifest: LolaManifest): void {
  mkdirSync(LOLA_SKILLS_DIR, { recursive: true });
  writeFileSync(LOLA_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
}

// ── Lightweight YAML parser (marketplace format only) ───────────────

interface MarketplaceModule {
  name: string;
  description: string;
  version: string;
  path: string;
  tags: string[];
}

function parseMarketplaceYaml(text: string): MarketplaceModule[] {
  const modules: MarketplaceModule[] = [];
  let current: Partial<MarketplaceModule> | null = null;
  let inTags = false;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();

    if (/^\s+-\s+name:\s*"/.test(line) || /^\s+-\s+name:\s*[^"]/.test(line)) {
      if (current?.name) modules.push(current as MarketplaceModule);
      current = { tags: [] };
      current.name = line.replace(/.*name:\s*"?/, "").replace(/"?\s*$/, "");
      inTags = false;
      continue;
    }

    if (!current) continue;

    if (inTags) {
      const tagMatch = line.match(/^\s+-\s*"?([^"]+)"?\s*$/);
      if (tagMatch) {
        current.tags!.push(tagMatch[1]);
        continue;
      }
      inTags = false;
    }

    const kv = line.match(/^\s+(description|version|path|repository):\s*"?(.+?)"?\s*$/);
    if (kv) {
      const [, key, val] = kv;
      if (key === "description") current.description = val;
      else if (key === "version") current.version = val;
      else if (key === "path") current.path = val;
    }
    if (/^\s+tags:\s*$/.test(line)) inTags = true;
  }
  if (current?.name) modules.push(current as MarketplaceModule);
  return modules;
}

// ── Fetch marketplace ───────────────────────────────────────────────

let cachedModules: MarketplaceModule[] | null = null;

async function fetchMarketplace(): Promise<MarketplaceModule[]> {
  if (cachedModules) return cachedModules;
  const resp = await fetch(RH_MARKETPLACE_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Failed to fetch marketplace: HTTP ${resp.status}`);
  const text = await resp.text();
  cachedModules = parseMarketplaceYaml(text);
  return cachedModules;
}

// ── Lola CLI detection ──────────────────────────────────────────────

async function isLolaInstalled(): Promise<boolean> {
  try {
    await execFile("which", ["lola"]);
    return true;
  } catch {
    return false;
  }
}

// ── Install via git (default path) ──────────────────────────────────

async function installViaGit(mod: MarketplaceModule): Promise<string[]> {
  const tmp = join(tmpdir(), `rh-agent-lola-${Date.now()}`);
  try {
    await execFile("git", [
      "clone", "--depth", "1", "--filter=blob:none", "--sparse",
      RH_REPO_URL, tmp,
    ], { timeout: 60_000 });
    await execFile("git", [
      "-C", tmp, "sparse-checkout", "set", mod.path,
    ]);

    const skillsSrc = join(tmp, mod.path, "skills");
    if (!existsSync(skillsSrc)) {
      // Some modules may use .claude/skills layout
      const altSrc = join(tmp, mod.path, ".claude", "skills");
      if (!existsSync(altSrc)) {
        throw new Error(`No skills/ directory found in module ${mod.name}`);
      }
      return copySkills(altSrc, mod.name);
    }
    return copySkills(skillsSrc, mod.name);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function copySkills(skillsSrc: string, moduleName: string): string[] {
  mkdirSync(LOLA_SKILLS_DIR, { recursive: true });
  const installed: string[] = [];

  for (const entry of readdirSync(skillsSrc)) {
    const entryPath = join(skillsSrc, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    if (!existsSync(join(entryPath, "SKILL.md"))) continue;

    const destName = `${moduleName}--${entry}`;
    const destPath = join(LOLA_SKILLS_DIR, destName);
    rmSync(destPath, { recursive: true, force: true });
    cpSync(entryPath, destPath, { recursive: true });
    installed.push(destName);
  }
  return installed;
}

// ── Install via lola CLI (optional path) ────────────────────────────

async function installViaLola(mod: MarketplaceModule): Promise<string[]> {
  const tmp = join(tmpdir(), `rh-agent-lola-cli-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    // Ensure RH marketplace is registered
    try {
      const { stdout } = await execFile("lola", ["market", "ls"], { timeout: 10_000 });
      if (!stdout.includes("rh-agentic-collections")) {
        await execFile("lola", [
          "market", "add", "rh-agentic-collections", RH_MARKETPLACE_URL,
        ], { timeout: 15_000 });
      }
    } catch {
      // If market ls fails, try adding anyway
      await execFile("lola", [
        "market", "add", "rh-agentic-collections", RH_MARKETPLACE_URL,
      ], { timeout: 15_000 }).catch(() => {});
    }

    await execFile("lola", ["install", "-f", mod.name], {
      cwd: tmp,
      timeout: 120_000,
    });

    // Lola clones the collection repo then installs per-module skills
    // Path: .lola/modules/agentic-collections/<module>/skills/
    const lolaSkillsSrc = join(tmp, ".lola", "modules", "agentic-collections", mod.name, "skills");
    if (!existsSync(lolaSkillsSrc)) {
      // Fallback: scan all subdirs of .lola/modules/ for <module>/skills/
      const modulesDir = join(tmp, ".lola", "modules");
      if (existsSync(modulesDir)) {
        for (const collection of readdirSync(modulesDir)) {
          const candidate = join(modulesDir, collection, mod.name, "skills");
          if (existsSync(candidate)) {
            return copySkills(candidate, mod.name);
          }
        }
      }
      throw new Error(`Lola did not install skills for ${mod.name}`);
    }
    return copySkills(lolaSkillsSrc, mod.name);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Public install/uninstall ────────────────────────────────────────

async function installModule(moduleName: string): Promise<{ skills: string[]; viaLola: boolean }> {
  const modules = await fetchMarketplace();
  const mod = modules.find((m) => m.name === moduleName);
  if (!mod) {
    throw new Error(
      `Module "${moduleName}" not found. Run /lola list to see available modules.`,
    );
  }

  const useLola = await isLolaInstalled();
  const skills = useLola
    ? await installViaLola(mod)
    : await installViaGit(mod);

  const manifest = readManifest();
  manifest[moduleName] = skills;
  writeManifest(manifest);

  return { skills, viaLola: useLola };
}

function uninstallModule(moduleName: string): string[] {
  const manifest = readManifest();
  const skills = manifest[moduleName];
  if (!skills || skills.length === 0) {
    throw new Error(`Module "${moduleName}" is not installed.`);
  }

  for (const skillDir of skills) {
    rmSync(join(LOLA_SKILLS_DIR, skillDir), { recursive: true, force: true });
  }

  delete manifest[moduleName];
  writeManifest(manifest);
  return skills;
}

// ── Output formatting ───────────────────────────────────────────────

function formatModuleList(modules: MarketplaceModule[], manifest: LolaManifest): string {
  const lines: string[] = [];
  for (const mod of modules) {
    const installed = mod.name in manifest;
    const status = installed ? " [installed]" : "";
    lines.push(`${mod.name}${status}`);
    lines.push(`  ${mod.description}`);
    if (mod.tags?.length) {
      lines.push(`  Tags: ${mod.tags.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── Extension factory ───────────────────────────────────────────────

const lolaExtension: ExtensionFactory = (pi) => {
  pi.registerCommand("lola", {
    description: "Manage Red Hat agentic skill packs (list, install, uninstall, search, installed)",
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0] || "help";
      const param = parts.slice(1).join(" ");

      try {
        switch (subcommand) {
          case "list": {
            const modules = await fetchMarketplace();
            const manifest = readManifest();
            const body = formatModuleList(modules, manifest);
            ctx.ui.notify(
              `Red Hat Agentic Collections\n\n${body}Install with: /lola install <module>`,
              "info",
            );
            break;
          }

          case "install": {
            if (!param) {
              const modules = await fetchMarketplace();
              const manifest = readManifest();
              const body = formatModuleList(modules, manifest);
              ctx.ui.notify(
                `Usage: /lola install <module>\n\nAvailable modules:\n\n${body}`,
                "info",
              );
              break;
            }
            ctx.ui.notify(`Installing ${param}...`, "info");
            const result = await installModule(param);
            const via = result.viaLola ? " (via lola CLI)" : " (via git)";
            const skillList = result.skills.map((s) => `  • ${s}`).join("\n");
            await ctx.reload();
            ctx.ui.notify(
              `Installed ${result.skills.length} skills${via}:\n${skillList}\n\nSkills reloaded and ready to use.`,
              "info",
            );
            break;
          }

          case "uninstall": {
            if (!param) {
              const manifest = readManifest();
              const entries = Object.entries(manifest).filter(([mod]) => mod !== "rh-basic");
              if (entries.length === 0) {
                ctx.ui.notify("No removable modules installed.\n\nrh-basic is a core module and cannot be uninstalled.", "info");
                break;
              }
              const lines = entries.map(([mod, skills]) => `  ${mod} (${skills.length} skills)`);
              ctx.ui.notify(
                `Usage: /lola uninstall <module>\n\nInstalled modules:\n\n${lines.join("\n")}\n\nNote: rh-basic is a core module and cannot be uninstalled.`,
                "info",
              );
              break;
            }
            if (param === "rh-basic") {
              ctx.ui.notify("rh-basic is a core module and cannot be uninstalled.", "warning");
              break;
            }
            const removed = uninstallModule(param);
            await ctx.reload();
            ctx.ui.notify(
              `Uninstalled ${removed.length} skills from ${param}. Skills reloaded.`,
              "info",
            );
            break;
          }

          case "installed": {
            const manifest = readManifest();
            const entries = Object.entries(manifest);
            if (entries.length === 0) {
              ctx.ui.notify(
                "No modules installed.\nRun /lola list to see available modules.",
                "info",
              );
              break;
            }
            const lines: string[] = [];
            for (const [mod, skills] of entries) {
              lines.push(`${mod} (${skills.length} skills)`);
              for (const s of skills) {
                lines.push(`  • ${s}`);
              }
            }
            ctx.ui.notify(`Installed modules:\n\n${lines.join("\n")}`, "info");
            break;
          }

          case "search": {
            if (!param) {
              ctx.ui.notify("Usage: /lola search <query>", "warning");
              break;
            }
            const modules = await fetchMarketplace();
            const query = param.toLowerCase();
            const matches = modules.filter(
              (m) =>
                m.name.toLowerCase().includes(query) ||
                m.description.toLowerCase().includes(query) ||
                m.tags?.some((t) => t.toLowerCase().includes(query)),
            );
            if (matches.length === 0) {
              ctx.ui.notify(`No modules matching "${param}".`, "warning");
              break;
            }
            const manifest = readManifest();
            const body = formatModuleList(matches, manifest);
            ctx.ui.notify(`Search results for "${param}":\n\n${body}`, "info");
            break;
          }

          default:
            ctx.ui.notify(
              "Lola -- Red Hat Agentic Skill Packs\n\n" +
              "/lola list                 List available modules\n" +
              "/lola install <module>     Install a skill pack\n" +
              "/lola uninstall <module>   Remove a skill pack\n" +
              "/lola installed            Show installed modules\n" +
              "/lola search <query>       Search modules by keyword",
              "info",
            );
        }
      } catch (err: any) {
        ctx.ui.notify(`Error: ${err.message ?? err}`, "error");
      }
    },
    getArgumentCompletions(prefix) {
      const subcmds = ["list", "install", "uninstall", "installed", "search", "help"];
      const parts = prefix.split(/\s+/);
      if (parts.length <= 1) {
        return subcmds
          .filter((s) => s.startsWith(prefix))
          .map((s) => ({ label: s, value: s }));
      }
      if (parts[0] === "install") {
        const known = [
          "rh-basic", "rh-sre", "rh-developer", "ocp-admin",
          "rh-virt", "rh-ai-engineer", "rh-automation",
        ];
        const q = parts[1] || "";
        return known
          .filter((m) => m.startsWith(q))
          .map((m) => ({ label: m, value: `install ${m}` }));
      }
      if (parts[0] === "uninstall") {
        const manifest = readManifest();
        const removable = Object.keys(manifest).filter((m) => m !== "rh-basic");
        const q = parts[1] || "";
        return removable
          .filter((m) => m.startsWith(q))
          .map((m) => ({ label: m, value: `uninstall ${m}` }));
      }
      return null;
    },
  });
};

export default lolaExtension;
