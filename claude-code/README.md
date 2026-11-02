# AgentAlarm for Claude Code

Your iPhone gets a quiet notification (in the app's Notifications feed) when a long Claude Code task finishes or Claude
needs your decision, but only while you are away from the computer. Only what you mark urgent rings: a call rings like an
alarm, through Silent and Focus, until you tap Done or Snooze. Hooks fire on Claude Code's own events, so the alert does not depend
on the model remembering to send it.

## Install

1. Install AgentAlarm (1.1 or later) on your iPhone and sign in.
2. In Claude Code:

   ```
   /plugin marketplace add achubnet/agentalarm-plugins
   /plugin install agentalarm@agentalarm
   ```

3. Run `/agentalarm:setup`. Claude walks you through the two connections below.

### Connect the MCP tools (OAuth)

Type `/mcp`, select **agentalarm**, choose **Authenticate**. The sign-in page shows a QR code and a short code: scan
it with the iPhone camera (or tap **MCP** in the AgentAlarm app and enter the code), check that the code matches, tap
**Allow**. No key or password is entered on the computer.

### A key for the hooks

The hooks run outside the MCP connection, so they use an AgentAlarm key that Claude Code keeps in the plugin's
**AgentAlarm key** option (a sensitive option: stored in the system's secure credential store, not in `settings.json`).

1. In the app: Settings > Connected Agents > Connect copies a one-time text.
2. In a terminal, put a new key on the clipboard without showing it (macOS; on Linux pipe to `wl-copy` or
   `xclip -selection clipboard`, on Windows to `clip`):

   ```bash
   npx -y agentalarm@0.1.1 key "<the copied text>" --name "Claude Code hooks" | pbcopy
   ```

3. In Claude Code: `/plugin` > **Installed** > **agentalarm** > **Configure options**, paste it into **AgentAlarm key**.

If you already ran `agentalarm login` in a terminal, you can leave the option empty: the hooks then use that saved
key.

## What it adds

| Part | What it does |
|---|---|
| Hooks (`hooks/hooks.json`) | `UserPromptSubmit` notes when a turn starts; `Stop` sends "Claude Code: task finished in <project>" if the turn ran at least 3 minutes; `Notification` (permission prompts and questions) sends "Claude Code needs your decision in <project>". All run `npx -y agentalarm@0.1.1 hook claude-code` in the background (`async`), so Claude never waits. Claude Code passes the key option to them as `CLAUDE_PLUGIN_OPTION_AGENTALARM_KEY`. |
| MCP server (`.mcp.json`) | `https://alarm.achub.net/mcp`, a remote server that signs in with OAuth. Claude sends alerts with the `alert` tool: a notification now, a reminder with `at`, and a ring when you ask ("call me when it's done" becomes `ring: true`, sent when it is done). |
| Option `agentalarm_key` | The key for the hooks (sensitive). |
| Skill `/agentalarm:setup` | Connects both, asks when hooks should alert you, sends a test notification. |

Alerts carry only a short title with the project folder name and the task length; never your prompt, code or the
model's output. The OAuth connection and the hooks key each show up in the app under Settings > Connected Agents,
where you can disconnect them.

## Settings

`npx agentalarm setup` (or `npx agentalarm config set <option> <value>`): only when away (default on, after 2 idle
minutes), minimum task length (3 minutes), cooldown (one alert per session per 5 minutes), ring on decision (off),
quiet hours. `npx agentalarm pause 1h` / `npx agentalarm resume`. All options:
[../README.md](../README.md#hook-settings).
