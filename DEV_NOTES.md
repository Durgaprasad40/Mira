# Mira - Developer Notes

## Starting the App

**Rule: Always use ONE Expo instance on port 8081.**

### Quick Start (Recommended)

```bash
./scripts/start-expo-clean.sh
```

This script:
- Checks if Metro is already running
- Kills any stale processes
- Starts Expo cleanly on port 8081

### Manual Start

```bash
npx expo start --dev-client --localhost --port 8081
```

### If Metro is Already Running

**Don't start a new one!** Instead:

1. **Reload JavaScript**: Press `r` in the Metro terminal
2. **Full restart**: Run `./scripts/start-expo-clean.sh --force`

### Troubleshooting

**"Port 8081 already in use" prompt?**
- Never accept port 8082 or another port
- Kill the existing process: `lsof -ti:8081 | xargs kill -9`
- Then start fresh

**App not connecting?**
- Make sure Metro shows "Waiting for..." message
- For USB: Run `adb reverse tcp:8081 tcp:8081`
- Reload app or press `r` in Metro

---

## Common Commands

| Action | Command |
|--------|---------|
| Start Expo (clean) | `./scripts/start-expo-clean.sh` |
| Force restart | `./scripts/start-expo-clean.sh --force` |
| Reload JS | Press `r` in Metro terminal |
| ADB reverse (USB) | `adb reverse tcp:8081 tcp:8081` |
| Kill Metro | `lsof -ti:8081 \| xargs kill -9` |

---

## Key Principle

> **One Metro = One App**
>
> Never run multiple Expo/Metro instances.
> If something feels stuck, reload (`r`) or force restart.
