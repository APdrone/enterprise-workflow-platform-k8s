#!/usr/bin/env bash
# Start port forwards for all Workflow Platform Kubernetes services
echo "Starting port-forward tunnels for all Workflow Platform services..."

# Clean up any existing port forwards first
if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //IM kubectl.exe >/dev/null 2>&1 || true
elif command -v pkill >/dev/null 2>&1; then
    pkill -f "kubectl port-forward -n workflow-platform" || true
fi

kubectl port-forward -n workflow-platform svc/host-app 8080:80 --address 0.0.0.0,127.0.0.1 &
kubectl port-forward -n workflow-platform svc/workflow-api 3000:3000 --address 0.0.0.0,127.0.0.1 &
kubectl port-forward -n workflow-platform svc/notification-service 3001:3001 --address 0.0.0.0,127.0.0.1 &
kubectl port-forward -n workflow-platform svc/audit-service 3002:3002 --address 0.0.0.0,127.0.0.1 &
kubectl port-forward -n workflow-platform svc/jaeger 16686:16686 --address 0.0.0.0,127.0.0.1 &
kubectl port-forward -n workflow-platform svc/prometheus 9090:9090 --address 0.0.0.0,127.0.0.1 &
kubectl port-forward -n workflow-platform svc/kafka-ui 8085:8085 --address 0.0.0.0,127.0.0.1 &
kubectl port-forward -n workflow-platform svc/postgres 5433:5432 --address 0.0.0.0,127.0.0.1 &

echo ""
echo "All port-forward tunnels active!"
echo " - Web App UI:       http://localhost:8080"
echo " - Workflow API:     http://localhost:3000/ready"
echo " - Notification:     http://localhost:3001/health"
echo " - Audit Service:    http://localhost:3002/health"
echo " - Kafka UI:         http://localhost:8085"
echo " - Jaeger Tracing:   http://localhost:16686/search"
echo " - Prometheus UI:    http://localhost:9090/targets"
echo " - Postgres DB:      localhost:5433 (user: postgres, pass: postgres)"
