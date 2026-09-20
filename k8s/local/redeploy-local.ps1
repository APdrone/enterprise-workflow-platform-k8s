param (
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================"
Write-Host " Quick K8s Redeploy: $Target"
Write-Host "======================================================"

$imagesToLoad = @()
$deploymentsToRestart = @()

if ($Target -eq "all" -or $Target -eq "ui" -or $Target -eq "host-app") {
    Write-Host "-> Building host-app..."
    docker build -t docker.io/library/host-app:v1 -f ./apps/host-app/Dockerfile .
    $imagesToLoad += "docker.io/library/host-app:v1"
    $deploymentsToRestart += "deployment/host-app"
}

if ($Target -eq "all" -or $Target -eq "api" -or $Target -eq "services" -or $Target -eq "workflow-api") {
    Write-Host "-> Building workflow-api..."
    docker build -t docker.io/library/workflow-api:v1 -f ./services/workflow-api/Dockerfile .
    $imagesToLoad += "docker.io/library/workflow-api:v1"
    $deploymentsToRestart += "deployment/workflow-api"
}

if ($Target -eq "all" -or $Target -eq "services" -or $Target -eq "notification-service") {
    Write-Host "-> Building notification-service..."
    docker build -t docker.io/library/notification-service:v1 -f ./services/notification-service/Dockerfile .
    $imagesToLoad += "docker.io/library/notification-service:v1"
    $deploymentsToRestart += "deployment/notification-service"
}

if ($Target -eq "all" -or $Target -eq "services" -or $Target -eq "audit-service") {
    Write-Host "-> Building audit-service..."
    docker build -t docker.io/library/audit-service:v1 -f ./services/audit-service/Dockerfile .
    $imagesToLoad += "docker.io/library/audit-service:v1"
    $deploymentsToRestart += "deployment/audit-service"
}

if ($imagesToLoad.Count -gt 0) {
    $kindNode = docker ps -q -f "name=desktop-control-plane"
    if ($kindNode) {
        Write-Host "`nImporting images into containerd..."
        docker save -o ./k8s-redeploy.tar $imagesToLoad
        docker cp ./k8s-redeploy.tar desktop-control-plane:/k8s-redeploy.tar
        docker exec desktop-control-plane ctr -n k8s.io images import /k8s-redeploy.tar
        docker exec desktop-control-plane rm /k8s-redeploy.tar
        if (Test-Path ./k8s-redeploy.tar) {
            Remove-Item ./k8s-redeploy.tar -Force
        }
    }
}

Write-Host "`nRestarting deployments..."
foreach ($dep in $deploymentsToRestart) {
    Write-Host "-> Rolling restart $dep..."
    kubectl rollout restart $dep -n workflow-platform
}

foreach ($dep in $deploymentsToRestart) {
    kubectl rollout status $dep -n workflow-platform --timeout=90s
}

Write-Host "`nDone!"
