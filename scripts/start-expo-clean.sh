#!/bin/bash
#
# start-expo-clean.sh
#
# Starts Expo dev client on port 8081.
# Ensures only ONE Metro instance runs at a time.
#
# Usage:
#   ./scripts/start-expo-clean.sh
#
# What it does:
#   1. Checks if Metro is already running on 8081
#   2. If yes: tells you to reuse it (no new instance)
#   3. If no: kills any stale Expo/Metro processes, then starts fresh
#

set -e

PORT=8081

echo "========================================"
echo "  Mira - Clean Expo Start (port $PORT)"
echo "========================================"
echo ""

# Check if something is already running on port 8081
if lsof -i:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Metro is already running on port $PORT."
    echo ""
    echo "Options:"
    echo "  1. Reuse it: Open your app, it will connect automatically"
    echo "  2. Reload JS: Press 'r' in the Metro terminal"
    echo "  3. Restart fresh: Run this script with --force"
    echo ""

    if [ "$1" = "--force" ]; then
        echo "Force mode: Killing existing Metro..."
        lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
        sleep 1
    else
        echo "To force restart: ./scripts/start-expo-clean.sh --force"
        exit 0
    fi
fi

# Kill any lingering Expo/Metro processes (safety cleanup)
echo "Cleaning up any stale processes..."
pkill -f "expo start" 2>/dev/null || true
pkill -f "@expo/metro-runtime" 2>/dev/null || true
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
sleep 1

# Set up ADB reverse for Android USB debugging
if command -v adb >/dev/null 2>&1; then
    echo "Setting up ADB reverse for USB debugging..."
    adb reverse tcp:$PORT tcp:$PORT 2>/dev/null || true
fi

echo ""
echo "Starting Expo on port $PORT..."
echo "========================================"
echo ""

# Start Expo dev client
exec npx expo start --dev-client --localhost --port $PORT
