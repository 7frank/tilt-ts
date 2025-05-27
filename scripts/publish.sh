
#!/bin/bash

set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/publish.sh [patch|minor|major]"
  exit 1
fi

VERSION_TYPE=$1

echo "🔍 Checking if logged in to npm..."
npm whoami || (echo "❌ Not logged in to npm. Run 'npm login' first." && exit 1)

echo "🧪 Running build..."
./scripts/build.sh

echo "📋 Current version:"
npm version --no-git-tag-version

echo "⬆️  Bumping $VERSION_TYPE version..."
npm version $VERSION_TYPE

echo "📤 Publishing to npm..."
npm publish --access public

echo "✅ Published successfully!"
echo "🏷️  New version: $(npm version --json | jq -r '.\"@tilt-ts/core\"')"
