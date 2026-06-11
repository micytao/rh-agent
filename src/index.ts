#!/usr/bin/env node

import { parseArgs } from "node:util";
import { c } from "./ansi.js";
import {
  PROVIDERS,
  RH_CLIENT_ID_ENV,
  RH_CLIENT_SECRET_ENV,
  isConfigured,
  loadConfig,
  loadEnvIntoProcess,
  resolveApiKey,
  resolveRhServiceAccount,
  defaultConfig,
} from "./config.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string" },
    "api-key": { type: "string" },
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
    rh-agent "query"              Single-query mode
    rh-agent                      Interactive chat mode

  Options:
    --model <model>               Override model for this run
    --api-key <key>               Override API key for this run
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

  const query = command;
  await runAgent(query);
}

async function runAgent(query?: string): Promise<void> {
  if (!isConfigured()) {
    console.log(
      c.yellow("\n  No configuration found.") +
        ` Run ${c.boldCyan("rh-agent onboard")} to get started.\n`,
    );
    process.exit(1);
  }

  const cfg = loadConfig() ?? defaultConfig();

  loadEnvIntoProcess();

  const apiKey = resolveApiKey(cfg.provider, values["api-key"]);
  if (!apiKey) {
    console.log(
      c.red("\n  No API key found.") +
        ` Run ${c.boldCyan("rh-agent onboard")} or set the appropriate env var.\n`,
    );
    process.exit(1);
  }

  const prov = PROVIDERS[cfg.provider];
  if (prov?.envVar && apiKey) {
    process.env[prov.envVar] = apiKey;
  }

  const [rhId, rhSecret] = resolveRhServiceAccount();
  if (rhId) process.env[RH_CLIENT_ID_ENV] = rhId;
  if (rhSecret) process.env[RH_CLIENT_SECRET_ENV] = rhSecret;

  const { runQuery, runInteractive } = await import("./runner.js");

  if (query) {
    await runQuery(cfg, query, values.model);
  } else {
    await runInteractive(cfg, values.model);
  }
}

main().catch((err) => {
  console.error(c.red(`Fatal error: ${err.message ?? err}`));
  process.exit(1);
});
