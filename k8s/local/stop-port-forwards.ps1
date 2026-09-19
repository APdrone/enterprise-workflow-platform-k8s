# Stop all kubectl port-forward processes
Write-Host "Stopping all active kubectl port-forward tunnels..." -ForegroundColor Cyan

$processes = Get-Process -Name "kubectl" -ErrorAction SilentlyContinue
if ($processes) {
    $processes | Stop-Process -Force
    Write-Host "All port-forward tunnels stopped successfully." -ForegroundColor Green
} else {
    Write-Host "No running kubectl port-forward processes found." -ForegroundColor Yellow
}
