# ==============================================================================
# Local Multi-Node Kubernetes Deployment Script (PowerShell)
# ==============================================================================

param (
    [ValidateSet("kind", "k3d", "existing")]
    [string]$ClusterType = "kind"
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 🚀 Deploying Workflow Platform to Multi-Node K8s" -ForegroundColor Cyan
Write-Host " Cluster Type: $ClusterType" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# 1. Spin up cluster if requested
if ($ClusterType -eq "kind") {
    $existing = kind get clusters 2>$null | Select-String "workflow-multi-node"
    if (-not $existing) {
        Write-Host "`n📦 Creating 3-Node Kind Cluster (1 Control Plane, 2 Workers)..." -ForegroundColor Yellow
        kind create cluster --config k8s/local/kind-config.yaml
        
        Write-Host "`n🌐 Installing NGINX Ingress Controller..." -ForegroundColor Yellow
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
        Write-Host "⏳ Waiting for Ingress Controller to be ready..." -ForegroundColor Gray
        kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=120s
    } else {
        Write-Host "`n✅ Using existing Kind cluster 'workflow-multi-node'" -ForegroundColor Green
    }
} elseif ($ClusterType -eq "k3d") {
    $existing = k3d cluster list 2>$null | Select-String "workflow-cluster"
    if (-not $existing) {
        Write-Host "`n📦 Creating 3-Node k3d Cluster (1 Server, 2 Agents)..." -ForegroundColor Yellow
        k3d cluster create --config k8s/local/k3d-config.yaml
    } else {
        Write-Host "`n✅ Using existing k3d cluster 'workflow-cluster'" -ForegroundColor Green
    }
}

# 2. Build Docker images
Write-Host "`n🔨 Building Microservice Docker Images..." -ForegroundColor Yellow

Write-Host "-> Building workflow-api:latest..." -ForegroundColor Gray
docker build -t workflow-api:latest -f ./services/workflow-api/Dockerfile .

Write-Host "-> Building notification-service:latest..." -ForegroundColor Gray
docker build -t notification-service:latest -f ./services/notification-service/Dockerfile .

Write-Host "-> Building audit-service:latest..." -ForegroundColor Gray
docker build -t audit-service:latest -f ./services/audit-service/Dockerfile .

Write-Host "-> Building host-app:latest..." -ForegroundColor Gray
docker build -t host-app:latest -f ./apps/host-app/Dockerfile .

# 3. Load images into cluster nodes
if ($ClusterType -eq "kind") {
    Write-Host "`n📥 Loading images into Kind cluster nodes..." -ForegroundColor Yellow
    kind load docker-image docker.io/library/workflow-api:v1 --name workflow-multi-node
    kind load docker-image docker.io/library/notification-service:v1 --name workflow-multi-node
    kind load docker-image docker.io/library/audit-service:v1 --name workflow-multi-node
    kind load docker-image docker.io/library/host-app:v1 --name workflow-multi-node
} elseif ($ClusterType -eq "k3d") {
    Write-Host "`n📥 Importing images into k3d cluster..." -ForegroundColor Yellow
    k3d image import docker.io/library/workflow-api:v1 docker.io/library/notification-service:v1 docker.io/library/audit-service:v1 docker.io/library/host-app:v1 -c workflow-cluster
} elseif ($ClusterType -eq "existing") {
    Write-Host "`n📥 Checking for Kind / Desktop control plane node..." -ForegroundColor Yellow
    $hasDesktop = docker ps --filter "name=desktop-control-plane" -q
    if ($hasDesktop) {
        Write-Host "Saving and importing images into desktop-control-plane node..." -ForegroundColor Gray
        docker save -o .\k8s-images.tar docker.io/library/workflow-api:v1 docker.io/library/notification-service:v1 docker.io/library/audit-service:v1 docker.io/library/host-app:v1
        docker cp .\k8s-images.tar desktop-control-plane:/k8s-images.tar
        docker exec desktop-control-plane ctr -n k8s.io images import /k8s-images.tar
        docker exec desktop-control-plane rm /k8s-images.tar
        Remove-Item .\k8s-images.tar -Force
    }
}

# 4. Apply Kubernetes Manifests
Write-Host "`n🚀 Applying Kubernetes Manifests..." -ForegroundColor Yellow
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
Write-Host "`n⏳ Waiting for core services to become ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
kubectl wait --namespace workflow-platform --for=condition=ready pod --selector=app=workflow-api --timeout=180s

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host " 🎉 Multi-Node Deployment Complete!" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host "Access Points:"
Write-Host " - Web App & UI:    http://localhost"
Write-Host " - Workflow API:    http://localhost/api"
Write-Host " - Health Check:    http://localhost/health"
Write-Host " - Metrics:         http://localhost/metrics"
Write-Host " - Jaeger Tracing:  kubectl port-forward -n workflow-platform svc/jaeger 16686:16686"
Write-Host " - Prometheus:      kubectl port-forward -n workflow-platform svc/prometheus 9090:9090"
Write-Host "`nPod Distribution Across Nodes:"
kubectl get pods -n workflow-platform -o wide
