# AgentAlarm for Cursor

Your iPhone gets a quiet notification when a long Cursor agent task finishes, but only while you are away from the
computer. The agent can also send notifications, set reminders and, when you ask it to "call me when it's done", ring
your phone like an alarm, through Silent and Focus. AgentAlarm never places phone calls.

## Install

1. Install AgentAlarm on your iPhone. In the app: Settings > Connected Agents > Connect copies a one-time text.
2. In a terminal: `npx agentalarm login "<the copied text>"`. The key is saved in `~/.config/agentalarm/config.json`
   (readable only by you); the plugin never asks for it. It then asks when hooks should alert you.
3. Install "AgentAlarm" from the Cursor Marketplace (Customize > Plugins), user scope. For a team marketplace: Import
   from Repo, `https://github.com/achubnet/agentalarm-plugins`.

Or install the plugin first and ask the agent to "set up AgentAlarm": the `agentalarm-setup` skill walks you through.

## What it adds

| Part | What it does |
|---|---|
| Hooks (`hooks/hooks.json`) | `beforeSubmitPrompt` notes when a task starts; `stop` with status `completed` sends "Cursor: task finished in <project>" if the task ran at least 3 minutes (`error` sends "stopped with an error"; `aborted` means you stopped it, so nothing). Runs `scripts/hook.sh`: a global `agentalarm` if installed, else `npx -y agentalarm`. |
| Rule (`rules/agentalarm.mdc`) | Cursor has no hook for "needs your decision", so the rule asks the agent to send a quiet AgentAlarm notification right before it stops to ask you, and a ring only when you ask to be called. |
| MCP server (`mcp.json`) | `npx -y agentalarm mcp`: a local bridge to `https://alarm.achub.net/mcp` that adds the saved key, so the key is never in Cursor's config. Tools: `alert` (a notification now, or a reminder with `at`), `list_alarms`, `create_alarm`, `update_alarm`, `cancel_alarm`, `rename_agent`. If you already added AgentAlarm to `~/.cursor/mcp.json` from the app's setup link, disable one of the two. |
| Skill `agentalarm-setup` | Logs in, adjusts the settings, sends a test alert. |

Alerts carry only a short title with the project folder name and the task length; never your prompt, code or the
model's output.

## Settings

`npx agentalarm setup`, or one at a time with `npx agentalarm config set <option> <value>`: only when away (default on,
after 2 idle minutes), minimum task length (3 minutes), cooldown (one alert per conversation per 5 minutes).
`npx agentalarm pause 1h` / `resume`. All options: [../README.md](../README.md#hook-settings).

**Speed:** Cursor waits for its hooks. The CLI decides in about 0.1 s and sends from a background process, but `npx`
adds start-up time to every prompt; `npm i -g agentalarm` avoids it. The hooks need `sh` (macOS, Linux, Git Bash on
Windows). Why a hook did or did not alert: `~/.local/state/agentalarm/hook.log`.
