#!/usr/bin/env bash
# Stop all kubectl port-forward processes
echo "Stopping all active kubectl port-forward tunnels..."

if command -v pkill >/dev/null 2>&1; then
    pkill -f "kubectl port-forward -n workflow-platform" || true
elif command -v taskkill >/dev/null 2>&1; then
    taskkill //F //IM kubectl.exe >/dev/null 2>&1 || true
else
    ps -ef | grep "kubectl port-forward -n workflow-platform" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
fi

echo "✅ All port-forward tunnels stopped."
