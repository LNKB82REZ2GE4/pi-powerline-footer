import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import subCore from "@marckrenn/pi-sub-core";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Linux-safe token bridge for Anthropic usage.
 *
 * Ensure sub-core uses the same Claude OAuth token as `claude /status`
 * by populating ANTHROPIC_OAUTH_TOKEN from ~/.claude/.credentials.json
 * when not explicitly set.
 */
function ensureAnthropicTokenFromClaudeCreds(): void {
	if (process.env.ANTHROPIC_OAUTH_TOKEN?.trim()) return;

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
		if (!token) return;
		if (!Array.isArray(scopes) || !scopes.includes("user:profile")) return;

		process.env.ANTHROPIC_OAUTH_TOKEN = token;
	} catch {
		// Best-effort only
	}
}

export default function createExtension(pi: ExtensionAPI): void {
	ensureAnthropicTokenFromClaudeCreds();
	subCore(pi);
}
