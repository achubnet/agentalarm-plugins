# AgentAlarm for Claude Code

The AgentAlarm MCP tools: Claude puts reminders, lists, notifications and task progress on your iPhone when you ask
("remind me tomorrow at 9 to send the invoice", "add milk to our shopping list", "let me know when you are done").
Quiet by default; an alert rings like an alarm, through Silent and Focus, only when you ask for it.

For a notification every time a long task finishes or Claude needs your decision, without asking, add the separate
hooks plugin: [achubnet/agentalarm-hooks](https://github.com/achubnet/agentalarm-hooks).

## Install

1. Install AgentAlarm on your iPhone (iOS 26 or later) and sign in.
2. In Claude Code:

   ```
   /plugin marketplace add achubnet/agentalarm-plugins
   /plugin install agentalarm@agentalarm
   ```

3. Run `/agentalarm:setup`, or connect directly: type `/mcp`, select **agentalarm**, choose **Authenticate**. The
   sign-in page shows a QR code and a short code: scan it with the iPhone camera (or tap **MCP** in the AgentAlarm app
   and enter the code), check that the code matches, tap **Allow**. No key or password is entered on the computer.

## What it adds

| Part | What it does |
|---|---|
| MCP server (`.mcp.json`) | `https://alarm.achub.net/mcp`, a remote server that signs in with OAuth. Claude sends alerts with the `alert` tool: a notification now, a reminder with `at`, and a ring when you ask ("ring me when it's done" becomes `ring: true`, sent when it is done). Lists, groups and task progress appear once the app supports them. |
| Skill `/agentalarm:setup` | Connects the MCP tools, sends a test notification, points to the hooks plugin if you want automatic alerts. |

The connection shows up in the app under Settings > Connected Agents, where you can disconnect it.
