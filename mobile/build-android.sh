#!/usr/bin/env bash
# Rebuilds the web bundle and syncs it into the Android project before every
# Gradle build, so we never package a stale/cached bundle (see incident where
# a two-week-old dist/ export shipped in a release build after mobile/dist
# was committed to git and got reverted by an unrelated git operation).
set -euo pipefail

cd "$(dirname "$0")"

npx expo export --platform web
npx cap sync android

echo "Web bundle exported and synced. Run Gradle from mobile/android, e.g.:"
echo "  cd android && ./gradlew assembleDebug"
