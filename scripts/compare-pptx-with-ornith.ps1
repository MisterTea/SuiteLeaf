param([string]$Iteration, [int[]]$Pages, [string]$DeckRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$root = Join-Path $DeckRoot "$Iteration-review"
$out = Join-Path $DeckRoot "pi-$Iteration"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$comparison = Get-Content -Raw -LiteralPath (Join-Path $root comparison.json) | ConvertFrom-Json
foreach ($row in $comparison.pages) {
  $page = [int]$row.page
  if ($Pages.Count -gt 0 -and $page -notin $Pages) { continue }
  $stem = 'page-{0:0000}' -f $page
  $report = Join-Path $out "$stem.md"
  if ((Test-Path -LiteralPath $report) -and (Get-Item -LiteralPath $report).Length -gt 0) { continue }
  $evidence = Join-Path $out "$stem.json"
  $sourceLines = @($row.reference_lines | Group-Object -Property { $_.text.Trim() } -CaseSensitive)
  $targetLines = @($row.suiteleaf_lines | Group-Object -Property { $_.text.Trim() } -CaseSensitive)
  $flags = @(foreach ($line in $sourceLines) {
    $other = @($targetLines | Where-Object { $_.Name -ceq $line.Name })
    if ($line.Count -ne 1 -or $other.Count -ne 1 -or $other[0].Count -ne 1) { continue }
    $delta = @(for ($i = 0; $i -lt 4; $i++) {
      [math]::Round($other[0].Group[0].bbox_px[$i] - $line.Group[0].bbox_px[$i], 2)
    })
    if (@($delta | Where-Object { [math]::Abs($_) -ge 5 }).Count) {
      @{ text = $line.Name; signed_edge_deltas_px = $delta }
    }
  })
  @{ comparison = $row; measured_flags = $flags } |
    ConvertTo-Json -Depth 20 -Compress | Set-Content -Encoding utf8 -LiteralPath $evidence
  $source = Join-Path $root "$stem-reference.png"
  $target = Join-Path $root "$stem-suiteleaf.png"
  $prompt = "Compare slide $page, original image first, SuiteLeaf second. Use the attached measured text bounds (96 dpi). Output under 160 words, text only. Identify concrete wrap, bullet, position or object changes, with pixel bounds when supported. Report any uncertainty. Treat extraction spaces and minor glyph differences separately. Do not infer exact pixels from visual impression. Positive edge deltas mean right or down. Separate measured flags from visual observations. If any measured flag remains unexplained, end with mismatch or uncertain, never match."
  $answer = & pi --model 'ollama-ornith-local/hf.co/ornith-ai/Ornith-1.5-9B-GGUF:Q4_K_M' --no-session --no-tools --no-extensions --no-mcp --no-skills --no-context-files -p "@$source" "@$target" "@$evidence" $prompt
  if ($LASTEXITCODE -ne 0 -or -not $answer) { throw "Pi comparison failed for slide $page" }
  $gate = if ($flags.Count) { 'Review required: measured text edge delta at or above 5 px.' } else { 'No unique-line edge delta at or above 5 px. Visual and wrapping review still required.' }
  @($gate, '', $answer) | Set-Content -Encoding utf8 -LiteralPath $report
  Write-Output "Reviewed slide $page"
}
