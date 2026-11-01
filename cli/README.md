# agentalarm

Alerts on your iPhone from scripts, CI and AI agents, through [AgentAlarm](https://alarm.achub.net). Without a time an
alert is a notification, now (the app's Notifications feed); with `--at` it is a reminder (the Reminders list). Quiet by
default; `--ring` makes it a call that rings your phone like an alarm, through Silent and Focus, until you tap Done or
Snooze. It is never a phone call. Node 18+, no dependencies.

```bash
npx agentalarm login "<the text copied from the app>"   # Settings > Connected Agents > Connect
npx agentalarm "Backup finished"
npx agentalarm "Deploy failed" --ring --color red
npx agentalarm "Stand-up" --at 2026-10-28T09:00
```

| Command | |
|---|---|
| `agentalarm "text" [-r] [--at <time>] [-b <body>] [-c <color>] [-i <icon>] [-l <location>] [-s <sound>] [--json]` | Send a notification now; `--at` makes a reminder, `-r` / `--ring` (or `-u`) rings. |
| `agentalarm login "<text or link>"` | Redeem the app's one-time link; the key goes to `~/.config/agentalarm/config.json` (600). |
| `agentalarm key "<text>" [--name CI] \| gh secret set AGENTALARM_KEY` | A separate key for CI, printed only into a pipe. |
| `agentalarm setup`, `agentalarm config [set <option> <value>]` | When agent hooks alert you. |
| `agentalarm test` (a test call), `status`, `pause [1h]`, `resume`, `logout` | |
| `agentalarm hook <claude-code\|cursor\|codex>` | Agent hook: reads the event on stdin, alerts without spam, always exits 0. |
| `agentalarm mcp` | Local stdio MCP server that forwards to AgentAlarm with the saved key. |

`AGENTALARM_KEY` in the environment wins over the saved key. Exit codes: 0 sent, 1 network or server error, 2 usage,
3 not logged in or key rejected, 4 refused by the server (its message is printed).

Hook settings, the Claude Code and Cursor plugins, Codex hooks and CI examples:
https://github.com/achubnet/agentalarm-plugins#readme

Works with AI agents that support MCP, for example Claude Code, Codex, Cursor, VS Code, Windsurf and Grok-based bots.
AgentAlarm is not affiliated with Anthropic, OpenAI, Anysphere, Microsoft or xAI.
