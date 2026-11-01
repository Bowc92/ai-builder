param([switch]$NoBrowser, [switch]$InterfaceOnly)
$ErrorActionPreference = 'Stop'
$base = $PSScriptRoot
try {
    New-Item -ItemType Directory -Path (Join-Path $base 'state'),(Join-Path $base 'logs'),(Join-Path $base 'pi-state'),(Join-Path $base 'models') -Force | Out-Null
    if (!(Test-Path (Join-Path $base 'pi-state\models.json'))) { Copy-Item (Join-Path $base 'models.template.json') (Join-Path $base 'pi-state\models.json') }
    if (!(Test-Path (Join-Path $base 'pi-state\settings.json'))) {
        $settings = @{defaultProvider='local';defaultModel='local-coder';defaultThinkingLevel='off';defaultTools=@('read','edit','write','bash');compaction=@{enabled=$true;reserveTokens=2048;keepRecentTokens=6000}}
        $bash = @('C:\Program Files\Git\bin\bash.exe','C:\Program Files (x86)\Git\bin\bash.exe') | Where-Object {Test-Path $_} | Select-Object -First 1
        if ($bash) { $settings.shellPath=$bash }
        $settings | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $base 'pi-state\settings.json') -Encoding UTF8
    }
    if (!(Test-Path (Join-Path $base 'state\model.key'))) {
        $bytes=New-Object byte[] 32; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
        [IO.File]::WriteAllText((Join-Path $base 'state\model.key'),[Convert]::ToBase64String($bytes))
    }
    if (!$InterfaceOnly) {
        if (!(Test-Path (Join-Path $base 'models\local-coder.gguf'))) {
            Add-Type -AssemblyName System.Windows.Forms
            [Windows.Forms.MessageBox]::Show('Select your Qwen3.5 4B GGUF model. Model weights are a separate download; see README. Your selected file will be copied into AI Builder.','AI Builder model setup') | Out-Null
            $dialog=New-Object Windows.Forms.OpenFileDialog; $dialog.Filter='GGUF model (*.gguf)|*.gguf'
            if($dialog.ShowDialog() -ne 'OK'){return}
            Copy-Item -LiteralPath $dialog.FileName -Destination (Join-Path $base 'models\local-coder.gguf')
        }
        & (Join-Path $base 'Start-AI-Builder.ps1') -BackendOnly
    }
    $ready=$false
    try { $s=Invoke-RestMethod 'http://127.0.0.1:4180/api/state' -TimeoutSec 2; $ready=($s.agent -eq 'Pi') } catch {}
    if (!$ready) {
        if(Get-NetTCPConnection -LocalPort 4180 -State Listen -ErrorAction SilentlyContinue){throw 'Port 4180 is occupied by another app.'}
        $node=Join-Path $base 'runtime\node.exe'
        if(!(Test-Path $node)){$node='C:\Program Files\nodejs\node.exe'}
        $p=Start-Process $node -ArgumentList ('"'+(Join-Path $base 'ui\server.cjs')+'"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $base 'logs\interface.log') -RedirectStandardError (Join-Path $base 'logs\interface-error.log')
        $p.Id | Set-Content (Join-Path $base 'state\interface.pid')
        for($i=0;$i -lt 30;$i++) { try { $s=Invoke-RestMethod 'http://127.0.0.1:4180/api/state' -TimeoutSec 2; if($s.agent -eq 'Pi'){$ready=$true;break} }catch{}; Start-Sleep -Seconds 1 }
        if(!$ready){throw 'Interface failed to start. See logs\interface-error.log.'}
    }
    if(!$NoBrowser) {
        $browser=@("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Google\Chrome\Application\chrome.exe") | Where-Object {Test-Path $_} | Select-Object -First 1
        if($browser){Start-Process $browser -ArgumentList '--app=http://127.0.0.1:4180/','--window-size=1250,850'}else{Start-Process 'http://127.0.0.1:4180/'}
    }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message,'AI Builder could not start') | Out-Null
    exit 1
}
