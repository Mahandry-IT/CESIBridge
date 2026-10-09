# Lance scripts/sync.js en tâche planifiée (Windows PowerShell 5.1+).
# Journal : data\logs\sync.log (rotation à ~1 Mo). Une seule exécution à la fois (mutex nommé).
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $root 'data\logs'
$log = Join-Path $logDir 'sync.log'
$maxBytes = 1MB

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $log -Value $line -Encoding UTF8
}

# Rotation simple : sync.log -> sync.log.1 (l'ancien est écrasé).
if ((Test-Path $log) -and ((Get-Item $log).Length -gt $maxBytes)) {
    Move-Item -Path $log -Destination "$log.1" -Force
}

$node = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node -or -not $node.Source) {
    Write-Log 'ERREUR node introuvable dans le PATH'
    Write-Error 'node introuvable dans le PATH'
    exit 127
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\CESIBridgeSync')
$acquired = $false
$code = 1
try {
    try { $acquired = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $acquired = $true }

    if (-not $acquired) {
        Write-Log 'SKIP une execution est deja en cours'
        $code = 0
    }
    else {
        $outFile = [System.IO.Path]::GetTempFileName()
        $errFile = [System.IO.Path]::GetTempFileName()
        try {
            Write-Log "DEBUT sync (node $($node.Source))"
            $env:CESI_HEADLESS = 'true'
            $proc = Start-Process -FilePath $node.Source `
                -ArgumentList @('--env-file-if-exists=.env', 'scripts/sync.js') `
                -WorkingDirectory $root -NoNewWindow -Wait -PassThru `
                -RedirectStandardOutput $outFile -RedirectStandardError $errFile
            $code = $proc.ExitCode
            foreach ($f in @($outFile, $errFile)) {
                foreach ($l in (Get-Content -Path $f -Encoding UTF8)) { Write-Log "  $l" }
            }
            Write-Log "FIN sync (code $code)"
        }
        finally {
            Remove-Item -Path $outFile, $errFile -Force -ErrorAction SilentlyContinue
        }
    }
}
finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
exit $code
