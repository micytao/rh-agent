#!/usr/bin/env node

import { parseArgs } from "node:util";
import { c } from "./ansi.js";
import {
  PROVIDERS,
  isConfigured,
  loadConfig,
  loadEnvIntoProcess,
  resolveApiKey,
  hasAnyProviderKey,
  defaultConfig,
  refreshModelsJsonBaseUrl,
  refreshMcpJsonBaseUrls,
} from "./config.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string" },
    "api-key": { type: "string" },
    session: { type: "string" },
    "non-interactive": { type: "boolean", default: false },
    "auth-choice": { type: "string" },
    "accept-risk": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`
  ${c.boldRed("rh-agent")} -- Red Hat Agent

  Usage:
    rh-agent onboard              Interactive setup wizard
    rh-agent status               Show current config and key validity
    rh-agent stop                 Stop the persistent container
    rh-agent restart              Restart container on next run
    rh-agent                      Interactive chat mode

  Options:
    --model <model>               Override model for this run
    --api-key <key>               Override API key for this run
    --session <id>                Resume a previous session
    --non-interactive             Run onboard without prompts
    --auth-choice <choice>        Provider for non-interactive onboard
    -h, --help                    Show this help
`);
  process.exit(0);
}

const command = positionals[0];

async function main(): Promise<void> {
  if (command === "onboard") {
    const { runOnboard } = await import("./onboard.js");
    const ok = await runOnboard({
      nonInteractive: values["non-interactive"],
      authChoice: values["auth-choice"],
    });
    process.exit(ok ? 0 : 1);
  }

  if (command === "status") {
    const { runStatus } = await import("./onboard.js");
    await runStatus();
    return;
  }

  await runAgent();
}

async function runAgent(): Promise<void> {
  if (!isConfigured()) {
    console.log(
      c.yellow("\n  First time? Let's get you set up.\n"),
    );
    const { runOnboard } = await import("./onboard.js");
    const ok = await runOnboard({});
    if (!ok) process.exit(1);
  }

  const cfg = loadConfig() ?? defaultConfig();

  loadEnvIntoProcess();

  // Set API keys for all configured providers so Pi discovers their models
  for (const id of cfg.configured_providers) {
    const key = resolveApiKey(id);
    const prov = PROVIDERS[id];
    if (key && prov?.envVar) process.env[prov.envVar] = key;
  }

  // CLI --api-key override applies to the default provider
  if (values["api-key"]) {
    const prov = PROVIDERS[cfg.provider];
    if (prov?.envVar) process.env[prov.envVar] = values["api-key"];
  }

  // Adapt base URLs for the current runtime (localhost ↔ host.containers.internal)
  refreshModelsJsonBaseUrl();

  const { runInteractive, seedMcpJson } = await import("./runner.js");

  if (cfg.mcp_enabled) {
    seedMcpJson();
    refreshMcpJsonBaseUrls();
  }

  if (!hasAnyProviderKey(cfg.configured_providers)) {
    console.log(
      c.red("\n  No API key found.") +
        ` Run ${c.boldCyan("rh-agent onboard")} or set the appropriate env var.\n`,
    );
    process.exit(1);
  }

  await runInteractive(cfg, values.model, values.session);
}

main().catch((err) => {
  console.error(c.red(`Fatal error: ${err.message ?? err}`));
  process.exit(1);
});
