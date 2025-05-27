# Build & Publish Setup

## 🚀 Quick Setup

1. **Make scripts executable**:
```bash
chmod +x scripts/*.sh
```

2. **Setup npm account**:
```bash
npm login
```

3. **Setup GitHub secrets**:
   - Go to your repo Settings → Secrets and Variables → Actions
   - Add `NPM_TOKEN` (get from npmjs.com → Access Tokens)

## 📦 Local Build & Publish

```bash
# Build only
./scripts/build.sh

# Build and publish (patch version)
./scripts/publish.sh patch

# Build and publish (minor version)
./scripts/publish.sh minor

# Build and publish (major version)
./scripts/publish.sh major
```

## 🤖 GitHub Actions

### Automatic (on git tags):
```bash
git tag v1.0.0
git push origin v1.0.0
```

### Manual trigger:
```bash
# Using GitHub CLI
./scripts/workflow.sh patch

# Or via GitHub web interface
# Go to Actions → Build and Publish → Run workflow
```

## 📋 Package Structure After Build

```
dist/
├── index.js          # Main exports
├── index.d.ts        # Type definitions
├── tilt.js           # CLI binary (executable)
├── src/              # All source modules
│   ├── docker_build.js
│   ├── k8s_yaml.js
│   └── ...
└── *.map             # Source maps
```

## 🎯 Usage After Publishing

```bash
# Install globally
npm install -g @nk11/tilt-ts

# Use CLI
tilt-ts up

# Use as library
npm install @nk11/tilt-ts
```

```typescript
// In your code
import { docker_build, k8s_yaml, TiltEngine } from '@nk11/tilt-ts';
```

## ✅ Checklist Before Publishing

- [ ] Update package.json version, author, repository URLs
- [ ] Test build: `npm run build`
- [ ] Test CLI: `node dist/tilt.js --help`
- [ ] Login to npm: `npm login`
- [ ] Add NPM_TOKEN to GitHub secrets
- [ ] Test publish: `npm publish --dry-run`