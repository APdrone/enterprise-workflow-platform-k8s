#!/usr/bin/env bash
# ==============================================================================
# Fast Local Kubernetes Redeployment & Image Reload Script (Bash)
# Usage: ./k8s/local/redeploy-local.sh [all|ui|api|services]
# ==============================================================================

set -eo pipefail

TARGET="${1:-all}"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN} 🔄 Quick K8s Redeploy & Image Reload${NC}"
echo -e "${CYAN} Target: ${TARGET}${NC}"
echo -e "${CYAN}======================================================${NC}"

IMAGES_TO_LOAD=()
DEPLOYMENTS_TO_RESTART=()

# 1. Build Targeted Docker Images
echo -e "\n${YELLOW}🔨 Building Updated Docker Images...${NC}"

if [[ "$TARGET" =~ ^(all|ui|host-app)$ ]]; then
    echo -e "${GRAY}-> Building host-app (--no-cache)...${NC}"
    docker build --no-cache -t host-app:latest -t workflow-host-app:latest -t docker.io/library/host-app:v1 -f ./apps/host-app/Dockerfile .
    IMAGES_TO_LOAD+=("docker.io/library/host-app:v1")
    DEPLOYMENTS_TO_RESTART+=("deployment/host-app")
fi

if [[ "$TARGET" =~ ^(all|ui|widget)$ ]]; then
    echo -e "${GRAY}-> Building workflow-widget (--no-cache)...${NC}"
    docker build --no-cache -t workflow-widget:latest -t docker.io/library/workflow-widget:v1 -f ./apps/workflow-widget/Dockerfile .
    IMAGES_TO_LOAD+=("docker.io/library/workflow-widget:v1")
fi

if [[ "$TARGET" =~ ^(all|api|services|workflow-api)$ ]]; then
    echo -e "${GRAY}-> Building workflow-api (--no-cache)...${NC}"
    docker build --no-cache -t workflow-api:latest -t docker.io/library/workflow-api:v1 -f ./services/workflow-api/Dockerfile .
    IMAGES_TO_LOAD+=("docker.io/library/workflow-api:v1")
    DEPLOYMENTS_TO_RESTART+=("deployment/workflow-api")
fi

if [[ "$TARGET" =~ ^(all|services|notification-service)$ ]]; then
    echo -e "${GRAY}-> Building notification-service (--no-cache)...${NC}"
    docker build --no-cache -t notification-service:latest -t docker.io/library/notification-service:v1 -f ./services/notification-service/Dockerfile .
    IMAGES_TO_LOAD+=("docker.io/library/notification-service:v1")
    DEPLOYMENTS_TO_RESTART+=("deployment/notification-service")
fi

if [[ "$TARGET" =~ ^(all|services|audit-service)$ ]]; then
    echo -e "${GRAY}-> Building audit-service (--no-cache)...${NC}"
    docker build --no-cache -t audit-service:latest -t docker.io/library/audit-service:v1 -f ./services/audit-service/Dockerfile .
    IMAGES_TO_LOAD+=("docker.io/library/audit-service:v1")
    DEPLOYMENTS_TO_RESTART+=("deployment/audit-service")
fi

# 2. Cluster Image Loading (Kind / k3d / Desktop control plane)
if kind get clusters 2>/dev/null | grep -q "workflow-multi-node"; then
    echo -e "\n${YELLOW}📥 Loading images into Kind cluster 'workflow-multi-node'...${NC}"
    for img in "${IMAGES_TO_LOAD[@]}"; do
        kind load docker-image "$img" --name workflow-multi-node
    done
elif k3d cluster list 2>/dev/null | grep -q "workflow-cluster"; then
    echo -e "\n${YELLOW}📥 Importing images into k3d cluster 'workflow-cluster'...${NC}"
    k3d image import "${IMAGES_TO_LOAD[@]}" -c workflow-cluster
elif docker ps --filter "name=desktop-control-plane" -q | grep -q .; then
    echo -e "\n${YELLOW}📥 Syncing images to desktop-control-plane node...${NC}"
    docker save -o ./k8s-redeploy.tar "${IMAGES_TO_LOAD[@]}"
    docker cp ./k8s-redeploy.tar desktop-control-plane:/k8s-redeploy.tar
    docker exec desktop-control-plane ctr -n k8s.io images import /k8s-redeploy.tar
    docker exec desktop-control-plane rm /k8s-redeploy.tar
    rm -f ./k8s-redeploy.tar
fi

# 3. Rolling Restart of K8s Deployments
echo -e "\n${YELLOW}🚀 Triggering Kubernetes Rolling Restarts...${NC}"
for dep in "${DEPLOYMENTS_TO_RESTART[@]}"; do
    echo -e "${GRAY}-> Restarting ${dep}...${NC}"
    kubectl rollout restart "$dep" -n workflow-platform
done

# 4. Wait for Rollout Status
echo -e "\n${YELLOW}⏳ Waiting for Pods to be Ready...${NC}"
for dep in "${DEPLOYMENTS_TO_RESTART[@]}"; do
    kubectl rollout status "$dep" -n workflow-platform --timeout=90s
done

# 5. Direct Frontend Asset Sync
if [[ "$TARGET" =~ ^(all|ui|host-app)$ ]]; then
    echo -e "\n${YELLOW}⚡ Syncing fresh UI assets directly into host-app pods...${NC}"
    npm run build --workspace=@workflow/host-app --silent 2>/dev/null || true
    sleep 2
    for pod in $(kubectl get pods -n workflow-platform -l app=host-app -o jsonpath="{.items[*].metadata.name}"); do
        kubectl cp apps/host-app/dist/. "workflow-platform/${pod}:/usr/share/nginx/html/" 2>/dev/null || true
    done
    echo -e "${GREEN}✅ UI Assets synced.${NC}"
fi

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN} ✅ Kubernetes Redeploy Complete! All Pods Live.${NC}"
echo -e "${GREEN}======================================================${NC}"
