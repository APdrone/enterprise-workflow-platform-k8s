#!/usr/bin/env bash
# Resume all Workflow Platform Kubernetes workloads and start port-forwards
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "\033[36m▶️  Resuming Workflow Platform workloads...\033[0m"

# 1. Scale statefulsets (database & zookeeper)
kubectl scale statefulset postgres zookeeper --replicas=1 -n workflow-platform

# 2. Scale deployments
kubectl scale deployment kafka workflow-api --replicas=2 -n workflow-platform
kubectl scale deployment host-app notification-service audit-service grafana jaeger kafka-ui prometheus --replicas=1 -n workflow-platform

echo -e "\n\033[90mWaiting for pods to reach Ready state...\033[0m"
kubectl wait --for=condition=ready pod -l app=postgres -n workflow-platform --timeout=30s || true
kubectl wait --for=condition=ready pod -l app=workflow-api -n workflow-platform --timeout=30s || true

# 3. Start port forwards
bash "$SCRIPT_DIR/start-port-forwards.sh"

echo -e "\n\033[32m✅ Workflow Platform resumed successfully with all previous data intact!\033[0m"
