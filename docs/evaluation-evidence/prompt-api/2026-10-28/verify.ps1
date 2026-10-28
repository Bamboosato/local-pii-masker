$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$manifest = Get-Content -LiteralPath (Join-Path $root 'archive-manifest.json') -Raw | ConvertFrom-Json -Depth 100
$bytes = 0L
foreach ($file in $manifest.files) {
  $target = [IO.Path]::GetFullPath((Join-Path $root $file.path))
  if (!$target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid evidence path' }
  if ((Get-Item -LiteralPath $target).Length -ne $file.bytes) { throw "Size mismatch: $($file.path)" }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Hash mismatch: $($file.path)" }
  if ($file.transformation -eq 'none' -and $file.sourceSHA256 -ne $file.sha256) { throw 'Original evidence hash mismatch' }
  $bytes += $file.bytes
}
$measured = 0
$warmups = 0
foreach ($run in $manifest.runs) {
  $folder = Join-Path $root $run.id
  $runManifest = Get-Content -LiteralPath (Join-Path $folder 'manifest.json') -Raw | ConvertFrom-Json -Depth 100
  $rows = @(Get-Content -LiteralPath (Join-Path $folder 'rows.jsonl') | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json -Depth 100 })
  if ($runManifest.status -ne 'done' -or $rows.Count -ne $run.measuredRows -or $rows.Count -ne $runManifest.completed -or $rows.Count -ne $runManifest.plan.Count) { throw "Run count mismatch: $($run.id)" }
  $warmup = Get-Content -LiteralPath (Join-Path $folder 'warmup.json') -Raw | ConvertFrom-Json -Depth 100
  if (!$warmup.complete) { throw 'Warmup not complete' }
  $measured += $rows.Count
  $warmups++
}
if ($measured -ne 345 -or $measured -ne $manifest.measuredRows -or $warmups -ne 10 -or $warmups -ne $manifest.warmupRows) { throw 'Archive total mismatch' }
$gate = Get-Content -LiteralPath (Join-Path $root 'reference-gate.json') -Raw | ConvertFrom-Json -Depth 100
if ($gate.eligible.Count -ne 0 -or $gate.nerCombinationExecuted -or $gate.adoptionDecision -ne 'not-adopted-this-round') { throw 'Unexpected adoption decision' }
[ordered]@{verified=$true; evidenceFiles=$manifest.files.Count; measuredRows=$measured; warmupRows=$warmups; bytes=$bytes; adoption='not-adopted-this-round'} | ConvertTo-Json
