<#
.SYNOPSIS
Enregistre (ou supprime) la tâche planifiée « CESIBridge Sync » pour l'utilisateur courant.
.DESCRIPTION
Déclencheurs : quotidien à StartHour avec répétition toutes les IntervalHours jusqu'à EndHour
inclus, et à l'ouverture de session (délai 2 min, le temps que Docker démarre).
Exécutée uniquement si l'utilisateur est connecté (Docker Desktop tourne en session) ; pas de droits admin.
.EXAMPLE
.\install-task.ps1 -IntervalHours 2 -StartHour 7 -EndHour 21
.\install-task.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 23)][int]$IntervalHours = 2,
    [ValidateRange(0, 23)][int]$StartHour = 7,
    [ValidateRange(0, 23)][int]$EndHour = 21,
    [switch]$Uninstall,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$taskName = 'CESIBridge Sync'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Tâche '$taskName' supprimée."
    }
    else { Write-Host "Tâche '$taskName' absente, rien à faire." }
    return
}

if ($StartHour -gt $EndHour) { throw "StartHour ($StartHour) doit être <= EndHour ($EndHour)." }

$runScript = (Resolve-Path (Join-Path $PSScriptRoot 'run-sync.ps1')).Path
$user = "$env:USERDOMAIN\$env:USERNAME"
$span = $EndHour - $StartHour

$daily = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($StartHour))
if ($span -gt 0 -and $IntervalHours -le $span) {
    # +1 min pour inclure l'exécution à EndHour pile.
    $rep = New-ScheduledTaskTrigger -Once -At ([datetime]::Today.AddHours($StartHour)) `
        -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) `
        -RepetitionDuration (New-TimeSpan -Hours $span -Minutes 1)
    $daily.Repetition = $rep.Repetition
}
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$logon.Delay = 'PT2M'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $runScript)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

if (-not $DryRun) {
    Register-ScheduledTask -TaskName $taskName -Trigger @($daily, $logon) -Action $action `
        -Settings $settings -Principal $principal -Force `
        -Description 'CESIBridge : synchronisation de l''emploi du temps' | Out-Null
}

$hours = for ($h = $StartHour; $h -le $EndHour; $h += $IntervalHours) { '{0:00}h' -f $h }
Write-Host ("Tâche '{0}' {1}." -f $taskName, $(if ($DryRun) { 'simulée (DryRun, non enregistrée)' } else { 'enregistrée' }))
Write-Host "  Utilisateur : $user (uniquement si connecté)"
Write-Host "  Horaires    : $($hours -join ', ') + ouverture de session (+2 min)"
Write-Host "  Script      : $runScript"
Write-Host "  Journal     : $(Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'data\logs\sync.log')"
Write-Host "Tester      : Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Supprimer   : .\install-task.ps1 -Uninstall"
