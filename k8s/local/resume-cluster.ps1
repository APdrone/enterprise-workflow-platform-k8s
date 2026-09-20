# Resume all Workflow Platform Kubernetes workloads and start port-forwards
Write-Host "▶️  Resuming Workflow Platform workloads..." -ForegroundColor Cyan

# 1. Scale statefulsets (database & zookeeper)
kubectl scale statefulset postgres zookeeper --replicas=1 -n workflow-platform

# 2. Scale deployments
kubectl scale deployment kafka workflow-api --replicas=2 -n workflow-platform
kubectl scale deployment host-app notification-service audit-service grafana jaeger kafka-ui prometheus --replicas=1 -n workflow-platform

Write-Host "`nWaiting for pods to reach Ready state..." -ForegroundColor Gray
kubectl wait --for=condition=ready pod -l app=postgres -n workflow-platform --timeout=30s
kubectl wait --for=condition=ready pod -l app=workflow-api -n workflow-platform --timeout=30s

# 3. Start port forwards
& "$PSScriptRoot\start-port-forwards.ps1"

Write-Host "`n✅ Workflow Platform resumed successfully with all previous data intact!" -ForegroundColor Green
