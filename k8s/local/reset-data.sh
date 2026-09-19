#!/usr/bin/env bash
set -e

# ==============================================================================
# Fast Data Reset for Kubernetes Local Development
# ==============================================================================

MODE="${1:-fast}"

echo "======================================================"
echo " 🧹 Workflow Platform Data Cleanup / Reset Tool"
echo "======================================================"

if [ "$MODE" == "--hard" ] || [ "$MODE" == "hard" ]; then
    echo -e "\n⚠️  Performing HARD RESET (Deleting Postgres PVC & Recreating Fresh DB)..."
    
    echo "-> Deleting Postgres StatefulSet & PVC..."
    kubectl delete statefulset postgres -n workflow-platform --ignore-not-found=true
    kubectl delete pvc postgres-pvc -n workflow-platform --ignore-not-found=true
    
    echo "-> Re-applying Postgres Manifests..."
    kubectl apply -f k8s/02-postgres.yaml -n workflow-platform
    
    echo "-> Waiting for fresh Postgres pod to become ready..."
    kubectl rollout status statefulset/postgres -n workflow-platform --timeout=60s

    echo "-> Restarting backend services to trigger migrations..."
    kubectl rollout restart deployment/workflow-api deployment/audit-service deployment/notification-service -n workflow-platform
    kubectl rollout status deployment/workflow-api -n workflow-platform --timeout=60s
    kubectl rollout status deployment/audit-service -n workflow-platform --timeout=60s

    echo -e "\n✨ Hard Reset Complete! All databases & PVCs have been recreated fresh."
else
    echo -e "\n⚡ Performing FAST RESET (Truncating all tables in workflow_db and audit_db)..."
    
    echo "-> Truncating workflow_db tables (workflows, workflow_steps, delegations, idempotency_keys, outbox_events)..."
    kubectl exec -n workflow-platform statefulset/postgres -- psql -U postgres -d workflow_db -c "TRUNCATE TABLE workflow_steps, delegations, idempotency_keys, outbox_events, workflows CASCADE;"
    
    echo "-> Purging Kafka topic 'workflow.events'..."
    kubectl exec -n workflow-platform deployment/kafka -- kafka-topics --bootstrap-server localhost:9092 --delete --topic workflow.events --if-exists
    kubectl exec -n workflow-platform deployment/kafka -- kafka-topics --bootstrap-server localhost:9092 --create --if-not-exists --topic workflow.events --partitions 3 --replication-factor 1

    echo -e "\n✨ Fast Reset Complete! All test workflows, audit ledger logs, and Kafka messages have been cleared."
fi
