---
name: setup
description: Connect AgentAlarm (iPhone alerts) for this computer and choose when Claude Code's hooks alert the user. Use when the user runs /agentalarm:setup, asks to set up or change AgentAlarm alerts, or a hook log says "not logged in".
---

# Set up AgentAlarm

AgentAlarm puts alerts on the user's iPhone. This plugin's hooks send a **quiet notification** when a long task
finishes or when Claude Code needs the user's decision, and only while the user is away from the computer. Only what
the user marks urgent rings (an urgent alert rings like an alarm, through Silent and Focus). AgentAlarm never places
phone calls.

Work through these steps. Run every command yourself with the Bash tool; never print or ask for the key.

1. **Check the connection:** `npx -y agentalarm status`.
   - Exit code 0 ("Connected"): go to step 3.
   - Otherwise: step 2.
2. **Log in.** Ask the user to open the AgentAlarm app on the iPhone: Settings > Connected Agents > Connect, then
   paste the copied text here. Run `npx -y agentalarm login --no-setup "<the pasted text>"`. It redeems the one-time
   link and saves the key in `~/.config/agentalarm/config.json` (readable only by the user). If it says the link is
   used or expired, ask for a new one.
3. **Choose when hooks alert.** Show the current settings (`npx -y agentalarm config`) and ask the user, in one
   message, with these defaults:
   - Only when away from this computer? (default yes; away = no keyboard or mouse input for 2 minutes)
   - Minimum task length for a "task finished" alert? (default 3 minutes)
   - Ring instead of a quiet notification when Claude needs a decision? (default no; if yes, optional quiet hours
     such as 23:00-08:00 when rings become notifications)
   Apply only the answers that change something, e.g. `npx -y agentalarm config set minTaskMinutes 10`,
   `npx -y agentalarm config set ringOnDecision true`, `npx -y agentalarm config set quietHours 23:00-08:00`.
   (In a terminal, `npx agentalarm setup` asks the same questions interactively.)
4. **Test:** with the user's go-ahead, `npx -y agentalarm test` sends a test call, so the phone rings once.
5. **Tell the user:**
   - The hooks are active now. `npx agentalarm pause 1h` pauses them, `npx agentalarm resume` resumes.
   - The AgentAlarm MCP tools (`alert`: notifications, reminders, "ring me when done") use the same login after `/reload-plugins` or a
     new session. If AgentAlarm was already connected from the app's setup link, Claude Code uses that connection.
   - Why a hook did or did not alert is logged in `~/.local/state/agentalarm/hook.log`.
