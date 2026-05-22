#!/usr/bin/env bash
set -euo pipefail

# Stop Expo/Metro
pkill -f "expo start" || true
pkill -f "metro" || true
pkill -f "react-native" || true
