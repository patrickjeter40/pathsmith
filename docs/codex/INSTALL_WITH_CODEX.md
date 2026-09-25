# Use Pathsmith with Codex on another device

1. Install Git, Node.js 24 LTS, pnpm 10.33.0, and a current Codex client. Sign in to Codex with your own account. Model availability depends on that account and client.
2. Authenticate Git on this device, then clone the private repository and open its root in Codex:

   ```sh
   git clone https://github.com/patrickjeter40/pathsmith.git
   cd pathsmith
   ```
3. Review `AGENTS.md`, `.codex/config.toml`, and the agent TOMLs before trusting the project. Trust it in the client if you accept those instructions and settings. Start a **new session** after opening/trusting it.
4. Run the non-mutating visibility prompt in [SMOKE_TESTS.md](SMOKE_TESTS.md). It should find five `pathsmith_*` agents and four `pathsmith-*` skills. Configured models and effort are not proof of the effective runtime settings.
5. In a terminal at the repository root, run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   pnpm test
   ```

   Run `pnpm dev` to start the local web shell and API. See the [project README](../../README.md) for URLs, demo commands, and the Windows toolchain wrapper. Browser tests additionally require Google Chrome.

The repository already contains `AGENTS.md`, `.codex/config.toml`, all agent TOMLs, all four skills, and the optional static checker. There is no separate agent-pack ZIP to install or merge. Python 3.11+ is needed only if you choose to run `python scripts/validate-pathsmith-agents.py`; it is not required to build Pathsmith or use Codex.

Keep Codex authentication, personal client configuration, Git credentials, `.env`, local data, reports, and future provider credentials on this device. Do not copy them into the repository. The project configuration intentionally does not contain approval, sandbox, MCP, or credential settings. It does not enable live Jev requests.

If a profile or skill is missing after a new session, check project trust and client support, then use the smoke test to report what is actually visible. Do not infer availability solely from files on disk.
