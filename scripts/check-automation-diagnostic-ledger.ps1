# Offline: shadows the sole network command before running copies of the real script.
$ErrorActionPreference = 'Stop'
$taskDiagSuite = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path ('.automation-png/diagnostic-ledger-' + [guid]::NewGuid().ToString('N'))
$taskDiagTest = @{ calls=0; behavior=''; runner=''; output='' }
function Assert-Diagnostic($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Invoke-WebRequest {
  param($Method,$Uri,$Headers,$TimeoutSec,[switch]$SkipHttpErrorCheck,$OutFile,[switch]$PassThru)
  $taskDiagTest.calls++
  $rows = @(Get-Content -LiteralPath (Join-Path $taskDiagTest.output 'remote-atlas_diagnostic-attempts.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
  Assert-Diagnostic ($rows[-1].state -eq 'started') 'Request before durable start.'
  Assert-Diagnostic ($Headers['X-Lab-Call'] -eq $rows[-1].call) 'Correlation identifier mismatch.'
  if ($taskDiagTest.behavior -eq 'timeout') { throw 'secret sentinel never print' }
  if ($taskDiagTest.behavior -eq 'overlap' -and $taskDiagTest.calls -eq 1) {
    $blocked=$false; try { & $taskDiagTest.runner | Out-Null } catch { $blocked=$true }
    Assert-Diagnostic ($blocked -and $taskDiagTest.calls -eq 1) 'Overlap reached network.'
  }
  if ($taskDiagTest.behavior -ne 'file_failure') { [IO.File]::WriteAllBytes($OutFile,[byte[]](1,2,3)) }
  $status = if ($taskDiagTest.behavior -eq 'http_failure') { 502 } else { 200 }
  $id = if ($taskDiagTest.behavior -eq 'bad_metadata') { 'bad' } else { '11111111-2222-3333-4444-555555555555' }
  return @{StatusCode=$status;Headers=@{'X-Lab-Isolate'=@($id);'X-Lab-Assembly-Ordinal'=@('1');'X-Lab-Glyph-Ordinal'=@('1')}}
}
foreach ($behavior in @('timeout','file_failure','http_failure','bad_metadata','overlap','success','crash_marker')) {
  $caseRoot=Join-Path $taskDiagSuite $behavior
  $directory=Join-Path $caseRoot 'experiments/automation-png'
  $taskDiagTest.output=Join-Path $caseRoot '.automation-png'
  New-Item -ItemType Directory -Path $directory,$taskDiagTest.output -Force | Out-Null
  $taskDiagTest.runner=Join-Path $directory 'run-diagnostic.ps1'
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../experiments/automation-png/run-diagnostic.ps1') -Destination $taskDiagTest.runner
  $secret=Join-Path $taskDiagTest.output 'probe-token.dpapi'
  ConvertTo-SecureString 'offline-synthetic-token-never-deployed' -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $secret
  try {
    $taskDiagTest.calls=0; $taskDiagTest.behavior=$behavior
    $ledger=Join-Path $taskDiagTest.output 'remote-atlas_diagnostic-attempts.jsonl'
    if ($behavior -eq 'crash_marker') { [IO.File]::WriteAllText($ledger,'') }
    $errorText=''; try { & $taskDiagTest.runner | Out-Null } catch { $errorText=$_.Exception.Message }
    $rows=@(Get-Content -LiteralPath $ledger | ForEach-Object { $_ | ConvertFrom-Json })
    if ($behavior -in @('success','overlap')) {
      Assert-Diagnostic ($errorText -eq '' -and $taskDiagTest.calls -eq 84) 'Wrong successful request budget.'
      $starts=@($rows | Where-Object state -eq 'started')
      Assert-Diagnostic (@($starts | Where-Object kind -eq 'png').Count -eq 12 -and @($starts | Where-Object kind -eq 'glyph').Count -eq 72) 'Wrong per-kind budget.'
      Assert-Diagnostic (@($starts.call | Select-Object -Unique).Count -eq 84) 'Duplicate call IDs.'
    } else {
      $expectedCalls=if($behavior -eq 'crash_marker'){0}else{1}
      Assert-Diagnostic ($errorText -ne '' -and $taskDiagTest.calls -eq $expectedCalls) 'Failure was retried.'
      Assert-Diagnostic ($errorText -notlike '*sentinel*') 'Unsanitized failure.'
    }
    $before=$taskDiagTest.calls; $blocked=$false; try { & $taskDiagTest.runner | Out-Null } catch { $blocked=$true }
    Assert-Diagnostic ($blocked -and $taskDiagTest.calls -eq $before) 'Rerun reached network.'
    Write-Output "PASS diagnostic ledger $behavior"
  } finally { if (Test-Path -LiteralPath $secret) { Remove-Item -LiteralPath $secret } }
}
