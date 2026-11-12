param([string]$Filter = '', [switch]$Live)
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../src-tauri')
try {
    $artifacts = @(& cargo test --lib --no-run --message-format=json)
    if ($LASTEXITCODE -ne 0) { throw 'Rust test build failed' }
    $testExecutable = $artifacts | ForEach-Object {
        try { $_ | ConvertFrom-Json } catch { }
    } | Where-Object { $_.reason -eq 'compiler-artifact' -and $_.profile.test -and $_.executable -and ($_.target.kind -contains 'rlib' -or $_.target.kind -contains 'lib') } | Select-Object -Last 1 -ExpandProperty executable
    if (-not $testExecutable) { throw 'Library test executable was not returned by Cargo' }
    $hostInfo = & rustc -vV
    if ($hostInfo -match 'host:.*windows-gnu') {
        # GNU Tauri links its Common Controls v6 resource only to app binaries.
        # The generated lib harness also imports TaskDialogIndirect and needs that dependency.
        if (-not ('HGhubTestManifest' -as [type])) {
            Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HGhubTestManifest {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr BeginUpdateResource(string path, bool remove);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool EndUpdateResource(IntPtr handle, bool discard);
}
'@
        }
        $manifest = '<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" /></dependentAssembly></dependency><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false" /></requestedPrivileges></security></trustInfo></assembly>'
        $data = [Text.Encoding]::UTF8.GetBytes($manifest)
        $handle = [HGhubTestManifest]::BeginUpdateResource($testExecutable, $false)
        if ($handle -eq [IntPtr]::Zero) { throw 'Cannot open generated test resources' }
        if (-not [HGhubTestManifest]::UpdateResource($handle, [IntPtr]24, [IntPtr]1, 1033, $data, $data.Length)) {
            [HGhubTestManifest]::EndUpdateResource($handle, $true) | Out-Null
            throw 'Cannot update generated test manifest'
        }
        if (-not [HGhubTestManifest]::EndUpdateResource($handle, $false)) { throw 'Cannot save generated test manifest' }
    }
    $previousPath = $env:Path
    try {
        $env:Path = (Split-Path (Split-Path $testExecutable)) + ';' + $env:Path
        $testArgs = @()
        if ($Filter) { $testArgs += $Filter }
        if ($Live) { $testArgs += '--ignored' }
        $testArgs += '--nocapture'
        & $testExecutable @testArgs
        $testExit = $LASTEXITCODE
    } finally { $env:Path = $previousPath }
    if ($testExit -ne 0) { throw "Rust tests failed (exit $testExit)" }
} finally { Pop-Location }
