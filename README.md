# AgentAlarm integrations

[AgentAlarm](https://alarm.achub.net) lets AI agents, scripts and CI reach your iPhone. An alert without a time is a
**notification**, now, in the app's Notifications feed; with a time (`--at`) it is a **reminder** in the Reminders list.
Quiet by default. A **call** (`--ring`, or `--urgent`) **rings your phone** like an alarm (Apple's AlarmKit), through
Silent and Focus, until you tap Done or Snooze. Nothing dials your number: it is never a phone call.

Agents usually connect over MCP: they decide when to alert you. The pieces here make alerts **deterministic**: agent
hooks fire on the agent's own events (task finished, needs your decision), whether or not the model remembers to send
an alert, and a CLI sends alerts from any script.

| Folder | What it is |
|---|---|
| [`cli/`](cli/) | `agentalarm` on npm: `npx agentalarm "text"`, login, hooks, a local MCP bridge. Node 18+, no dependencies. |
| [`claude-code/`](claude-code/) | Claude Code plugin: hooks, the MCP server, `/agentalarm:setup`. |
| [`cursor/`](cursor/) | Cursor plugin: hooks, a rule, the MCP server, a setup skill. |

**The default is quiet:** hooks send notifications (no time) for "task finished" and "needs your decision", only while
you are away from the computer. Ring only for what you mark urgent: a failed deploy (`agentalarm --ring` in CI), an
agent you asked to "call me when it's done", the alerts you chose to ring in the app.

Works with AI agents that support MCP, for example Claude Code, Codex, Cursor, VS Code, Windsurf and Grok-based bots.
AgentAlarm is not affiliated with Anthropic, OpenAI, Anysphere, Microsoft or xAI.

## Quickstart

1. **Install the app** on your iPhone (iOS 26 or later) and sign in.
2. **Copy a setup text:** Settings > Connected Agents > Connect. It holds a one-time link that works for 30 minutes.
3. **Log in on your computer:**

   ```bash
   npx agentalarm login "<the copied text>"
   ```

   It redeems the link (the key is created only now, named "agentalarm CLI on <computer>"), saves the key in
   `~/.config/agentalarm/config.json` (mode 600), then asks when hooks should alert you. `npx agentalarm test` rings
   your phone once.
4. **Install the plugin** for your agent:
   - Claude Code: `/plugin marketplace add achubnet/agentalarm-plugins`, then `/plugin install agentalarm@agentalarm`
     and `/agentalarm:setup`. Its MCP server signs in with OAuth (`/mcp`, Authenticate, approve on the iPhone); its
     hooks take a key in the plugin's **AgentAlarm key** option, or use the one from `agentalarm login`. See
     [claude-code/README.md](claude-code/README.md).
   - Cursor: install "AgentAlarm" from the Cursor Marketplace (or, for a team marketplace, Import from Repo with
     `https://github.com/achubnet/agentalarm-plugins`).
   - Codex: add the hooks below to `~/.codex/hooks.json`.

## The CLI

```bash
agentalarm "Backup finished"                          # a notification, now (the app's feed)
agentalarm "Deploy failed" --ring --color red         # a call: rings now
agentalarm "Stand-up" --at 2026-10-28T09:00           # a reminder; your timezone (set in the app), or add an offset
agentalarm "Disk 95% full" -r -b "db-1: /var 95%" --sound urgentpulse -i exclamationmark.triangle
agentalarm "Dentist" --at 2026-10-28T15:00 -l "12 Baker St, London" -i heart
agentalarm test | status | setup | pause 1h | resume | logout
agentalarm config set minTaskMinutes 10               # one hook option; `agentalarm config` shows them all
```

- No `--at`: a notification now. `--at`: a reminder at that time. `--ring` / `-r` (or `--urgent` / `-u`) rings.
- `--color`: blue, red, orange, green, purple. `--icon` / `-i`: bell, checkmark.circle, exclamationmark.triangle,
  calendar, sportscourt, gift, cart, airplane, heart, briefcase. `--location` / `-l`: an address or place (the app
  opens it in Maps). `--sound` (with `--ring`): default, calmpiano, softbells, sunrise, chime, brightmarimba, upbeatpop,
  urgentpulse, loudalarm, stadium.
- Exit codes: 0 sent, 1 network or server error, 2 usage, 3 not logged in or key rejected, 4 refused by the server
  (limits per day: 500 notifications, 30 calls (5 an hour), 20 notifications a minute from one key; reminders: 100 on
  one day, 500 unfinished, 200 created a day; the server's message is printed). The same title from the same key within
  2 minutes updates the notification it sent instead of adding one.
- `AGENTALARM_KEY` in the environment wins over the saved key (CI). `agentalarm logout` revokes the key on the server
  and removes it locally. In the Claude Code plugin's hooks, its **AgentAlarm key** option
  (`CLAUDE_PLUGIN_OPTION_AGENTALARM_KEY`) comes after `AGENTALARM_KEY` and before the saved key.
- `agentalarm mcp` is a local stdio MCP server that forwards to `https://alarm.achub.net/mcp` with the saved key, for
  clients that should not hold the key in their own config (the Cursor plugin uses it).

## Hook settings

Hooks run `agentalarm hook <claude-code|cursor|codex>`, which reads the event JSON on stdin, decides in about 0.1 s
and exits 0: the alert is sent by a detached process, so the agent never waits for the network, and a hook never fails
the agent (npx adds its own start-up time; a global install avoids it). Alerts carry only a short title with the project folder name ("Claude Code: task finished in shop",
"Claude Code needs your decision in shop") and the task length; never prompts, code or the model's output.

| Option (`agentalarm config set …`) | Default | Environment | Meaning |
|---|---|---|---|
| `onlyWhenAway` | `true` | `AGENTALARM_ONLY_WHEN_AWAY` | Alert only when the computer has had no keyboard or mouse input for `awayAfterMinutes`. macOS: `ioreg`; Linux: `xprintidle` if installed; Windows or unknown: counts as away. |
| `awayAfterMinutes` | `2` | `AGENTALARM_AWAY_AFTER_MINUTES` | Idle minutes that count as away. |
| `minTaskMinutes` | `3` | `AGENTALARM_MIN_TASK_MINUTES` | "Task finished" needs the turn (from your message to the agent's stop) to have run this long. "Needs your decision" skips this check. |
| `cooldownMinutes` | `5` | `AGENTALARM_COOLDOWN_MINUTES` | At most one alert per agent session in this window; repeats are dropped. |
| `ringOnDecision` | `false` | `AGENTALARM_RING_ON_DECISION` | "Needs your decision" rings instead of a notification. "Task finished" never rings. |
| `quietHours` | off | `AGENTALARM_QUIET_HOURS` | e.g. `23:00-08:00` (local time): rings from hooks become notifications. |

`agentalarm setup` asks: only when away, the idle minutes, the minimum task length, and last, ring on decision (default
No; quiet hours only if yes). `agentalarm pause 1h` (or `30m`, `2d`) pauses hook alerts; `agentalarm resume` ends it.
Direct `agentalarm "text"` calls always send: the away check, cooldown and pause apply to hooks only.

Why a hook did or did not alert: `~/.local/state/agentalarm/hook.log` (`$XDG_STATE_HOME` is honoured).

Which events alert:

| Agent | Turn start | Task finished | Needs your decision |
|---|---|---|---|
| Claude Code | `UserPromptSubmit` | `Stop` | `Notification` with `permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog`, `agent_needs_input` |
| Cursor | `beforeSubmitPrompt` | `stop` with status `completed` (or `error`: "stopped with an error"; `aborted` is you) | no hook event: the plugin's rule asks the agent to send it over MCP |
| Codex | `UserPromptSubmit` | `Stop` | `PermissionRequest` |

Subagent stops and Claude Code's `idle_prompt` (it follows a `Stop`) never alert.

### Codex

Codex reads hooks from `~/.codex/hooks.json` and asks you to trust them once (`/hooks`):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "agentalarm hook codex", "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "agentalarm hook codex", "timeout": 10 }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "agentalarm hook codex", "timeout": 10 }] }]
  }
}
```

Codex waits for its hooks, so install the CLI globally (`npm i -g agentalarm`) instead of starting npx every time.
The hook prints nothing, so Codex's own approval flow is unchanged.

## Scripts, CI, cron, deploys

**A key for CI.** Create a separate key so you can revoke it alone: in the app, Connect, copy the text, then

```bash
npx agentalarm key "<the copied text>" --name "GitHub Actions" | gh secret set AGENTALARM_KEY
```

`agentalarm key` prints the key only into a pipe, never to a terminal, and saves nothing.

**GitHub Actions: ring when a job fails**

```yaml
      - name: Ring my phone if this job failed
        if: failure()
        env:
          AGENTALARM_KEY: ${{ secrets.AGENTALARM_KEY }}
        run: >
          npx -y agentalarm "Failed: ${{ github.repository }} / ${{ github.workflow }}"
          --urgent --color red --body "Run #${{ github.run_number }} on ${{ github.ref_name }}"
```

**cron: notify only when something needs you**

```cron
# Every morning at 8: a quiet notification if a certificate expires within 14 days.
0 8 * * * /usr/local/bin/check-certs --days 14 || /usr/local/bin/agentalarm "Certificates expire soon" -b "$(hostname)"
```

cron has a minimal environment: use absolute paths, and either log in as that user or set `AGENTALARM_KEY` in the
crontab.

**Deploy scripts: ring on failure, notify on success**

```bash
#!/usr/bin/env bash
set -euo pipefail
trap 'agentalarm "Deploy failed: $APP" --urgent --color red --body "Line $LINENO, exit $?" || true' ERR
./deploy.sh
agentalarm "Deployed $APP $(git rev-parse --short HEAD)" --color green
```

**Long local jobs:** `make release; agentalarm "Release build done" -u` rings when it finishes, wherever you are.

## Security

- The key is created only when the one-time link is redeemed; it is saved in `~/.config/agentalarm/config.json`
  (`$XDG_CONFIG_HOME` is honoured), directory 700, file 600. It never goes into command-line arguments, URLs or logs,
  and `agentalarm status` never prints it. The macOS Keychain is not used: the Cursor plugin's `agentalarm mcp` reads
  the same file. The Claude Code plugin does not read it for MCP (OAuth); its hooks prefer the key in the plugin's
  sensitive option, which Claude Code keeps in the system's credential store.
- Network calls use HTTPS only (plain HTTP only to localhost, for development), with a 10 s timeout and no redirects.
- `agentalarm login` and `agentalarm key` redeem links only on `https://alarm.achub.net` (or localhost, for
  development) and print the server before redeeming; links with a user name or password are refused. A self-hosted
  server needs `--server <origin>`.
- A key goes only to its own server: `AGENTALARM_KEY` to `AGENTALARM_URL` (or `https://alarm.achub.net`), the saved
  key to the server it came from. The Claude Code plugin's key option counts as an environment key.
- Revoke any key in the app (Settings > Connected Agents) or with `agentalarm logout`.

## Development

```bash
cd cli && npm test               # unit and end-to-end tests against a local fake server
claude plugin validate .        # this folder is the marketplace root (.claude-plugin/marketplace.json)
```

The marketplace files `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json` at the root point at
`claude-code/` and `cursor/`.
