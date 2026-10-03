import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// --- Configuration (all optional) ---
// The target iOS node is auto-detected from your paired nodes (iPhone preferred).
// Override with REPLY_PUSH_NODE env or ~/.openclaw/reply-push-v2.json { "node": "<id>" }.
const HOME = homedir();
const OPENCLAW = resolveOpenClawBinary();
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || join(HOME, ".openclaw", "state");
const NIGHT = join(HOME, ".openclaw", "NIGHT_MODE");
const CONFIG_FILE = join(HOME, ".openclaw", "reply-push-v2.json");
const NODE_CACHE_FILE = join(STATE_DIR, ".v2_node");
const DEDUPE_MS = 15000;
const NODE_CACHE_MS = 60000;
const DEBUG = process.env.REPLY_PUSH_DEBUG === "1";

// --- Edition ---
// "pro" = all 5 categories. "free" = agentFinished only (the build script flips this).
const EDITION = "free";
const FREE_CATEGORIES = new Set(["agentFinished"]);
const editionAllows = (cat) => EDITION === "pro" || FREE_CATEGORIES.has(cat);
const GUMROAD = "Gumroad - search \"reply-push-v2\"";

// Optional comma-separated allowlist of agent ids. Empty = all agents.
const AGENT_ALLOWLIST = (process.env.REPLY_PUSH_AGENTS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function resolveOpenClawBinary() {
  if (process.env.REPLY_PUSH_OPENCLAW) return process.env.REPLY_PUSH_OPENCLAW;
  for (const p of ["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw", "/usr/bin/openclaw"]) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return "openclaw"; // fall back to PATH
}

function log(...a) { if (DEBUG) { try { console.error("[reply-push-v2]", ...a); } catch {} } }

const MENTION_DEFAULT = /@(main|assistant|agent)\b/i;
function isMention(text) {
  const custom = process.env.REPLY_PUSH_MENTION_PATTERN;
  if (custom) { try { return new RegExp(custom, "i").test(text); } catch { return false; } }
  return MENTION_DEFAULT.test(text);
}

let _nodeCache = { id: "", at: 0 };

function isIPhone(n) {
  if (!n) return false;
  if (n.clientId === "openclaw-ios") return true;
  return /iphone|ipad/i.test(n.deviceFamily || "") || /iphone|ipad/i.test(n.displayName || "") || /iphone|ipad/i.test(n.platform || "");
}

// IMPORTANT: do NOT use a synchronous subprocess here. These hooks run on the
// Gateway event loop; execFileSync would block that loop, and the CLI it spawns
// talks back to the very same Gateway, so the call deadlocks until its timeout and
// silently disables notifications. Async execFile keeps the event loop free.
function detectNodeAsync() {
  return new Promise((resolve) => {
    execFile(
      OPENCLAW,
      ["nodes", "list", "--json"],
      { timeout: 10000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) { log("detectNode failed:", err && err.message); return resolve(""); }
        try {
          const j = JSON.parse(stdout);
          const paired = Array.isArray(j && j.paired) ? j.paired
            : Array.isArray(j && j.nodes) ? j.nodes
            : Array.isArray(j) ? j : [];
          if (!paired.length) return resolve("");
          // Tier 1: official iOS app node (iPhone preferred over Apple Watch).
          const iphones = paired.filter(isIPhone);
          // Tier 2: any node advertising a local-notify surface.
          const notify = paired.filter((n) => Array.isArray(n.commands) && n.commands.includes("system.notify"));
          const pool = iphones.length ? iphones : notify;
          if (!pool.length) return resolve("");
          pool.sort((a, b) => (b.lastSeenAtMs || 0) - (a.lastSeenAtMs || 0));
          const chosen = pool[0].nodeId || pool[0].id || "";
          if (chosen) { try { writeFileSync(NODE_CACHE_FILE, chosen); } catch {} }
          resolve(chosen);
        } catch (e) { log("detectNode parse failed:", e && e.message); resolve(""); }
      },
    );
  });
}

async function nodeId() {
  if (process.env.REPLY_PUSH_NODE) return process.env.REPLY_PUSH_NODE;
  try {
    if (existsSync(CONFIG_FILE)) {
      const j = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
      if (j && typeof j.node === "string" && j.node) return j.node;
    }
  } catch {}
  const now = Date.now();
  if (_nodeCache.id && now - _nodeCache.at < NODE_CACHE_MS) return _nodeCache.id;
  const id = await detectNodeAsync();
  if (id) { _nodeCache = { id, at: now }; return id; }
  // Last-resort: reuse the last node ever seen, so a transient detect failure
  // (Gateway busy, CLI slow) never silently disables notifications.
  try {
    if (existsSync(NODE_CACHE_FILE)) {
      const c = readFileSync(NODE_CACHE_FILE, "utf8").trim();
      if (c) { _nodeCache = { id: c, at: now }; return c; }
    }
  } catch {}
  _nodeCache = { id: "", at: now };
  return "";
}

// Title/body pairs. The first four mirror the official OpenClaw web push exactly.
const TEXTS = {
  agentFinished:       { title: "OpenClaw agent finished",        body: "An agent completed its response." },
  agentQuestion:       { title: "OpenClaw needs an answer",       body: "An agent has a question for you." },
  humanMentioned:      { title: "OpenClaw mention",               body: "Someone mentioned you in a conversation." },
  scheduledTaskFailed: { title: "OpenClaw scheduled task failed", body: "A scheduled task needs attention." },
  // Not an official OpenClaw web-push category: subagent failures have no official
  // push text, so this plugin uses its own honest wording.
  subagentFailed:      { title: "OpenClaw subagent failed",       body: "A subagent stopped unexpectedly." },
};

function dedupe(key) {
  try {
    const f = join(STATE_DIR, ".v2_push_" + key);
    const now = Date.now();
    const last = existsSync(f) ? Number(readFileSync(f, "utf8").trim()) || 0 : 0;
    if (now - last < DEDUPE_MS) return false;
    writeFileSync(f, String(now));
    return true;
  } catch { return true; }
}

async function push(category) {
  try {
    if (existsSync(NIGHT)) { log("NIGHT_MODE -> suppressed", category); return; }
    const t = TEXTS[category];
    if (!t) return;
    const node = await nodeId();
    if (!node) { log("no iOS node found -> no-op", category); return; }
    if (!dedupe(category)) { log("dedupe -> skip", category); return; }
    execFile(OPENCLAW, ["nodes", "push", "--node", node, "--title", t.title, "--body", t.body],
      { timeout: 25000 }, (err) => { if (err) log("push failed:", category, err.message); });
  } catch (e) { log("push error:", e && e.message); } // never throw from a hook
}

export default definePluginEntry({
  id: "reply-push-v2",
  name: "Reply Push v2",
  description: "Native per-category iOS push notifications for OpenClaw.",
  register(api) {
    if (EDITION === "free") { try { console.error("[reply-push-v2] FREE edition: agentFinished only. Pro (all 5 categories): " + GUMROAD); } catch {} }
    // 1) agent finished (any agent; optional REPLY_PUSH_AGENTS allowlist)
    api.on("agent_end", (event, ctx) => {
      try {
        const agentId = ctx && ctx.agentId;
        if (AGENT_ALLOWLIST.length && agentId && !AGENT_ALLOWLIST.includes(agentId)) return;
        push("agentFinished").catch(() => {});
      } catch {}
    }, { eligibleTriggers: ["user"] });

    // Not covered natively (no plugin hook exists): approval requests are already
    // native in OpenClaw; OpenClaw background-task failures have no hook.
  },
});
