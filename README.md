# rh-agent

![rh-agent](rh-agent.png)

AI assistant for the Red Hat ecosystem -- available as a **Node.js CLI** (container-based) and a **browser-based WebGPU agent** (`index.html`). Both interfaces embed agentic skills for CVE analysis, lifecycle management, diagnostics, and support case guidance.

> **Disclaimer:** This is a personal experimental project and is **not** a Red Hat product or service. It is not affiliated with, endorsed by, or supported by Red Hat, Inc. The project uses publicly accessible Red Hat agentic skill collections and MCP servers to retrieve Red Hat product and service information. Red Hat and related product names are trademarks of Red Hat, Inc.

---

## WebGPU Browser Agent (`index.html`)

A fully client-side AI agent that runs entirely in the browser via WebGPU. No server, no API keys, complete privacy.

### Features

- **Local LLM inference** via WebGPU using [Hugging Face transformers.js](https://huggingface.co/docs/transformers.js/)
- **Multiple model support** -- switch between models at any time via the dropdown:
  - Gemma 4 E2B 2B (~1.5 GB, recommended for most GPUs)
  - Gemma 4 E4B 8B (~3 GB, requires 8GB+ VRAM)
  - Qwen3 4B (~2.4 GB, requires 8GB+ VRAM)
- **GPU detection** -- auto-detects WebGPU capabilities, f16 support, and estimated VRAM; falls back to WASM (CPU) if no GPU is available
- **Red Hat Security MCP integration** -- connects to the [Red Hat Security MCP server](https://security-mcp.api.redhat.com/mcp) for direct access to CVE and advisory data
- **Agentic tool use** -- built-in tools (fetchURL, querySelector, runJavaScript, createNote, etc.) plus MCP tools, with multi-step reasoning loops
- **Skills system** -- bundled Red Hat skills (CVE Explainer, Diagnostics, Lifecycle, Support Severity) loaded on demand via the `useSkill` tool
- **Chat history** -- persistent chat sessions stored in `localStorage`
- **Streaming output** -- real-time token streaming with thinking indicators

### MCP (Model Context Protocol) Integration

The browser agent includes a built-in MCP client panel in the left sidebar with:

- **Red Hat Security MCP server** pre-configured and auto-connecting on load
- **Tool discovery** -- automatically lists available MCP tools (e.g. `get_cve_by_id`, `get_cves_for_package`)
- **Per-tool enable/disable** -- checkbox toggles for each discovered tool, persisted across reloads
- **OAuth 2.0 (PKCE)** authentication flow with dynamic client registration for servers that require login
- **MCP global toggle** -- enable/disable all MCP servers with a single switch

MCP tools are seamlessly bridged into the agent's tool-calling loop. The model can call MCP tools alongside built-in tools in multi-step reasoning.

### Running the Browser Agent

Serve `index.html` with any static file server:

```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

Or deploy to GitHub Pages -- it's a single self-contained HTML file with no build step.

### Security & Privacy (Browser)

- All inference runs **locally in your browser** via WebGPU -- no data leaves your machine
- Tokens from MCP OAuth are stored in the browser's `localStorage` (per-origin, per-device)
- OAuth uses the **PKCE flow** designed for public clients -- no client secrets
- A CORS proxy (`corsproxy.io`) is used for OAuth discovery/token exchange with Red Hat's auth server (which lacks CORS headers). Self-host a proxy for production use.

---

## CLI Agent (Container)

## Quick Install (Container)

The recommended way to install rh-agent is via the one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/micytao/rh-agent/main/install.sh | sh
```

The installer will:

1. Detect your container runtime (Podman or Docker)
2. Pull the multi-arch container image (amd64/arm64)
3. Create a lightweight wrapper at `~/.local/bin/rh-agent`
4. Offer to launch the setup wizard immediately

On first run, `rh-agent` automatically walks you through onboarding -- choosing a provider, entering an API key, and selecting a default model. The `rh-basic` skill pack is pre-installed.

### Security & Privacy

- The container runs **rootless** with no elevated privileges
- API keys and config are stored locally in `~/.rh-agent/` and are **never** sent anywhere or baked into the image
- Only the current directory is mounted **read-only** as `/workspace`
- Source code: [github.com/micytao/rh-agent](https://github.com/micytao/rh-agent)

## Usage

```bash
rh-agent                      # Interactive TUI (auto-onboards on first run)
rh-agent status               # Show config and validate keys
rh-agent onboard              # Re-run setup wizard
rh-agent --session <id>       # Resume a previous session
rh-agent update               # Pull the latest container image
rh-agent stop                 # Stop the persistent container
rh-agent uninstall            # Remove the wrapper script
```

## Multi-Provider Support

You can configure multiple model providers during onboarding. All API keys are loaded at startup, so Pi discovers models from every configured provider.

- The first provider you configure becomes the **default** (used on launch).
- Switch between providers and models at any time with the `/model` command in the TUI.
- `rh-agent status` validates keys for all configured providers.

## Supported Providers

| Provider | Env Var | Auth Choice (CI) |
|----------|---------|-------------------|
| OpenAI | `OPENAI_API_KEY` | `openai-api-key` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic-api-key` |
| Google Gemini | `GEMINI_API_KEY` | `google-api-key` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `azure-api-key` |
| Custom endpoint(s) | `RH_AGENT_API_KEY[_N]` | `custom-api-key` |

## Custom Endpoint Support

Select **Custom (OpenAI-compatible endpoint)** during onboarding to connect to any OpenAI-compatible inference server -- local or remote. The wizard offers presets for common local servers:

| Server | Default URL |
|--------|-------------|
| Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |
| LM Studio | `http://localhost:1234/v1` |

You can also enter a custom URL for remote services like Red Hat MaaS, Together AI, or any OpenAI-compatible endpoint.

### Multiple custom endpoints

You can configure **multiple custom endpoints** during onboarding. Each gets:
- A user-chosen name (used as the provider identifier, e.g. "maas", "ollama-local")
- Its own API key (stored as indexed env vars: `RH_AGENT_API_KEY_0`, `RH_AGENT_API_KEY_1`, etc.)
- Its own model list (fetched from the server during setup)

Switch between all configured models at runtime using `/model` in the TUI.

### How it works

- Available models are fetched automatically from the server (with the API key, if provided)
- A capable model (≥12B parameters) is recommended for reliable tool-calling and skill usage
- When running inside a container, rh-agent rewrites `localhost` to `host.containers.internal` automatically
- If the server's TLS certificate is not trusted, rh-agent offers to skip verification and persists the choice

## MCP Support (Optional)

rh-agent integrates with [Model Context Protocol](https://modelcontextprotocol.io/) servers via `pi-mcp-adapter`. The Red Hat Security MCP provides direct access to CVE and advisory data. MCP is **disabled by default** for fast startup -- security skills still work via web search without it.

### Enabling MCP

**During onboarding:** The setup wizard asks whether to enable MCP. Choose yes to activate it.

**During a session:** Run `/mcp enable` in the TUI, then exit and re-run rh-agent.

### After enabling

```
/mcp-auth          # Authenticate via browser-based OAuth (first time only)
/mcp               # Check MCP server status, reconnect
/mcp-off           # Disable MCP (takes effect on next run)
```

MCP credentials are stored locally in `~/.rh-agent/agent/` and persist across container restarts. Once authenticated, the server auto-connects on every startup.

### OAuth callback

The `/mcp-auth` flow opens a browser for Red Hat SSO login. After authentication, the browser redirects to `http://localhost:19876/callback` where the container receives the token. The container publishes port **19876** specifically for this purpose -- ensure it is not in use on your host when running `/mcp-auth`.

**Remote/VPS usage:** If rh-agent is running on a remote server, the redirect to `localhost:19876` won't reach it because your browser is on your local machine. Set up an SSH tunnel first:

```
ssh -L 19876:localhost:19876 user@your-server
```

Then run `/mcp-auth` in the tunneled session, copy the auth URL to your local browser, and log in. The redirect will tunnel back through SSH to the server. This is a one-time setup -- the token persists after authentication.

## Skills (Lola)

Skills are managed by the **Lola** extension inside the TUI. The container comes with the `rh-basic` pack pre-installed.

```
/lola list                    # List available skill packs
/lola install rh-basic        # Install core Red Hat skills
/lola install <module>        # Install a specific pack
/lola uninstall <module>      # Remove a skill pack
```

Available skills include:

- **CVE Explainer** -- Look up CVEs, advisories, and remediation steps
- **Diagnostics Guide** -- Gather the right diagnostic data (`sos report`, `must-gather`, etc.)
- **Product Lifecycle** -- Check product lifecycle phases and EOL dates
- **Support Severity** -- Assess appropriate support case severity level
- **Security MCP Setup** -- Guide for connecting to the Red Hat Security MCP
- **Get Started** -- Onboarding and quick-start guide

Skills are sourced from [RHEcosystemAppEng/agentic-collections](https://github.com/RHEcosystemAppEng/agentic-collections).

## Container Details

### Persistent container (fast startup)

The wrapper keeps the container running between sessions for near-instant subsequent launches. On first run, the container starts in the background; subsequent `rh-agent` invocations exec into the already-running container (~0.2s vs ~3-8s for a cold start).

- `rh-agent stop` — Shut down the persistent container
- `rh-agent update` — Pull the latest image and stop the running container so the next run picks up the new version

Short-lived commands (`status`, `onboard`) use the running container if available, or fall back to a one-shot `run --rm` to avoid leaving a persistent container behind unnecessarily.

### Build from source

```bash
# Single architecture
podman build -t rh-agent -f Containerfile .

# Multi-arch (amd64 + arm64) with manifest
./build.sh --push
./build.sh --tag v1.0.0 --push
```

### Manual run

```bash
podman run -it --rm \
  --userns=keep-id \
  --security-opt label=disable \
  -v ~/.rh-agent:/home/node/.rh-agent \
  -v $(pwd):/workspace:ro \
  -w /workspace \
  quay.io/rh_ee_micyang/rh-agent:latest
```

### Container notes

- `~/.rh-agent` volume persists configuration, API keys, MCP tokens, and skills across runs
- `--userns=keep-id` maps your host UID into the container for correct file permissions
- `--security-opt label=disable` is required on SELinux-enabled systems (RHEL, Fedora)
- `fd` and `ripgrep` are pre-installed in the image for instant startup
- The `rh-basic` skill pack is seeded on first run from the image
- The `/workspace` bind mount is set at container creation time; the container auto-detects directory changes and recreates itself when needed

### Non-interactive setup (CI/scripts)

```bash
export OPENAI_API_KEY=sk-...
rh-agent onboard --non-interactive --auth-choice openai-api-key
```

## Architecture

```
~/.rh-agent/
├── config.json          # Provider, model, configured_providers list
├── .env                 # API keys (RH_AGENT_API_KEY_0, RH_AGENT_API_KEY_1, etc.)
└── agent/
    ├── settings.json    # Pi runtime settings
    ├── models.json      # Custom endpoint definitions (named providers + models)
    ├── mcp.json         # MCP server configuration
    └── skills/          # Lola-managed skill packs
        ├── .lola-manifest.json
        ├── rh-basic--red-hat-cve-explainer/
        ├── rh-basic--red-hat-diagnostics/
        └── ...
```

## Development

### From source (npm)

```bash
npm install
npm run build       # compile TypeScript to dist/
npm run dev         # run via tsx (no build step)
npm install -g .    # install globally for testing
```

> **Note:** Do not use `install.sh` on the same machine where you develop with `npm install -g .` -- the container wrapper at `~/.local/bin/rh-agent` would shadow the npm-installed binary.

