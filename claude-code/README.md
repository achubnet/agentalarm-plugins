# AgentAlarm for Claude Code

Your iPhone gets a quiet notification (in the app's Notifications feed) when a long Claude Code task finishes or Claude
needs your decision, but only while you are away from the computer. Only what you mark urgent rings: a call rings like an
alarm, through Silent and Focus, until you tap Done or Snooze. Hooks fire on Claude Code's own events, so the alert does not depend
on the model remembering to send it.

## Install

1. Install AgentAlarm on your iPhone and connect: Settings > Connected Agents > Connect copies a one-time text.
2. In a terminal: `npx agentalarm login "<the copied text>"` (it then asks when hooks should alert you).
3. In Claude Code:

   ```
   /plugin marketplace add achubnet/agentalarm-plugins
   /plugin install agentalarm@agentalarm
   ```

   Or run `/agentalarm:setup` after installing and Claude walks you through steps 2 and 3.

## What it adds

| Part | What it does |
|---|---|
| Hooks (`hooks/hooks.json`) | `UserPromptSubmit` notes when a turn starts; `Stop` sends "Claude Code: task finished in <project>" if the turn ran at least 3 minutes; `Notification` (permission prompts and questions) sends "Claude Code needs your decision in <project>". All run `npx -y agentalarm hook claude-code` in the background (`async`), so Claude never waits. |
| MCP server (`.mcp.json`) | `https://alarm.achub.net/mcp` with the key from `agentalarm login`, read by `scripts/mcp-headers.mjs` (a `headersHelper`), so the key is never in Claude Code's settings. Claude sends alerts with the `alert` tool: a notification now, a reminder with `at`, and a ring when you ask ("call me when it's done" becomes `ring: true`, sent when it is done). If you already connected AgentAlarm from the app's setup link, Claude Code uses that one connection. |
| Skill `/agentalarm:setup` | Logs in, asks when hooks should alert you, sends a test alert. |

Alerts carry only a short title with the project folder name and the task length; never your prompt, code or the
model's output.

## Settings

`agentalarm setup` (or `agentalarm config set <option> <value>`): only when away (default on, after 2 idle minutes),
minimum task length (3 minutes), cooldown (one alert per session per 5 minutes), ring on decision (off), quiet
hours. `agentalarm pause 1h` / `agentalarm resume`. All options: [../README.md](../README.md#hook-settings).

Speed: the hooks run in the background either way; `npm i -g agentalarm` skips npx's startup.
