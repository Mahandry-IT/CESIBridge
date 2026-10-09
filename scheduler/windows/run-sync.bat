@echo off
rem Wrapper de run-sync.ps1 (double-clic ou planificateur). Propage le code de sortie.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-sync.ps1"
exit /b %ERRORLEVEL%
