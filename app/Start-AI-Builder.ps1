param([string]$Project, [switch]$BackendOnly)
$ErrorActionPreference = 'Stop'
$base = $PSScriptRoot
$projects = Join-Path $env:USERPROFILE 'AI-Projects'
$env:PI_CODING_AGENT_DIR = Join-Path $base 'pi-state'
$env:LOCAL_BUILDER_KEY = [IO.File]::ReadAllText((Join-Path $base 'state\model.key')).Trim()
$headers = @{Authorization=('Bearer ' + $env:LOCAL_BUILDER_KEY)}
$server = Join-Path $base 'bin\llama\llama-server.exe'
function Test-ModelReady {
    try {
        $r = Invoke-RestMethod 'http://127.0.0.1:11437/v1/models' -Headers $headers -TimeoutSec 2
        return [bool]($r.data | Where-Object id -eq 'local-coder')
    } catch { return $false }
}
if (!(Test-ModelReady)) {
    if (Get-NetTCPConnection -State Listen -LocalPort 11437 -ErrorAction SilentlyContinue) {
        throw 'The local model port is occupied by another process. No second server was started.'
    }
    Write-Host 'Starting the local model...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Path (Join-Path $base 'state\slots') -Force | Out-Null
    $arguments = @('-m', ('"' + (Join-Path $base 'models\local-coder.gguf') + '"'),
        '--host', '127.0.0.1', '--port', '11437', '-c', '16384', '-t', '4', '-tb', '8', '-np', '1',
        '--load-mode', 'mmap', '--jinja', '--alias', 'local-coder', '--reasoning', 'off', '--reasoning-budget', '0',
        '--api-key-file', ('"' + (Join-Path $base 'state\model.key') + '"'),
        '--slot-save-path', ('"' + (Join-Path $base 'state\slots') + '"'))
    $process = Start-Process -FilePath $server -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $base 'logs\model-output.log') `
        -RedirectStandardError (Join-Path $base 'logs\model.log')
    $process.Id | Set-Content -LiteralPath (Join-Path $base 'state\model.pid')
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (!(Test-ModelReady)) {
        if ($process.HasExited) { throw 'The model could not start. See AI-Builder\logs\model.log.' }
        if ($timer.Elapsed.TotalSeconds -gt 90) { throw 'The model is taking too long to start. See the model log.' }
        Start-Sleep -Seconds 1
    }
}
if ($BackendOnly) { Write-Output 'Local model ready'; return }
if (!$Project) {
    Write-Host "`nAI Builder — local and free" -ForegroundColor Cyan
    $available = @(Get-ChildItem -LiteralPath $projects -Directory | Sort-Object Name)
    for ($i=0; $i -lt $available.Count; $i++) { Write-Host ("{0}. {1}" -f ($i+1), $available[$i].Name) }
    $choice = Read-Host 'Project number or new project name (Enter for Main)'
    $number = 0
    if ([int]::TryParse($choice, [ref]$number) -and $number -ge 1 -and $number -le $available.Count) {
        $Project = $available[$number-1].Name
    } elseif ([string]::IsNullOrWhiteSpace($choice)) { $Project = 'Main' }
    else { $Project = $choice.Trim() }
}
if ($Project.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $Project -in @('.', '..')) {
    throw 'Choose a project name without path separators or special file characters.'
}
$workspace = [IO.Path]::GetFullPath((Join-Path $projects $Project))
if (!$workspace.StartsWith($projects + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid project folder.' }
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
$mutex = New-Object Threading.Mutex($false, 'Local\AIBuilderChat')
if (!$mutex.WaitOne(0)) { throw 'An AI Builder chat is already open. Close it before opening another project.' }
Push-Location -LiteralPath $workspace
try {
    Write-Host "`nProject: $Project. Type your request below. Your conversation is saved locally.`n" -ForegroundColor Green
    & (Join-Path $base 'runtime\node.exe') (Join-Path $base 'pi\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js') `
        --provider local --model local-coder --thinking off --no-extensions --no-skills --no-prompt-templates `
        --system-prompt (Join-Path $base 'BUILDER_PROMPT.md') --continue
} finally {
    Pop-Location
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
