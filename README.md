# Since When — Activity Tracker

A simple, beautiful web app that answers one question: **how long has it been since you last did something?**

Each activity gets a live-ticking counter (days / hours / minutes / seconds) showing time since your last log. Tap **Log now** to reset the clock.

## Features

- ⏱️ Live counters on every activity card (tick every second)
- ✅ One-tap "Log now" to record an occurrence
- 🎯 Optional target frequency per activity with overdue highlighting
- 📊 Per-activity stats: total logs, average gap, longest gap
- 🗂️ Categories, search, and sorting (longest-since first, most recent, A–Z, most logged)
- 📝 Full history per activity with edit / delete of individual log entries
- 🌙 Dark / light mode
- 💾 Data stored in your browser (localStorage) — export / import JSON backups
- 📱 Mobile-friendly, no build step, no dependencies

## Data & sync

- **Signed out:** everything stays in your browser (localStorage), as before.
- **Signed in** (👤 button, email magic link): activities and the full log
  history sync to a free Supabase Postgres database (`activities` and
  `activity_logs` tables, row-level security so each user only sees their
  own rows). Data follows you across devices.
- The Supabase `anon` key in `app.js` is the publishable public key — safe
  to ship in client-side code; RLS policies enforce per-user privacy.
  Never add the `service_role` key to this repo.

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy (GitHub Pages)

Hosted via GitHub Pages from the `main` branch root. Push and it goes live.
