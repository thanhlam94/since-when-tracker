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

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy (GitHub Pages)

Hosted via GitHub Pages from the `main` branch root. Push and it goes live.
