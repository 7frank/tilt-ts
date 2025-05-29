#!/bin/bash

set -e

echo "🧹 Cleaning previous build..."
npm run clean

echo "🔨 Building TypeScript..."
npm run build

echo "✅ Build complete!"
echo "📦 Output in ./dist/"
ls -la dist/
