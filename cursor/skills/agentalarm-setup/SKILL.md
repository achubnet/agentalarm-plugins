---
name: agentalarm-setup
description: Connect AgentAlarm (iPhone alerts) on this computer and choose when the Cursor hooks alert the user. Use when the user asks to set up or change AgentAlarm alerts, or AgentAlarm tools say "not connected".
---

# Set up AgentAlarm

AgentAlarm puts alerts on the user's iPhone. This plugin's hook sends a **quiet notification** when a long task
finishes, only while the user is away from the computer. Only what the user marks urgent rings (an urgent alert rings
like an alarm, through Silent and Focus). AgentAlarm never places phone calls.

Run the commands yourself in the terminal; never print or ask for the key.

1. `npx -y agentalarm status`. Exit code 0 means connected: go to step 3.
2. Ask the user to open the AgentAlarm app: Settings > Connected Agents > Connect, and paste the copied text. Run
   `npx -y agentalarm login --no-setup "<the pasted text>"`. If the link is used or expired, ask for a new one.
3. Show `npx -y agentalarm config` and ask, with these defaults: only when away from this computer (yes, after 2 idle
   minutes)? minimum task length for a "task finished" alert (3 minutes)? Apply changes with
   `npx -y agentalarm config set onlyWhenAway false` or `npx -y agentalarm config set minTaskMinutes 10`.
   (In a terminal, `npx agentalarm setup` asks interactively.)
4. With the user's go-ahead, `npx -y agentalarm test` sends a test call that rings once.
5. Tell the user: the MCP tools (`agentalarm` in Cursor's MCP settings) use the same login, possibly after reloading
   MCP servers; `npx agentalarm pause 1h` pauses the hook; why it did or did not alert is in
   `~/.local/state/agentalarm/hook.log`.
