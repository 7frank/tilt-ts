```typescript
import { k8s_yaml } from "./src/k8s_yaml";
import {
  docker_build,
  sync,
  run,
  LiveUpdatePatterns,
} from "./src/docker_build";

// =========================================================================
// COMPREHENSIVE TILTFILE EXAMPLE
// This shows the power of Tilt's live updates with sync and run steps
// =========================================================================

// Environment configuration
const isDev = process.env.NODE_ENV !== "production";
const namespace = process.env.TILT_NAMESPACE || "dev";

console.log(
  `🚀 Loading Tiltfile for ${isDev ? "development" : "production"} environment`
);

// =========================================================================
// FRONTEND APPLICATION - React/Node.js
// =========================================================================
docker_build(
  "myapp/frontend",
  {
    context: "./frontend",
    dockerfile: isDev ? "Dockerfile.dev" : "Dockerfile",
  },
  {
    ignore: [
      "node_modules/**",
      "**/*.test.js",
      "**/*.test.ts",
      "build/**",
      ".git/**",
    ],
    live_update: [
      // Sync source code changes instantly
      sync("./frontend/src", "/app/src"),
      sync("./frontend/public", "/app/public"),

      // Reinstall dependencies when package files change
      run("npm install", {
        trigger: ["./frontend/package.json", "./frontend/package-lock.json"],
      }),

      // Rebuild when source changes (for TypeScript/build step)
      run("npm run build", {
        trigger: ["./frontend/src/**/*.ts", "./frontend/src/**/*.tsx"],
      }),

      // Restart dev server to pick up changes
      run("pkill -f 'react-scripts' || true && npm start &", {
        trigger: ["./frontend/src/**/*"],
      }),
    ],
  }
);

// =========================================================================
// BACKEND API - Node.js/Express
// =========================================================================
docker_build("myapp/backend", "./backend", {
  ignore: ["node_modules/**", "**/*.test.js", "logs/**"],
  live_update: [
    // Sync source code
    sync("./backend/src", "/app/src"),
    sync("./backend/config", "/app/config"),

    // Handle dependency changes
    run("npm install", {
      trigger: ["./backend/package.json"],
    }),

    // Restart API server with nodemon-like behavior
    run("pkill -f 'node.*server' || true && node src/server.js &", {
      trigger: ["./backend/src/**/*.js", "./backend/config/**/*.json"],
    }),
  ],
});

// =========================================================================
// DATABASE MIGRATIONS - Python
// =========================================================================
docker_build("myapp/migrations", "./database", {
  live_update: [
    sync("./database/migrations", "/app/migrations"),
    sync("./database/scripts", "/app/scripts"),

    // Install Python dependencies
    run("pip install -r requirements.txt", {
      trigger: ["./database/requirements.txt"],
    }),

    // Run migrations when migration files change
    run("python scripts/migrate.py", {
      trigger: [
        "./database/migrations/**/*.sql",
        "./database/migrations/**/*.py",
      ],
    }),
  ],
});

// =========================================================================
// NGINX REVERSE PROXY - Static config with live reload
// =========================================================================
docker_build("myapp/nginx", "./nginx", {
  live_update: [
    // Sync nginx configuration
    sync("./nginx/conf.d", "/etc/nginx/conf.d"),
    sync("./nginx/static", "/usr/share/nginx/html"),

    // Reload nginx when config changes (graceful reload)
    run("nginx -t && nginx -s reload", {
      trigger: ["./nginx/conf.d/**/*.conf"],
    }),
  ],
});

// =========================================================================
// WORKER SERVICE - Go application
// =========================================================================
docker_build(
  "myapp/worker",
  {
    context: "./worker",
    dockerfile: "Dockerfile.dev",
  },
  {
    live_update: [
      sync("./worker/src", "/app/src"),
      sync("./worker/pkg", "/app/pkg"),

      // Download Go modules
      run("go mod download", {
        trigger: ["./worker/go.mod", "./worker/go.sum"],
      }),

      // Build and restart Go service
      run(
        "go build -o /app/worker ./src && pkill worker || true && /app/worker &",
        {
          trigger: ["./worker/src/**/*.go", "./worker/pkg/**/*.go"],
        }
      ),
    ],
  }
);

// =========================================================================
// USING LIVE UPDATE PATTERNS FOR COMMON SCENARIOS
// =========================================================================

// Example using predefined patterns
docker_build("myapp/api-v2", "./api-v2", {
  ignore: ["**/*.test.js", "coverage/**"],
  live_update: LiveUpdatePatterns.nodejs("./api-v2/src", "/app"),
});

// Custom pattern for a complex multi-language service
docker_build("myapp/ml-service", "./ml-service", {
  live_update: LiveUpdatePatterns.custom({
    syncPairs: [
      { local: "./ml-service/python", container: "/app/python" },
      { local: "./ml-service/models", container: "/app/models" },
      { local: "./ml-service/data", container: "/app/data" },
    ],
    buildCommands: [
      {
        cmd: "pip install -r requirements.txt",
        triggers: ["./ml-service/requirements.txt"],
      },
      {
        cmd: "python -m pytest tests/",
        triggers: ["./ml-service/python/**/*.py"],
      },
      {
        cmd: "python scripts/retrain.py",
        triggers: ["./ml-service/data/**/*.csv"],
      },
    ],
  }),
});

// =========================================================================
// KUBERNETES RESOURCES
// =========================================================================

// Load different manifests based on environment
if (isDev) {
  k8s_yaml([
    "./k8s/base/", // Base resources
    "./k8s/dev/", // Development overrides
    "./k8s/configmaps/", // Configuration
    "./k8s/secrets/dev.yaml", // Development secrets
  ]);
} else {
  k8s_yaml(["./k8s/base/", "./k8s/prod/", "./k8s/secrets/prod.yaml"]);
}

// Load monitoring and debugging tools only in development
if (isDev) {
  k8s_yaml("./k8s/debug/**/*.yaml");
}

// =========================================================================
// ADVANCED LIVE UPDATE EXAMPLES
// =========================================================================

// Example: Hot reload for a development database with seed data
docker_build("myapp/dev-db", "./database/dev", {
  live_update: [
    sync("./database/dev/seed-data", "/docker-entrypoint-initdb.d/seed"),
    sync("./database/dev/stored-procedures", "/app/procedures"),

    // Reload database schema when structure changes
    run("psql -U postgres -d myapp -f /app/procedures/schema.sql", {
      trigger: ["./database/dev/stored-procedures/schema.sql"],
    }),

    // Reload seed data for testing
    run(
      "psql -U postgres -d myapp -f /docker-entrypoint-initdb.d/seed/test-data.sql",
      {
        trigger: ["./database/dev/seed-data/**/*.sql"],
      }
    ),
  ],
});

// Example: Multi-container orchestration with dependencies
docker_build("myapp/queue-processor", "./services/queue", {
  live_update: [
    sync("./services/queue/handlers", "/app/handlers"),
    sync("./services/queue/config", "/app/config"),

    // Restart queue consumers when handler code changes
    run("supervisorctl restart queue-consumer:*", {
      trigger: ["./services/queue/handlers/**/*.py"],
    }),

    // Update queue configuration and reload
    run("supervisorctl reread && supervisorctl update", {
      trigger: ["./services/queue/config/supervisor.conf"],
    }),
  ],
});

// =========================================================================
// DEVELOPMENT HELPERS
// =========================================================================

// Example: Live documentation updates
docker_build("myapp/docs", "./docs", {
  live_update: [
    sync("./docs/src", "/app/src"),
    sync("./docs/assets", "/app/assets"),

    // Rebuild documentation when markdown changes
    run("mkdocs build", {
      trigger: ["./docs/src/**/*.md", "./docs/mkdocs.yml"],
    }),
  ],
});

// Example: Live configuration management
docker_build("myapp/config-manager", "./config", {
  live_update: [
    sync("./config/templates", "/app/templates"),
    sync("./config/environments", "/app/environments"),

    // Regenerate configs when templates change
    run("python generate-configs.py", {
      trigger: [
        "./config/templates/**/*.yaml",
        "./config/environments/**/*.json",
      ],
    }),

    // Validate generated configs
    run("python validate-configs.py", {
      trigger: ["./config/templates/**/*"],
    }),
  ],
});

console.log("✅ Tiltfile loaded successfully!");
console.log(
  `📦 Configured ${
    Object.keys(require("./src/tiltState").tiltConfig.state.docker_build).length
  } Docker builds with live updates`
);
console.log(
  "🔄 Live updates will sync your file changes instantly to running containers"
);
console.log("💡 Edit any source file to see the magic happen!");
```
