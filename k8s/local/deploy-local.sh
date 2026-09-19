#!/usr/bin/env bash
# ==============================================================================
# Local Multi-Node Kubernetes Deployment Script (Bash)
# ==============================================================================

set -e

CLUSTER_TYPE="${1:-kind}"

echo "======================================================"
echo " 🚀 Deploying Workflow Platform to Multi-Node K8s"
echo " Cluster Type: ${CLUSTER_TYPE}"
echo "======================================================"

# 1. Spin up cluster if requested
if [ "$CLUSTER_TYPE" = "kind" ]; then
    if ! kind get clusters 2>/dev/null | grep -q "workflow-multi-node"; then
        echo "📦 Creating 3-Node Kind Cluster (1 Control Plane, 2 Workers)..."
        kind create cluster --config k8s/local/kind-config.yaml
        
        echo "🌐 Installing NGINX Ingress Controller..."
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
        echo "⏳ Waiting for Ingress Controller..."
        kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=120s
    else
        echo "✅ Using existing Kind cluster 'workflow-multi-node'"
    fi
elif [ "$CLUSTER_TYPE" = "k3d" ]; then
    if ! k3d cluster list 2>/dev/null | grep -q "workflow-cluster"; then
        echo "📦 Creating 3-Node k3d Cluster (1 Server, 2 Agents)..."
        k3d cluster create --config k8s/local/k3d-config.yaml
    else
        echo "✅ Using existing k3d cluster 'workflow-cluster'"
    fi
fi

# 2. Build Docker images
echo "🔨 Building Microservice Docker Images..."
docker build -t workflow-api:latest -f ./services/workflow-api/Dockerfile .
docker build -t notification-service:latest -f ./services/notification-service/Dockerfile .
docker build -t audit-service:latest -f ./services/audit-service/Dockerfile .
docker build -t host-app:latest -f ./apps/host-app/Dockerfile .

# 3. Load images into cluster nodes
if [ "$CLUSTER_TYPE" = "kind" ]; then
    echo "📥 Loading images into Kind cluster nodes..."
    kind load docker-image docker.io/library/workflow-api:v1 --name workflow-multi-node
    kind load docker-image docker.io/library/notification-service:v1 --name workflow-multi-node
    kind load docker-image docker.io/library/audit-service:v1 --name workflow-multi-node
    kind load docker-image docker.io/library/host-app:v1 --name workflow-multi-node
elif [ "$CLUSTER_TYPE" = "k3d" ]; then
    echo "📥 Importing images into k3d cluster..."
    k3d image import docker.io/library/workflow-api:v1 docker.io/library/notification-service:v1 docker.io/library/audit-service:v1 docker.io/library/host-app:v1 -c workflow-cluster
elif [ "$CLUSTER_TYPE" = "existing" ]; then
    echo "📥 Checking for Kind / Desktop control plane node..."
    if docker ps --filter "name=desktop-control-plane" -q | grep -q .; then
        echo "Saving and importing images into desktop-control-plane node..."
        docker save -o /tmp/k8s-images.tar docker.io/library/workflow-api:v1 docker.io/library/notification-service:v1 docker.io/library/audit-service:v1 docker.io/library/host-app:v1
        docker cp /tmp/k8s-images.tar desktop-control-plane:/k8s-images.tar
        docker exec desktop-control-plane ctr -n k8s.io images import /k8s-images.tar
        docker exec desktop-control-plane rm /k8s-images.tar
        rm -f /tmp/k8s-images.tar
    fi
fi

# 4. Apply Kubernetes Manifests
echo "🚀 Applying Kubernetes Manifests..."
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-configmaps-secrets.yaml
kubectl apply -f k8s/02-postgres.yaml
kubectl apply -f k8s/03-kafka.yaml
kubectl apply -f k8s/04-workflow-api.yaml
kubectl apply -f k8s/05-notification-service.yaml
kubectl apply -f k8s/06-audit-service.yaml
kubectl apply -f k8s/07-host-app.yaml
kubectl apply -f k8s/08-ingress.yaml
kubectl apply -f k8s/09-observability.yaml

# 5. Wait for readiness
echo "⏳ Waiting for core services to become ready..."
sleep 10
kubectl wait --namespace workflow-platform --for=condition=ready pod --selector=app=workflow-api --timeout=180s

echo "======================================================"
echo " 🎉 Multi-Node Deployment Complete!"
echo "======================================================"
echo "Access Points:"
echo " - Web App & UI:    http://localhost"
echo " - Workflow API:    http://localhost/api"
echo " - Health Check:    http://localhost/health"
echo " - Metrics:         http://localhost/metrics"
echo " - Jaeger Tracing:  kubectl port-forward -n workflow-platform svc/jaeger 16686:16686"
echo " - Prometheus:      kubectl port-forward -n workflow-platform svc/prometheus 9090:9090"
echo ""
echo "Pod Distribution Across Nodes:"
kubectl get pods -n workflow-platform -o wide
