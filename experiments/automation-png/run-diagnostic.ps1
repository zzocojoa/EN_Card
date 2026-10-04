# Bounded, synthetic diagnostic trial: exactly 12 PNG and 72 single glyph probes.
# No retries. A started attempt without a completed row consumes the trial budget.
$ErrorActionPreference = 'Stop'
$taskDiagRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskDiagOutput = Join-Path $taskDiagRoot '.automation-png'
$taskDiagCases = @()
foreach ($fixture in @('expression', 'long', 'coverage')) {
  foreach ($size in @(800, 720)) {
    foreach ($iteration in @(0, 1)) {
      $taskDiagCases += @{ kind='png'; fixture=$fixture; size=$size; iteration=$iteration; path="/probe/$fixture/atlas_lean$size" }
    }
  }
}
$taskDiagCounts = [ordered]@{ expression=7; comparison=4; long=6; long_comparison=6; coverage=13 }
foreach ($size in @(800, 720)) {
  foreach ($fixture in $taskDiagCounts.Keys) {
    for ($index=0; $index -lt $taskDiagCounts[$fixture]; $index++) {
      $taskDiagCases += @{ kind='glyph'; fixture=$fixture; size=$size; index=$index; path="/diagnostic/glyphs/$size/$fixture/$index" }
    }
  }
}
if ($taskDiagCases.Count -ne 84) { throw 'Diagnostic budget configuration mismatch.' }
if (Test-Path -LiteralPath (Join-Path $taskDiagOutput 'remote-atlas_diagnostic-responses.json')) { throw 'Existing diagnostic results prohibit rerun.' }
$taskDiagSecure = ConvertTo-SecureString (Get-Content -Raw -LiteralPath (Join-Path $taskDiagOutput 'probe-token.dpapi')).Trim()
$taskDiagPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskDiagSecure)
$taskDiagLedger = $null
$taskDiagWriter = $null
function Write-DiagnosticAttempt($Record) {
  $taskDiagWriter.WriteLine(($Record | ConvertTo-Json -Depth 6 -Compress))
  $taskDiagWriter.Flush()
  $taskDiagLedger.Flush($true)
}
try {
  $taskDiagLedger = [IO.FileStream]::new((Join-Path $taskDiagOutput 'remote-atlas_diagnostic-attempts.jsonl'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read, 4096, [IO.FileOptions]::WriteThrough)
  $taskDiagWriter = [IO.StreamWriter]::new($taskDiagLedger, [Text.UTF8Encoding]::new($false), 4096, $true)
  Write-DiagnosticAttempt @{ state='run_started'; planned_png=12; planned_glyph=72; at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $taskDiagRows = @()
  foreach ($case in $taskDiagCases) {
    $call = [guid]::NewGuid().ToString('N')
    $record = $case + @{ call=$call; state='started'; at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    Write-DiagnosticAttempt $record
    try {
      $headers = @{ Authorization='Bearer ' + [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskDiagPointer); 'X-Lab-Call'=$call }
      $target = Join-Path $taskDiagOutput "diagnostic-$call.bin"
      $response = Invoke-WebRequest -Method Post -Uri ("https://en-card-png-probe.kmksla4.workers.dev" + $case.path) -Headers $headers -TimeoutSec 30 -SkipHttpErrorCheck -OutFile $target -PassThru
      $row = $case + @{
        call=$call; at=$record.at; status=[int]$response.StatusCode
        bytes=(Get-Item -LiteralPath $target).Length
        sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
      }
      if ($row.status -eq 200) {
        $instance = [string]($response.Headers['X-Lab-Isolate'] | Select-Object -First 1)
        $ordinalName = if ($case.kind -eq 'png') { 'X-Lab-Assembly-Ordinal' } else { 'X-Lab-Glyph-Ordinal' }
        $ordinalText = [string]($response.Headers[$ordinalName] | Select-Object -First 1)
        if ($instance -notmatch '^[a-f0-9-]{36}$' -or $ordinalText -notmatch '^[1-9][0-9]{0,8}$') { throw 'Invalid diagnostic metadata.' }
        $row.isolate = $instance
        $row.ordinal = [int]$ordinalText
      }
      Write-DiagnosticAttempt ($row + @{state='completed'})
      $taskDiagRows += $row
      $taskDiagRows | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskDiagOutput 'remote-atlas_diagnostic-responses.json')
      $row | ConvertTo-Json -Depth 6 -Compress
    } catch {
      $record.state='unknown'
      Write-DiagnosticAttempt $record
      throw 'Diagnostic attempt failed or its result could not be saved. It consumes budget; never retry automatically.'
    }
    if ($row.status -ne 200) { throw 'Diagnostic request returned a failure. Trial stopped without retry.' }
  }
} finally {
  try { try { if ($taskDiagWriter) { $taskDiagWriter.Dispose() } } finally { if ($taskDiagLedger) { $taskDiagLedger.Dispose() } } }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskDiagPointer); $headers=$null; $taskDiagSecure.Dispose() }
}
