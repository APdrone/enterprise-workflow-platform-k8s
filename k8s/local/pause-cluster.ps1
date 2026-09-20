# Pause all Workflow Platform Kubernetes workloads to 0 replicas
Write-Host "⏸️  Pausing Workflow Platform workloads (scaling to 0 replicas)..." -ForegroundColor Cyan

# 1. Stop active port-forwards
& "$PSScriptRoot\stop-port-forwards.ps1"

# 2. Scale deployments and statefulsets to 0
kubectl scale deployment --all -n workflow-platform --replicas=0
kubectl scale statefulset --all -n workflow-platform --replicas=0

Write-Host "`n✅ All workloads paused! 0% CPU/RAM used." -ForegroundColor Green
Write-Host "PostgreSQL persistent volumes and configurations are safely preserved on disk." -ForegroundColor Gray
Write-Host "Run .\k8s\local\resume-cluster.ps1 when you want to start again." -ForegroundColor Yellow
