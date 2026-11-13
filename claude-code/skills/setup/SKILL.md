---
name: setup
description: Connect AgentAlarm (reminders, lists and notifications on the user's iPhone) to Claude Code. Use when the user runs /agentalarm:setup, asks to set up AgentAlarm, or the AgentAlarm MCP tools need authentication.
---

# Set up AgentAlarm

AgentAlarm puts things on the user's iPhone through its MCP tools: a notification now, a reminder at a time, items on
a list, a message to a group, a long task's progress. Quiet by default; an alert rings like an alarm (through Silent
and Focus) only when the user asks for it. AgentAlarm never places phone calls.

1. **Connect.** If the AgentAlarm tools are not available, ask the user to type `/mcp`, select **agentalarm**, choose
   **Authenticate**, and approve on the iPhone: the sign-in page shows a QR code and a short code; scan the QR code
   with the camera (or tap **MCP** in the AgentAlarm app and enter the code), check that the code matches, tap
   **Allow**. No key or password is entered on the computer.
2. **Test:** with the user's go-ahead, send a quiet test notification with the `alert` tool (no `ring`), titled
   "AgentAlarm test".
3. **Tell the user** what to ask for, for example: "remind me tomorrow at 9 to send the invoice", "add milk to our
   shopping list", "let me know when you are done". The connection is listed in the app under Settings > Connected
   Agents, where it can be disconnected.
4. **Automatic alerts (optional).** If the user wants a notification every time a long task finishes or Claude Code
   needs a decision, without asking for it, tell them about the separate AgentAlarm hooks plugin and the commands to
   add it themselves: `/plugin marketplace add achubnet/agentalarm-hooks`, then
   `/plugin install agentalarm-hooks@agentalarm-hooks`, then `/agentalarm-hooks:setup`. Do not install it or change any
   settings for them.
