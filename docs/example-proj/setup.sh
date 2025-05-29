#!/bin/bash
# setup.sh - Quick setup for Express.js + Tilt-TS example

set -e

echo "🚀 Setting up Express.js + Tilt-TS Example"
echo "=========================================="

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please upgrade to Node.js 18+"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker daemon not running. Please start Docker"
    exit 1
fi

echo "✅ Docker $(docker --version)"

# Check kubectl
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl"
    exit 1
fi

echo "✅ kubectl $(kubectl version --client --short 2>/dev/null | head -1)"

# Check k3d (optional)
if command -v k3d &> /dev/null; then
    echo "✅ k3d $(k3d version)"
    
    # Check if cluster exists
    if ! k3d cluster list | grep -q "local-dev"; then
        echo "📦 Creating k3d cluster with registry..."
        k3d cluster create local-dev --registry-create registry:0.0.0.0:36269
        echo "✅ k3d cluster created"
    else
        echo "✅ k3d cluster already exists"
    fi
else
    echo "⚠️  k3d not found (optional, but recommended for local development)"
fi

# Check cluster connection
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    echo "💡 If using k3d, run: k3d cluster start local-dev"
    exit 1
fi

echo "✅ Kubernetes cluster connected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create directories
mkdir -p src/routes public

echo "✅ Dependencies installed!"

# Set up Tilt
echo "🔧 Setting up Tilt..."

# Install tilt-ts globally if not installed
if ! command -v tilt-ts &> /dev/null; then
    echo "📦 Installing @nk11/tilt-ts globally..."
    npm install -g @nk11/tilt-ts
fi

echo "✅ Tilt-TS ready!"

# Final instructions
echo ""
echo "🎉 Setup complete! Next steps:"
echo ""
echo "1. Start the development environment:"
echo "   npm run tilt:up"
echo ""
echo "2. Open your browser:"
echo "   http://localhost:30080"
echo ""
echo "3. Edit files to see live updates:"
echo "   - server.js (main server)"
echo "   - public/index.html (frontend)"
echo "   - src/routes/api.js (API routes)"
echo ""
echo "4. Stop when done:"
echo "   npm run tilt:down"
echo ""
echo "🔗 Useful commands:"
echo "   npm run tilt:status  # Check status"
echo "   kubectl get pods     # Check pods"
echo "   kubectl logs -f deployment/express-app  # View logs"
echo ""
echo "Happy coding! 🚀"