<#
.SYNOPSIS
  Fast Data Reset for Kubernetes Local Development
.DESCRIPTION
  Cleans up all test data (workflows, steps, audit ledger events, outbox) in workflow_db and audit_db.
#>

param(
    [switch]$HardReset
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 🧹 Workflow Platform Data Cleanup / Reset Tool" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

if ($HardReset) {
    Write-Host "`n⚠️  Performing HARD RESET (Deleting Postgres PVC & Recreating Fresh DB)..." -ForegroundColor Yellow
    
    Write-Host "-> Deleting Postgres StatefulSet & PVC..." -ForegroundColor Gray
    kubectl delete statefulset postgres -n workflow-platform --ignore-not-found=true
    kubectl delete pvc postgres-pvc -n workflow-platform --ignore-not-found=true
    
    Write-Host "-> Re-applying Postgres Manifests..." -ForegroundColor Gray
    kubectl apply -f k8s/02-postgres.yaml -n workflow-platform
    
    Write-Host "-> Waiting for fresh Postgres pod to become ready..." -ForegroundColor Gray
    kubectl rollout status statefulset/postgres -n workflow-platform --timeout=60s

    Write-Host "-> Restarting backend services to trigger migrations..." -ForegroundColor Gray
    kubectl rollout restart deployment/workflow-api deployment/audit-service deployment/notification-service -n workflow-platform
    kubectl rollout status deployment/workflow-api -n workflow-platform --timeout=60s
    kubectl rollout status deployment/audit-service -n workflow-platform --timeout=60s

    Write-Host "`n✨ Hard Reset Complete! All databases & PVCs have been recreated fresh." -ForegroundColor Green
} else {
    Write-Host "`n⚡ Performing FAST RESET (Truncating all tables in workflow_db and audit_db)..." -ForegroundColor Yellow
    
    Write-Host "-> Truncating workflow_db tables (workflows, workflow_steps, delegations, idempotency_keys, outbox_events)..." -ForegroundColor Gray
    kubectl exec -n workflow-platform statefulset/postgres -- psql -U postgres -d workflow_db -c "TRUNCATE TABLE workflow_steps, delegations, idempotency_keys, outbox_events, workflows CASCADE;"
    
    Write-Host "-> Purging Kafka topic 'workflow.events'..." -ForegroundColor Gray
    kubectl exec -n workflow-platform deployment/kafka -- kafka-topics --bootstrap-server localhost:9092 --delete --topic workflow.events --if-exists
    kubectl exec -n workflow-platform deployment/kafka -- kafka-topics --bootstrap-server localhost:9092 --create --if-not-exists --topic workflow.events --partitions 3 --replication-factor 1

    Write-Host "`n✨ Fast Reset Complete! All test workflows, audit ledger logs, and Kafka messages have been cleared." -ForegroundColor Green
}
