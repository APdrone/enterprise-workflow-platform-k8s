# Start port forwards for all Workflow Platform Kubernetes services
Write-Host "Starting port-forward tunnels for all Workflow Platform services..." -ForegroundColor Cyan

# Clean up any existing port forwards first
taskkill /F /IM kubectl.exe 2>$null | Out-Null

$services = @(
  @{ Svc = 'svc/host-app'; Local = 8080; Remote = 80 },
  @{ Svc = 'svc/workflow-api'; Local = 3000; Remote = 3000 },
  @{ Svc = 'svc/notification-service'; Local = 3001; Remote = 3001 },
  @{ Svc = 'svc/audit-service'; Local = 3002; Remote = 3002 },
  @{ Svc = 'svc/jaeger'; Local = 16686; Remote = 16686 },
  @{ Svc = 'svc/prometheus'; Local = 9090; Remote = 9090 },
  @{ Svc = 'svc/grafana'; Local = 3005; Remote = 3005 },
  @{ Svc = 'svc/kafka-ui'; Local = 8085; Remote = 8085 },
  @{ Svc = 'svc/postgres'; Local = 5433; Remote = 5432 }
)

foreach ($item in $services) {
  Start-Process kubectl -ArgumentList "port-forward", "--address", "0.0.0.0", "-n", "workflow-platform", $item.Svc, "$($item.Local):$($item.Remote)" -WindowStyle Hidden
}


Write-Host "`nAll port-forward tunnels active!" -ForegroundColor Green
Write-Host " - Web App UI:       http://localhost:8080"
Write-Host " - Workflow API:     http://localhost:3000/ready"
Write-Host " - Notification:     http://localhost:3001/health"
Write-Host " - Audit Service:    http://localhost:3002/health"
Write-Host " - Grafana UI:       http://localhost:3005"
Write-Host " - Kafka UI:         http://localhost:8085"
Write-Host " - Jaeger Tracing:   http://localhost:16686/search"
Write-Host " - Prometheus UI:    http://localhost:9090/targets"
Write-Host " - Postgres DB:      localhost:5433 (user: postgres, pass: postgres)"

