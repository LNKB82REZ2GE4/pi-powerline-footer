import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import subCore from "@marckrenn/pi-sub-core";
import { readFileSync, existsSync, watch } from "node:fs";
import { join } from "node:path";
import type { FSWatcher } from "node:fs";

/**
 * Linux-safe token bridge for Anthropic usage.
 *
 * Token priority (highest → lowest):
 *   1. pi's own auth.json (refreshed on `pi /login`) — preferred because it is
 *      pi's dedicated OAuth session and avoids rate-limit conflicts with Claude Code.
 *   2. ~/.claude/.credentials.json (Claude Code's OAuth session) — fallback when
 *      no pi token exists (e.g. non-Claude-Code setups).
 *
 * When using the pi token we set ANTHROPIC_OAUTH_TOKEN on process.env and keep it
 * current via an fs.watch on auth.json, so mid-session token refreshes are picked up
 * immediately without restarting.
 *
 * When falling back to the credentials file we clear ANTHROPIC_OAUTH_TOKEN instead,
 * letting the sub-core read the file fresh on every fetch (always picking up the
 * latest Claude Code token).
 */

let authWatcher: FSWatcher | null = null;

function readPiAuthToken(): string | undefined {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return undefined;
	const authPath = join(home, ".pi", "agent", "auth.json");
	if (!existsSync(authPath)) return undefined;
	try {
		const raw = readFileSync(authPath, "utf-8");
		const parsed = JSON.parse(raw) as { anthropic?: { access?: string } };
		const token = parsed?.anthropic?.access?.trim();
		return token || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Watch auth.json and keep ANTHROPIC_OAUTH_TOKEN in sync with pi's token.
 * Called once after we confirm auth.json has a valid token at startup.
 */
function watchPiAuthToken(): void {
	if (authWatcher) return;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return;
	const authPath = join(home, ".pi", "agent", "auth.json");
	try {
		authWatcher = watch(authPath, () => {
			const newToken = readPiAuthToken();
			if (newToken) {
				process.env.ANTHROPIC_OAUTH_TOKEN = newToken;
			}
		});
		authWatcher.unref?.();
	} catch {
		// Best-effort only — if watch fails we at least started with the right token
	}
}

function syncAnthropicToken(): void {
	// ── Priority 1: pi's own auth token ──────────────────────────────────────
	// This is the token pi uses for all its own Anthropic API calls. It is
	// refreshed via `pi /login` and lives in auth.json. Using it for sub-core
	// usage fetches keeps the two OAuth sessions independent, avoiding rate-limit
	// bleed-over from Claude Code's session hammering the same token.
	const piToken = readPiAuthToken();
	if (piToken) {
		process.env.ANTHROPIC_OAUTH_TOKEN = piToken;
		watchPiAuthToken(); // keep env var in sync as token refreshes
		return;
	}

	// ── Priority 2: Claude Code credentials file ──────────────────────────────
	// Clear the env var so sub-core re-reads the file on every fetch, always
	// picking up refreshed Claude Code tokens. Only used as a fallback for
	// setups where no pi auth.json token exists.
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return;

	const credsPath = join(home, ".claude", ".credentials.json");
	if (!existsSync(credsPath)) return;

	try {
		const raw = readFileSync(credsPath, "utf-8");
		const parsed = JSON.parse(raw) as {
			claudeAiOauth?: { accessToken?: string; scopes?: string[] };
		};
		const token = parsed?.claudeAiOauth?.accessToken?.trim();
		const scopes = parsed?.claudeAiOauth?.scopes ?? [];
		if (!token || !Array.isArray(scopes) || !scopes.includes("user:profile")) return;

		// Valid credentials file — clear env var so sub-core reads the file each fetch.
		delete process.env.ANTHROPIC_OAUTH_TOKEN;
	} catch {
		// Best-effort only
	}
}

export default function createExtension(pi: ExtensionAPI): void {
	syncAnthropicToken();
	subCore(pi);
}
