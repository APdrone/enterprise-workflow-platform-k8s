#!/usr/bin/env bash
# Pause all Workflow Platform Kubernetes workloads to 0 replicas
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "\033[36m⏸️  Pausing Workflow Platform workloads (scaling to 0 replicas)...\033[0m"

# 1. Stop active port-forwards
bash "$SCRIPT_DIR/stop-port-forwards.sh"

# 2. Scale deployments and statefulsets to 0
kubectl scale deployment --all -n workflow-platform --replicas=0
kubectl scale statefulset --all -n workflow-platform --replicas=0

echo -e "\n\033[32m✅ All workloads paused! 0% CPU/RAM used.\033[0m"
echo -e "\033[90mPostgreSQL persistent volumes and configurations are safely preserved on disk.\033[0m"
echo -e "\033[33mRun ./k8s/local/resume-cluster.sh (or npm run k8s:resume) when you want to start again.\033[0m"
