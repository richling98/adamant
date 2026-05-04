#!/bin/bash

# Exit on error
set -e

# Add log level selector with default to INFO
LOG_LEVEL=${1:-info}

case $LOG_LEVEL in
    info|debug|trace)
        export RUST_LOG=$LOG_LEVEL
        ;;
    *)
        echo "Invalid log level: $LOG_LEVEL. Valid options: info, debug, trace"
        exit 1
        ;;
esac

# Clean up previous builds
echo "Cleaning up previous builds..."
#rm -rf target/
#rm -rf src-tauri/target
#rm -rf src-tauri/gen

# Clean up npm, pnp and next
echo "Cleaning up npm, pnp and next..."
rm -rf node_modules
rm -rf .next
rm -rf .pnp.cjs
rm -rf out

echo "Installing dependencies..."
pnpm install

# Build the Next.js application first
echo "Building Next.js application..."
pnpm run build

# Set environment variables for the build
echo "Setting up build environment..."

# Seed dev app data so onboarding is skipped and meetings are visible
PROD_APP_DATA="$HOME/Library/Application Support/com.adamant.ai"
DEV_APP_DATA="$HOME/Library/Application Support/com.adamant.ai.dev"
mkdir -p "$DEV_APP_DATA"

# Skip onboarding by seeding completion status
cat > "$DEV_APP_DATA/onboarding-status.json" << 'EOF'
{"status":{"completed":true,"current_step":4,"last_updated":"2026-01-01T00:00:00.000000+00:00","model_status":{"parakeet":"downloaded","summary":"downloaded"},"version":"1.0"}}
EOF
echo "Dev onboarding pre-seeded (skipped)."

# Copy production meetings database so dev shows real data
if [ -f "$PROD_APP_DATA/meeting_minutes.sqlite" ]; then
  cp "$PROD_APP_DATA/meeting_minutes.sqlite" "$DEV_APP_DATA/meeting_minutes.sqlite"
  echo "Dev database seeded from production ($(du -h "$DEV_APP_DATA/meeting_minutes.sqlite" | cut -f1) copied)."
else
  echo "No production database found — dev will start with empty meetings."
fi

# Symlink production models so dev sees downloaded models without duplicating disk space
if [ -d "$PROD_APP_DATA/models" ]; then
  rm -rf "$DEV_APP_DATA/models"
  ln -s "$PROD_APP_DATA/models" "$DEV_APP_DATA/models"
  echo "Dev models symlinked from production."
else
  echo "No production models directory found — skipping model symlink."
fi

if [[ "$(uname)" == "Darwin" ]]; then
  echo "Building Tauri app bundle (dev mode — uses isolated app data: com.adamant.ai.dev)..."
  DEV_APP_NAME="Adamant Dev"
  DEV_APP_PATH="../target/debug/bundle/macos/${DEV_APP_NAME}.app"
  DEV_TAURI_CONFIG='{"identifier":"com.adamant.ai.dev","productName":"Adamant Dev","bundle":{"createUpdaterArtifacts":false}}'

  pnpm tauri build --debug --bundles app --config "$DEV_TAURI_CONFIG"

  # macOS privacy permissions are tied to a bundle identity and code requirement.
  # `tauri dev` runs the raw target/debug binary, which may not appear in
  # Privacy & Security. Sign and launch the debug .app so Microphone permission
  # can be granted to the dev app as "Adamant Dev".
  codesign --force --deep --sign - \
    --identifier com.adamant.ai.dev \
    --entitlements src-tauri/entitlements.plist \
    "$DEV_APP_PATH"

  echo "Launching ${DEV_APP_NAME}.app..."
  open -n "$DEV_APP_PATH"
  echo "Launched ${DEV_APP_NAME}. If microphone access is requested, approve ${DEV_APP_NAME} in System Settings."
else
  echo "Building Tauri app (dev mode — uses isolated app data: com.adamant.ai.dev)..."
  pnpm tauri dev --config '{"identifier": "com.adamant.ai.dev"}'
  sleep
fi
