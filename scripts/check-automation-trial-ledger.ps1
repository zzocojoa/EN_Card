# Offline regression checks. Invoke-WebRequest is shadowed before the copied runner
# executes; no request reaches Cloudflare and all files stay in the ignored lab.
$ErrorActionPreference = 'Stop'
$taskLedgerRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskLedgerSuite = Join-Path $taskLedgerRoot ('.automation-png/ledger-tests-' + [guid]::NewGuid().ToString('N'))
function New-TrialCase([string]$Name) {
  $caseRoot = Join-Path $taskLedgerSuite $Name
  $scriptDirectory = Join-Path $caseRoot 'experiments/automation-png'
  $outputDirectory = Join-Path $caseRoot '.automation-png'
  New-Item -ItemType Directory -Path $scriptDirectory, $outputDirectory -Force | Out-Null
  $runner = Join-Path $scriptDirectory 'run-remote.ps1'
  Copy-Item -LiteralPath (Join-Path $taskLedgerRoot 'experiments/automation-png/run-remote.ps1') -Destination $runner
  ConvertTo-SecureString 'offline-synthetic-token-never-deployed' -AsPlainText -Force |
    ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $outputDirectory 'probe-token.dpapi')
  return @{ runner = $runner; output = $outputDirectory }
}
function Assert-Trial($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Read-TrialLedger($Case) {
  return @(Get-Content -LiteralPath (Join-Path $Case.output "remote-$($taskLedgerState.mode)-attempts.jsonl") | ForEach-Object { $_ | ConvertFrom-Json })
}
$taskLedgerState = @{ calls = 0; behavior = ''; case = $null; mode = 'bands' }
function Invoke-WebRequest {
  param($Method, $Uri, $Headers, $TimeoutSec, [switch]$SkipHttpErrorCheck, $OutFile, [switch]$PassThru)
  $taskLedgerState.calls++
  $before = Read-TrialLedger $taskLedgerState.case
  Assert-Trial ($before[-1].state -eq 'started') 'Network began before durable attempt record.'
  if ($taskLedgerState.behavior -eq 'timeout') { throw 'simulated secret must not appear in diagnostics' }
  if ($taskLedgerState.behavior -eq 'overlap' -and $taskLedgerState.calls -eq 1) {
    $rejected = $false
    try { & $taskLedgerState.case.runner -Mode bands | Out-Null } catch { $rejected = $true }
    Assert-Trial $rejected 'Overlapping runner was allowed.'
    Assert-Trial ($taskLedgerState.calls -eq 1) 'Overlapping runner reached network.'
  }
  if ($taskLedgerState.behavior -eq 'local_failure') { return @{ StatusCode = 200 } }
  [IO.File]::WriteAllBytes($OutFile, [byte[]](1, 2, 3, 4))
  return @{ StatusCode = 200 }
}
try {
  foreach ($behavior in @('timeout', 'local_failure', 'overlap')) {
    $taskLedgerState.case = New-TrialCase $behavior
    $taskLedgerState.behavior = $behavior
    $taskLedgerState.calls = 0
    $caught = ''
    try { & $taskLedgerState.case.runner -Mode bands | Out-Null } catch { $caught = $_.Exception.Message }
    $rows = Read-TrialLedger $taskLedgerState.case
    if ($behavior -eq 'overlap') {
      Assert-Trial ($caught -eq '') 'Successful outer run failed.'
      Assert-Trial ($taskLedgerState.calls -eq 8) 'Unexpected successful request count.'
      Assert-Trial (@($rows | Where-Object state -eq 'started').Count -eq 8) 'Successful attempts missing.'
      Assert-Trial (@($rows | Where-Object state -eq 'completed').Count -eq 8) 'Successful results missing.'
    } else {
      Assert-Trial ($caught -ne '' -and $caught -notlike '*simulated secret*') 'Failure was not sanitized.'
      Assert-Trial ($taskLedgerState.calls -eq 1) 'Failed attempt was retried.'
      Assert-Trial ($rows.Count -eq 3 -and $rows[1].state -eq 'started' -and $rows[2].state -eq 'unknown') 'Unknown attempt was not preserved.'
    }
    $callsBefore = $taskLedgerState.calls
    $rejected = $false
    try { & $taskLedgerState.case.runner -Mode bands | Out-Null } catch { $rejected = $true }
    Assert-Trial ($rejected -and $taskLedgerState.calls -eq $callsBefore) 'Rerun consumed another request.'
    Assert-Trial ((Get-Content -Raw -LiteralPath (Join-Path $taskLedgerState.case.output 'remote-bands-attempts.jsonl')) -notlike '*token*') 'Ledger exposed credential content.'
    Write-Output "PASS $behavior (durable start, bounded calls, rerun blocked)"
  }
  $taskLedgerState.case = New-TrialCase 'crash_marker'
  $taskLedgerState.calls = 0
  # Simulate abrupt termination immediately after exclusive marker creation.
  [IO.File]::WriteAllText((Join-Path $taskLedgerState.case.output 'remote-bands-attempts.jsonl'), '')
  $rejected = $false
  try { & $taskLedgerState.case.runner -Mode bands | Out-Null } catch { $rejected = $true }
  Assert-Trial ($rejected -and $taskLedgerState.calls -eq 0) 'Empty crash marker allowed a request.'
  Write-Output 'PASS crash_marker (empty marker still blocks network)'
  $taskLedgerState.case = New-TrialCase 'legacy_report'
  [IO.File]::WriteAllText((Join-Path $taskLedgerState.case.output 'remote-bands-responses.json'), '[]')
  $rejected = $false
  try { & $taskLedgerState.case.runner -Mode bands | Out-Null } catch { $rejected = $true }
  Assert-Trial ($rejected -and $taskLedgerState.calls -eq 0) 'Legacy report allowed a request.'
  Write-Output 'PASS legacy_report (existing evidence blocks network)'
  foreach ($atlasMode in @('atlas', 'atlas_chunks', 'atlas_pipeline', 'atlas_optimized', 'atlas_lean')) {
  $taskLedgerState.case = New-TrialCase ($atlasMode + '_budget')
  $taskLedgerState.calls = 0
  $taskLedgerState.behavior = 'success'
  $taskLedgerState.mode = $atlasMode
  & $taskLedgerState.case.runner -Mode $atlasMode | Out-Null
  $rows = Read-TrialLedger $taskLedgerState.case
  $starts = @($rows | Where-Object state -eq 'started')
  $expected = if ($atlasMode -in @('atlas_optimized', 'atlas_lean')) { 10 } else { 8 }
  Assert-Trial ($taskLedgerState.calls -eq $expected -and $starts.Count -eq $expected) 'Atlas budget exceeded.'
  Assert-Trial (@($starts.fixture | Select-Object -Unique).Count -eq 5) 'Atlas coverage fixture missing.'
  if ($atlasMode -in @('atlas_optimized', 'atlas_lean')) { Assert-Trial (@($starts.encoder | Select-Object -Unique).Count -eq 2) 'Resolution coverage missing.' }
  Write-Output "PASS $($atlasMode)_budget (exactly $expected attempts across 5 fixtures)"
  }
} finally {
  # Remove only the exact synthetic secret files this test created.
  foreach ($name in @('timeout', 'local_failure', 'overlap', 'crash_marker', 'legacy_report', 'atlas_budget', 'atlas_chunks_budget', 'atlas_pipeline_budget', 'atlas_optimized_budget', 'atlas_lean_budget')) {
    $synthetic = Join-Path $taskLedgerSuite "$name/.automation-png/probe-token.dpapi"
    if (Test-Path -LiteralPath $synthetic) { Remove-Item -LiteralPath $synthetic }
  }
}
