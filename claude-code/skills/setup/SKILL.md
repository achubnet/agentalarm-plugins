---
name: setup
description: Connect AgentAlarm (iPhone alerts) to Claude Code and choose when the plugin's hooks alert the user. Use when the user runs /agentalarm:setup, asks to set up or change AgentAlarm alerts, the AgentAlarm MCP tools need authentication, or a hook log says "not logged in".
---

# Set up AgentAlarm

AgentAlarm puts alerts on the user's iPhone. This plugin's hooks send a **quiet notification** when a long task
finishes or when Claude Code needs the user's decision, and only while the user is away from the computer. Only what
the user marks urgent rings (an urgent alert rings like an alarm, through Silent and Focus). AgentAlarm never places
phone calls.

There are two connections, set up separately:

- **The MCP tools** (`alert`: notifications, reminders, "ring me when done") sign in with OAuth. No key is involved.
- **The hooks** need an AgentAlarm key, stored by Claude Code in the plugin's `agentalarm_key` option (kept in the
  system's secure credential store).

Work through these steps. Never print, ask for or read the key yourself.

1. **MCP tools.** If the AgentAlarm tools are not available, ask the user to type `/mcp`, select **agentalarm**, choose
   **Authenticate**, and approve on the iPhone: the sign-in page shows a QR code and a short code; scan the QR code
   with the camera (or tap **MCP** in the AgentAlarm app and enter the code), check that the code matches, tap
   **Allow**. This needs AgentAlarm 1.1 or later.
2. **A key for the hooks.** Ask the user to open the AgentAlarm app on the iPhone: Settings > Connected Agents >
   Connect, then paste the copied text here. Run, with the Bash tool, the command for this computer; it redeems the
   one-time link and puts the new key on the clipboard without printing it:
   - macOS: `npx -y agentalarm@0.1.1 key "<the pasted text>" --name "Claude Code hooks" | pbcopy`
   - Linux: the same with `| wl-copy` (Wayland) or `| xclip -selection clipboard`
   - Windows: the same with `| clip`
   If it says the link is used or expired, ask for a new one. Then ask the user to type `/plugin`, open the
   **Installed** tab, select **agentalarm**, choose **Configure options**, paste the key into **AgentAlarm key**, and
   save. The hooks use it from the next event on.
3. **Choose when hooks alert.** Show the current settings (`npx -y agentalarm@0.1.1 config`) and ask the user, in one
   message, with these defaults:
   - Only when away from this computer? (default yes; away = no keyboard or mouse input for 2 minutes)
   - Minimum task length for a "task finished" alert? (default 3 minutes)
   - Ring instead of a quiet notification when Claude needs a decision? (default no; if yes, optional quiet hours
     such as 23:00-08:00 when rings become notifications)
   Apply only the answers that change something, e.g. `npx -y agentalarm@0.1.1 config set minTaskMinutes 10`,
   `npx -y agentalarm@0.1.1 config set ringOnDecision true`, `npx -y agentalarm@0.1.1 config set quietHours 23:00-08:00`.
   These settings hold no key.
4. **Test:** with the user's go-ahead, send a quiet test notification with the AgentAlarm MCP `alert` tool (no
   `ring`), titled "AgentAlarm test".
5. **Tell the user:**
   - The hooks are active once the key is saved. `npx agentalarm pause 1h` pauses them, `npx agentalarm resume`
     resumes.
   - Why a hook did or did not alert is logged in `~/.local/state/agentalarm/hook.log`; "not logged in" there means
     the key option is empty.
   - The key and the MCP connection are listed in the app under Settings > Connected Agents, where either can be
     disconnected.
