## use cases

```typescript
sync("./frontend/src", "/app/src"); // Sync entire directory
sync("./config/*.json", "/app/config"); // Sync specific files
```

```typescript
run("npm install", { trigger: ["package.json"] }); // Dependency updates
run("nginx -s reload", { trigger: ["conf.d/**/*.conf"] }); // Config reloads
run("npm run build", { trigger: ["src/**/*.ts"] }); // Build processes
```

```typescript
// Database schema updates
run("psql -f schema.sql", { trigger: ["schema.sql"] });

// Configuration reloads
run("supervisorctl restart all", { trigger: ["config/**/*"] });

// Multi-step builds
sync("./src", "/app/src"),
  run("npm run build", { trigger: ["src/**/*.ts"] }),
  run("pm2 restart app", { trigger: ["src/**/*"] });
```
