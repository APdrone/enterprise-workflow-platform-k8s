# Start port forwards for all Workflow Platform Kubernetes services
Write-Host "Starting port-forward tunnels for all Workflow Platform services..." -ForegroundColor Cyan

# Clean up any existing port forwards first
taskkill /F /IM kubectl.exe 2>$null | Out-Null

cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/host-app 8080:80
cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/workflow-api 3000:3000
cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/notification-service 3001:3001
cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/audit-service 3002:3002
cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/jaeger 16686:16686
cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/prometheus 9090:9090
cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/kafka-ui 8085:8085
cmd /c start /b kubectl port-forward --address 0.0.0.0 -n workflow-platform svc/postgres 5433:5432

Write-Host "`nAll port-forward tunnels active!" -ForegroundColor Green
Write-Host " - Web App UI:       http://localhost:8080"
Write-Host " - Workflow API:     http://localhost:3000/ready"
Write-Host " - Notification:     http://localhost:3001/health"
Write-Host " - Audit Service:    http://localhost:3002/health"
Write-Host " - Kafka UI:         http://localhost:8085"
Write-Host " - Jaeger Tracing:   http://localhost:16686/search"
Write-Host " - Prometheus UI:    http://localhost:9090/targets"
Write-Host " - Postgres DB:      localhost:5433 (user: postgres, pass: postgres)"
