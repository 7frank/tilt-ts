# Express.js + Tilt-TS Example

A complete example demonstrating how to use **@nk11/tilt-ts** for Kubernetes development with an Express.js application.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker
- kubectl configured with a cluster
- k3d cluster (recommended for local development)

### Setup k3d Cluster (Optional)
```bash
# Create cluster with registry
k3d cluster create local-dev --registry-create registry:0.0.0.0:36269

# Verify cluster
kubectl cluster-info
```

### Install & Run
```bash
# Clone or create this project
mkdir express-tilt-example && cd express-tilt-example

# Install dependencies
npm install

# Start development with Tilt
npm run tilt:up
```

## 📁 Project Structure

```
express-tilt-example/
├── server.js              # Express.js server
├── Dockerfile             # Container definition
├── deployment.yaml        # Kubernetes deployment
├── service.yaml           # Kubernetes service
├── tiltfile.ts            # Tilt configuration
├── public/
│   └── index.html         # Frontend
└── src/
    └── routes/
        └── api.js         # API routes
```

## 🔄 Live Updates

This example showcases Tilt's powerful live update features:

### File Sync
- **server.js** → `/app/server.js` (instant sync)
- **src/** → `/app/src/` (directory sync)
- **public/** → `/app/public/` (asset sync)

### Trigger Commands
- **server.js changes** → Restart Node.js server
- **package.json changes** → Reinstall dependencies
- **Code changes** → Log update timestamp

## 🌐 Accessing the App

Once `tilt up` completes:

- **Web App**: http://localhost:30080
- **Health Check**: http://localhost:30080/api/health
- **API Stats**: http://localhost:30080/api/stats

## 🧪 Testing Live Updates

1. **Edit server.js**:
   ```javascript
   // Change the hello endpoint
   app.get('/api/hello', (req, res) => {
     res.json({ 
       message: `Hello, ${name}! 🎉 Updated!`,  // <- Change this
       env: process.env.NODE_ENV || 'development'
     });
   });
   ```

2. **Edit public/index.html**:
   ```html
   <h1>🚀 Express.js + Tilt-TS (UPDATED!)</h1>
   ```

3. **Add new API route in src/routes/api.js**:
   ```javascript
   router.get('/new-endpoint', (req, res) => {
     res.json({ message: 'New endpoint added live!' });
   });
   ```

## 📊 Available Commands

```bash
# Start Tilt development environment
npm run tilt:up

# Stop and cleanup
npm run tilt:down

# Check status
npm run tilt:status

# Run locally (without Kubernetes)
npm start
npm run dev  # with nodemon
```

## 🔍 Monitoring & Debugging

### Check Pod Status
```bash
kubectl get pods
kubectl logs -f deployment/express-app
```

### Tilt Status
```bash
tilt-ts status
```

### Service Info
```bash
kubectl get svc express-app-service
kubectl describe deployment express-app
```

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Check what's using port 30080
lsof -i :30080

# Kill process if needed
kill -9 <PID>
```

### Docker Build Issues
```bash
# Check Docker daemon
docker info

# Manually build
docker build -t express-app .

# Check registry
docker push localhost:36269/express-app:latest
```

### Kubernetes Issues
```bash
# Check cluster connection
kubectl cluster-info

# Check namespace
kubectl get namespaces

# Reset if needed
kubectl delete deployment express-app
kubectl delete service express-app-service
```

## 🎯 What This Example Demonstrates

- ✅ **Docker Build** with multi-stage optimization
- ✅ **Kubernetes Deployment** with health checks
- ✅ **Live File Sync** for instant updates
- ✅ **Command Triggers** for dependency management
- ✅ **Service Exposure** via NodePort
- ✅ **Error Handling** and graceful shutdown
- ✅ **Development Workflow** with hot reloading

## 🚀 Next Steps

1. **Add a Database**: Include MongoDB or PostgreSQL
2. **Add Tests**: Unit and integration testing
3. **Environment Configs**: Separate dev/prod configs
4. **Ingress**: Use ingress controller instead of NodePort
5. **Monitoring**: Add Prometheus metrics
6. **CI/CD**: GitHub Actions for deployment

## 📚 Learn More

- [Tilt-TS Documentation](https://github.com/yourusername/tilt_ts)
- [Express.js Guide](https://expressjs.com/en/starter/installing.html)
- [Kubernetes Basics](https://kubernetes.io/docs/tutorials/kubernetes-basics/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)

---

**Happy coding! 🎉** This example shows the power of Tilt for Kubernetes development.