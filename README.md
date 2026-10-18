# reply-push-v2 — Free edition

Native iOS push notifications for OpenClaw, delivered to the **official App Store app** (no PWA).

![reply-push-v2 - native iOS push notification](https://raw.githubusercontent.com/verdeoc/reply-push-v2/main/assets/demo.gif)

> **Free edition 2.1.1:** sends one notification category, `agentFinished` (an agent finishes a turn). Pro adds four more categories and is distributed separately on Gumroad.

## Free vs Pro

| Category | Free | Pro |
|---|:--:|:--:|
| `agentFinished` | ✅ | ✅ |
| `agentQuestion` | — | ✅ |
| `humanMentioned` | — | ✅ |
| `scheduledTaskFailed` | — | ✅ |
| `subagentFailed` | — | ✅ |

## Requirements

- OpenClaw Gateway with plugin support.
- Official OpenClaw iOS app, paired and approved with the Gateway.
- iOS notifications enabled for the app.
- Reachability to `ios-push-relay.openclaw.ai`.
- iOS only; Android is not supported.

## Scope and troubleshooting

This plugin is an add-on for native APNs delivery through the official OpenClaw iOS app. It does **not** change OpenClaw core Web Push behavior, the iOS app notification settings screen, PWA layout, or relay registration logic. Those remain OpenClaw platform concerns.

If no notification arrives, verify in this order: the iOS app is paired and approved, iOS notifications are enabled, the Gateway can reach `ios-push-relay.openclaw.ai`, and `openclaw plugins list` shows this plugin loaded.

## Compatibility

- Package: `2.1.1`
- OpenClaw build target: `2026.9.6`
- Plugin API: `>=2026.3.24-beta.2`

## Install (recommended: npm)

```bash
openclaw plugins install reply-push-v2
```

Then enable the plugin's conversation hook in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "reply-push-v2": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true }
      }
    }
  }
}
```

Restart the Gateway and verify:

```bash
openclaw plugins list
```

You should see the Free edition with `agentFinished` enabled. Ask your agent to complete a turn and check the iPhone lock screen.

## Manual fallback

If npm installation is unavailable, unzip the package into `~/.openclaw/plugins/reply-push-v2/`, add the same entry under `plugins.entries`, restart the Gateway, and run `openclaw plugins list`.

## Links

- Source and issues: https://github.com/verdeoc/reply-push-v2
- npm package: https://www.npmjs.com/package/reply-push-v2
- ClawHub plugin page: https://clawhub.ai/verdeoc/plugins/reply-push-v2
- Pro edition: https://verdeoc.gumroad.com/l/openclaw-ios-notifications

Canonical ClawHub page verified for publisher `@verdeoc`, plugin `reply-push-v2`, version `2.1.1`.

## Pro

Pro adds `agentQuestion`, `humanMentioned`, `scheduledTaskFailed`, and `subagentFailed`, plus an optional agent allowlist and custom mention regex. It is a separate commercial edition on Gumroad.

## License

MIT — this free edition may be used, modified, and redistributed freely. The Pro edition ships under a separate commercial license.
