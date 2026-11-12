param([string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node = (Get-Command node -ErrorAction Stop).Source
$edge = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft/Edge/Application/msedge.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found. Install Edge or open the test pages manually.' }
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('HGhubL-browser-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$output = if ($OutputPath) { [IO.Path]::GetFullPath((Join-Path $project $OutputPath)) } else { Join-Path $scratch 'results' }
New-Item -ItemType Directory -Path $output -Force | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 1420)
try { $listener.Start() } catch { throw 'Port 1420 is busy. Stop your dev server before running this script.' } finally { $listener.Stop() }
$vite = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $scratch 'vite.stdout') -RedirectStandardError (Join-Path $scratch 'vite.stderr')
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($vite.HasExited) { throw 'Vite exited before becoming ready. Check its output in the temporary test directory.' }
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:1420/tests/reference-ui.html' -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Vite did not become ready on 127.0.0.1:1420.' }
    $results = foreach ($suite in @('reference-ui', 'optimization', 'discovery', 'immersive', 'playback-retry', 'security-settings', 'html-security')) {
        $browserProfile = Join-Path $scratch $suite
        $stderr = Join-Path $output "$suite.stderr"
        $htmlFile = Join-Path $output "$suite.html"
        & $edge --headless=new --disable-gpu --no-first-run "--user-data-dir=$browserProfile" --dump-dom --virtual-time-budget=18000 "http://127.0.0.1:1420/tests/$suite.html" 2> $stderr | Set-Content -LiteralPath $htmlFile -Encoding utf8
        $dom = Get-Content -LiteralPath $htmlFile -Raw
        $match = [regex]::Match($dom, '<pre id="results"[^>]*>(.*?)</pre>', 'Singleline')
        if (-not $match.Success -or -not $match.Groups[1].Value.Trim()) { throw "No test result returned by $suite" }
        $json = [Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
        $json | Set-Content -LiteralPath (Join-Path $output "$suite.json") -Encoding utf8
        $result = $json | ConvertFrom-Json
        if ($result.failed -or ($result.passed -is [bool] -and -not $result.passed) -or $result.error) { throw "$suite failed: $($result.error)" }
        $count = if ($result.passed -is [bool]) { $result.count } else { $result.passed }
        if (-not $count) { throw "No passing checks reported by $suite" }
        Write-Host "$suite : $count passed"
        [pscustomobject]@{ suite = $suite; passed = $count; failed = 0 }
    }
    $summary = [pscustomobject]@{ passed = $true; total = ($results | Measure-Object passed -Sum).Sum; suites = @($results) }
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'summary.json') -Encoding utf8
    Write-Host "All $($summary.total) browser checks passed. Results: $output"
} finally {
    if (-not $vite.HasExited) { Stop-Process -Id $vite.Id -Force }
}
