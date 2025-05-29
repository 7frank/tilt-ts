
#!/bin/bash
# -- Trigger GitHub workflow manually
set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/workflow.sh [patch|minor|major]"
  exit 1
fi

VERSION_TYPE=$1

echo "🚀 Triggering GitHub workflow for $VERSION_TYPE release..."

gh workflow run publish.yml -f version_type=$VERSION_TYPE

echo "✅ Workflow triggered!"
echo "🔗 Check status: gh run list --workflow=publish.yml"