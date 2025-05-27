# Tilt TypeScript

A TypeScript implementation of core [Tilt.dev](https://tilt.dev/) functionality for Kubernetes development workflows. This project brings Tilt's powerful development features to TypeScript environments with live updates, file syncing, and automated deployments.

## 🚀 Features

- **Docker Build Management** - Automated image building and registry pushing
- **Kubernetes Resource Management** - YAML deployment and lifecycle management
- **Live Updates** - Real-time file syncing and command execution in running containers
- **File Watching** - Intelligent file change detection with pattern matching
- **Hot Reloading** - Instant feedback loop for development changes
- **Dry Run Mode** - Preview changes before applying them
- **Multi-container Support** - Handle complex multi-service applications

## 📋 Prerequisites

- **Node.js** 18+ or **Bun** runtime
- **Docker** with daemon running
- **kubectl** configured with cluster access
- **Kubernetes cluster** (local or remote)
- **Container registry** (like k3d registry or Docker Hub)

## 🛠️ Installation

```bash
# Clone the repository
git clone <repository-url>
cd tilt_ts

# Install dependencies (using Bun)
bun i @nk11/tilt-ts

# Or using npm
npm i @nk11/tilt-ts
```

## ⚙️ Configuration

### Default Configuration

The tool uses these defaults (configurable via `tiltfile.ts`):

- **Docker Registry**: `localhost:36269` (k3d default)
- **Kubernetes Context**: `k3d-ecosys-local-dev`
- **Namespace**: `eco-test` (auto-normalized to `eco-test`)

### Setting up k3d (Optional)

For local development with k3d:

```bash
# Create a k3d cluster with registry
k3d cluster create ecosys-local-dev --registry-create k3d-registry:0.0.0.0:36269

# Get cluster info
kubectl cluster-info
```

## 📝 Tiltfile Configuration

Create a `tiltfile.ts` in your project root:

```typescript
import { k8s_yaml } from "./src/k8s_yaml";
import { docker_build } from "./src/docker_build";
import { sync, run } from "./src/SYNC";

// Build Docker image with live updates
docker_build(
  "myapp/frontend",
  {
    context: "./webapp",
    dockerfile: "Dockerfile",
  },
  {
    ignore: ["*.log", "node_modules", "*.test.js"],
    live_update: [
      // Sync source files to container
      sync("src/**/*", "/app/src"),
      sync("public/**/*", "/app/public"),

      // Restart service when package.json changes
      run("npm install", { trigger: ["package.json"] }),

      // Reload server on code changes
      run("pkill -f 'node.*server' && npm start &", {
        trigger: ["src/**/*.js", "src/**/*.ts"],
      }),
    ],
  }
);

// Deploy Kubernetes resources
k8s_yaml("./k8s/");
// k8s_yaml(["./deployment.yaml", "./service.yaml"]); // Alternative
```

### Live Update Options

#### Sync Steps

```typescript
sync("local/path/**/*", "/container/path");
```

- Copies files from local filesystem to running container
- Supports glob patterns and wildcards
- Preserves directory structure

#### Run Steps

```typescript
run("command to execute", { trigger: ["file/pattern"] });
```

- Executes commands inside the container
- Triggered by specific file changes
- Useful for recompiling, reloading, or restarting services

#### Ignore Patterns

```typescript
{
  ignore: ["*.log", "tmp/*", "node_modules", ".git/**"];
}
```

## 🚀 Usage

### Basic Commands

```bash
# Start development environment
bun run start
# or
bun run up

# Start without live updates
tilt up --no-dev

# Preview changes (dry run)
bun run dry-run

# Check current status
bun run status

# Validate configuration
bun run validate

# Stop and cleanup
bun run down
```

### Advanced Usage

#### Custom Tiltfile Location

```bash
bun run tilt.ts -f ./custom/tiltfile.ts up
```

#### Environment-specific Configs

```typescript
// tiltfile.production.ts
import { tiltConfig } from "./src/tiltState";

tiltConfig.setDockerRegistry("production-registry.io");
tiltConfig.setK8sContext("production-cluster");
tiltConfig.setK8sNamespace("production");
```

## 🔄 Live Updates in Action

When you run `tilt up`, the system:

1. **Builds** Docker images defined in your Tiltfile
2. **Deploys** Kubernetes resources to your cluster
3. **Watches** for file changes in configured directories
4. **Syncs** changed files directly to running containers
5. **Executes** trigger commands when specific files change

### Example Development Flow

```bash
# Start Tilt
$ bun run start
🚀 Starting Tilt (dev mode)...
✅ Pre-flight checks passed
🐳 Building image: myapp/frontend
📦 Tagged: localhost:36269/myapp/frontend:latest
☸️  Applying: ./k8s/deployment.yaml
🔄 Starting live updates for myapp/frontend...
✅ Live updates active for myapp/frontend -> frontend-pod-xyz
📋 Development Mode Instructions:
   - Edit files in your project directories
   - Changes will be automatically synced to running containers

# Edit a file
$ echo "console.log('Updated!');" >> src/app.js
📁 File change: src/app.js
📂 Syncing src/app.js -> /app/src/app.js
✅ Synced src/app.js -> /app/src/app.js
🚀 Running command: npm restart
✅ Command executed successfully
```

## 📁 Project Structure

```
tilt_ts/
├── src/
│   ├── docker_build.ts        # Docker build configuration
│   ├── k8s_yaml.ts           # Kubernetes YAML handling
│   ├── tiltEngine.ts         # Main orchestration engine
│   ├── liveUpdateManager.ts  # Live update functionality
│   ├── dockerManager.ts      # Docker operations
│   ├── kubernetesManager.ts  # Kubernetes operations
│   ├── stateAnalyzer.ts      # Change detection
│   ├── tiltState.ts          # Configuration state
│   ├── types.ts              # TypeScript definitions
│   └── utils/
│       └── shellExecutor.ts  # Shell command utilities
├── example/                   # Example application
│   ├── Dockerfile
│   ├── deployment.yaml
│   └── service.yaml
├── tiltfile.ts               # Main configuration
├── tilt.ts                   # CLI entry point
└── package.json
```

## 🔧 API Reference

### docker_build()

```typescript
docker_build(imageName: string, buildContext: BuildContext, liveUpdates?: LiveUpdateConfig)
```

**Parameters:**

- `imageName`: Name for the Docker image
- `buildContext`: Build configuration
  - `context`: Build context directory
  - `dockerfile`: Dockerfile path (default: "Dockerfile")
  - `build_args`: Build arguments
- `liveUpdates`: Live update configuration (optional)

### k8s_yaml()

```typescript
k8s_yaml(yamlPath: string | string[])
```

**Parameters:**

- `yamlPath`: Path to YAML file(s), directory, or glob pattern

**Examples:**

```typescript
k8s_yaml("./deployment.yaml"); // Single file
k8s_yaml("./k8s/"); // Directory
k8s_yaml("./k8s/*.yaml"); // Glob pattern
k8s_yaml(["./deploy.yaml", "./svc.yaml"]); // Multiple files
```

### Live Update Steps

#### sync()

```typescript
sync(localPath: string, containerPath: string)
```

#### run()

```typescript
run(command: string, options: { trigger: string[] })
```

## 🐛 Troubleshooting

### Common Issues

**Docker Build Fails**

```bash
# Check Docker daemon
docker info

# Verify registry connectivity
docker push localhost:36269/test:latest
```

**Kubernetes Connection Issues**

```bash
# Check current context
kubectl config current-context

# Test cluster connectivity
kubectl cluster-info

# Verify namespace
kubectl get namespaces
```

**Live Updates Not Working**

```bash
# Check pod status
kubectl get pods -n your-namespace

# View live update status
bun run status

# Check container logs
kubectl logs <pod-name> -n <namespace>
```

### Debug Mode

Enable verbose logging:

```bash
DEBUG=1 bun run start
```

### File Permissions

If sync operations fail, check container permissions:

```dockerfile
# In your Dockerfile
RUN chmod -R 755 /app
USER 1000:1000  # Or appropriate user
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type checking
bun run type-check

# Linting
bun run lint
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Tilt.dev](https://tilt.dev/) - Original inspiration and API design
- [Kubernetes](https://kubernetes.io/) - Container orchestration
- [Docker](https://docker.com/) - Containerization platform

## 📚 Related Resources

- [Tilt.dev Documentation](https://docs.tilt.dev/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [kubectl Reference](https://kubernetes.io/docs/reference/kubectl/)

---

**Made with ❤️ for Kubernetes developers**
