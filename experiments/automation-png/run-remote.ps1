param([ValidateSet('baseline', 'bands', 'atlas', 'atlas_chunks', 'atlas_pipeline', 'atlas_optimized', 'atlas_lean')][string]$Mode = 'baseline')
$ErrorActionPreference = 'Stop'
$taskPngRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskPngOutput = Join-Path $taskPngRoot '.automation-png'
$taskPngReport = if ($Mode -eq 'baseline') { 'remote-responses.json' } else { "remote-$Mode-responses.json" }
# Preserve reports from trials that predate the durable attempt ledger.
if (Test-Path -LiteralPath (Join-Path $taskPngOutput $taskPngReport)) {
  throw '해당 시험 기록이 이미 있습니다. 횟수와 승인 범위를 확인한 뒤 별도 시험으로 진행하세요.'
}
$taskPngSecure = ConvertTo-SecureString (Get-Content -Raw -LiteralPath (Join-Path $taskPngOutput 'probe-token.dpapi')).Trim()
$taskPngPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskPngSecure)
$taskPngLedger = $null
$taskPngWriter = $null
function Write-TrialAttempt($Record) {
  $taskPngWriter.WriteLine(($Record | ConvertTo-Json -Depth 4 -Compress))
  $taskPngWriter.Flush()
  # Persist before network I/O. A started attempt without a result consumes budget.
  $taskPngLedger.Flush($true)
}
try {
  $taskPngHeaders = @{ Authorization = 'Bearer ' + [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPngPointer) }
  $taskPngRows = @()
  $taskPngEncoders = if ($Mode -eq 'baseline') { @('wasm', 'native') } elseif ($Mode -in @('atlas_optimized', 'atlas_lean')) { @("${Mode}800", "${Mode}720") } else { @($Mode) }
  $taskPngFixtures = @('expression', 'comparison', 'long', 'long_comparison')
  if ($Mode -in @('atlas', 'atlas_chunks', 'atlas_pipeline', 'atlas_optimized', 'atlas_lean')) { $taskPngFixtures += 'coverage' }
  $taskPngPlanned = if ($Mode -eq 'baseline') { 24 } elseif ($Mode -in @('atlas_optimized', 'atlas_lean')) { 10 } else { 8 }
  try {
    # CreateNew is atomic across concurrent processes. Never remove this marker on
    # error: a timeout or process crash cannot prove the server did not generate PNG.
    $taskPngLedger = [IO.FileStream]::new(
      (Join-Path $taskPngOutput "remote-$Mode-attempts.jsonl"),
      [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read,
      4096, [IO.FileOptions]::WriteThrough)
  } catch {
    throw '시험 시도 기록을 새로 만들 수 없습니다. 기존 실행·불명 시도와 승인 횟수를 확인하세요. 자동 재실행하지 않습니다.'
  }
  $taskPngWriter = [IO.StreamWriter]::new($taskPngLedger, [Text.UTF8Encoding]::new($false), 4096, $true)
  Write-TrialAttempt @{ state = 'run_started'; mode = $Mode; planned_attempts = $taskPngPlanned; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  foreach ($taskPngFixture in $taskPngFixtures) {
    $taskPngIterations = if ($Mode -eq 'baseline') { 3 } elseif ($Mode -in @('atlas_optimized', 'atlas_lean') -or ($Mode -in @('atlas', 'atlas_chunks', 'atlas_pipeline') -and $taskPngFixture -in @('comparison', 'long'))) { 1 } else { 2 }
    foreach ($taskPngEncoder in $taskPngEncoders) {
      for ($taskPngIteration = 0; $taskPngIteration -lt $taskPngIterations; $taskPngIteration++) {
        $taskPngTarget = Join-Path $taskPngOutput "remote-$taskPngFixture-$taskPngEncoder-$taskPngIteration.png"
        $taskPngStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $taskPngAttempt = @{ at = $taskPngStarted; fixture = $taskPngFixture; encoder = $taskPngEncoder; iteration = $taskPngIteration; state = 'started' }
        Write-TrialAttempt $taskPngAttempt
        try {
          $taskPngResponse = Invoke-WebRequest -Method Post -Uri "https://en-card-png-probe.kmksla4.workers.dev/probe/$taskPngFixture/$taskPngEncoder" -Headers $taskPngHeaders -TimeoutSec 30 -SkipHttpErrorCheck -OutFile $taskPngTarget -PassThru
          $taskPngRow = @{
            at = $taskPngStarted
            fixture = $taskPngFixture
            encoder = $taskPngEncoder
            iteration = $taskPngIteration
            status = $taskPngResponse.StatusCode
            bytes = (Get-Item -LiteralPath $taskPngTarget).Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskPngTarget).Hash.ToLowerInvariant()
          }
          $taskPngRows += $taskPngRow
          Write-TrialAttempt (@{ state = 'completed' } + $taskPngRow)
          $taskPngRows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskPngOutput $taskPngReport)
          $taskPngRow | ConvertTo-Json -Compress
        } catch {
          # Never persist raw exceptions, response bodies or Authorization headers.
          $taskPngAttempt.state = 'unknown'
          Write-TrialAttempt $taskPngAttempt
          throw '시험 호출 또는 결과 저장이 실패했습니다. 이번 시도는 횟수에 포함되며 자동 재시도하지 않습니다. 시도 기록을 확인하세요.'
        }
      }
    }
  }
} finally {
  try {
    try { if ($taskPngWriter) { $taskPngWriter.Dispose() } }
    finally { if ($taskPngLedger) { $taskPngLedger.Dispose() } }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPngPointer)
    $taskPngHeaders = $null
    $taskPngSecure.Dispose()
    $taskPngSecure = $null
  }
}
