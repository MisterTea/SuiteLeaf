#requires -Version 5.1
<#
.SYNOPSIS
Recursively export PowerPoint files to PDFs using installed Microsoft PowerPoint.
.EXAMPLE
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\zenodo-windows-pdfs.ps1
.NOTES
Run as your normal signed-in Windows user with PowerPoint installed and activated.
Close PowerPoint before starting; do not open it during the batch. No Python modules
or administrator rights are needed. Office may still raise a blocking dialog for
damaged/password-protected files; the worker timeout bounds those failures.
Existing nonempty PDFs with a PDF header are skipped unless -Overwrite is supplied.
Hidden slides are included unless -ExcludeHiddenSlides is supplied.
Failures are logged and processing continues. Exit codes: 0 success, 1 file failures,
2 setup failure. The log is an append-only CSV under the output root.
#>
[CmdletBinding()]
param(
    [string]$InputRoot = 'Z:\Datasets\zenodo10k\files',
    [string]$OutputRoot = 'Z:\Datasets\zenodo10k\windows-ground-truth-pdf',
    [ValidateRange(10, 86400)][int]$TimeoutSeconds = 180,
    [switch]$Overwrite,
    [switch]$ExcludeHiddenSlides,
    # Internal worker protocol: paths are passed through JSON, never shell text.
    [Parameter(DontShow)][string]$WorkerJob
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Pdf([string]$Path) {
    if (-not [IO.File]::Exists($Path)) { return $false }
    $stream = [IO.File]::OpenRead($Path)
    try {
        $header = New-Object byte[] 5
        return ($stream.Length -gt 5 -and $stream.Read($header, 0, 5) -eq 5 -and
            [Text.Encoding]::ASCII.GetString($header) -eq '%PDF-')
    } finally { $stream.Dispose() }
}

function Invoke-ExportWorker([string]$JobPath) {
    $job = Get-Content -LiteralPath $JobPath -Raw | ConvertFrom-Json
    $application = $null
    $presentations = $null
    $presentation = $null
    $printRange = $null
    $code = 0
    try {
        $application = New-Object -ComObject PowerPoint.Application
        # The coordinator requires exclusive use of PowerPoint for this batch.
        $processes = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
        if ($processes.Count -ne 1) { throw 'Expected one dedicated PowerPoint process.' }
        $processes[0].Id | Set-Content -LiteralPath $job.PidFile -Encoding ASCII
        $application.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
        $application.DisplayAlerts = 1 # ppAlertsNone
        $presentations = $application.Presentations
        # ReadOnly=true, Untitled=false, WithWindow=false; originals are never saved.
        $presentation = $presentations.Open($job.Source, -1, 0, 0)
        $hidden = 0
        if ($job.IncludeHidden) { $hidden = -1 }
        # A concrete PrintRange avoids PowerShell COM binding failures for null.
        $printRange = $presentation.PrintOptions.Ranges.Add(1, $presentation.Slides.Count)
        # PDF, print quality, full slides, all slides, including hidden by default.
        # Signature: https://learn.microsoft.com/office/vba/api/powerpoint.presentation.exportasfixedformat
        $presentation.ExportAsFixedFormat(
            $job.TemporaryPdf, 2, 2, 0, 1, 1, $hidden, $printRange, 1, '',
            $true, $true, $true, $true, $false
        )
        if (-not (Test-Pdf $job.TemporaryPdf)) { throw 'PowerPoint produced no readable PDF header.' }
    } catch {
        [IO.File]::WriteAllText($job.ErrorFile, ($_.Exception.ToString() + "`n" + $_.ScriptStackTrace))
        $code = 1
    } finally {
        if ($null -ne $printRange) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($printRange)
        }
        if ($null -ne $presentation) {
            try { $presentation.Close() } catch { }
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
        }
        if ($null -ne $presentations) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentations)
        }
        if ($null -ne $application) {
            try { $application.Quit() } catch { }
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
        }
    }
    exit $code
}

if ($WorkerJob) { Invoke-ExportWorker $WorkerJob }

$lock = $null
$workDirectory = $null
$worker = $null
$exitCode = 2
try {
    $InputRoot = (Get-Item -LiteralPath $InputRoot).FullName.TrimEnd('\')
    $OutputRoot = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\')
    if (-not [IO.Directory]::Exists($InputRoot)) { throw "Input is not a directory: $InputRoot" }
    if ($OutputRoot.Equals($InputRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $OutputRoot.StartsWith($InputRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The output directory must be outside the input tree.'
    }
    [void][IO.Directory]::CreateDirectory($OutputRoot)
    # FileShare.None prevents simultaneous runs against the same output directory.
    $lock = [IO.File]::Open((Join-Path $OutputRoot '.powerpoint-pdf.lock'),
        [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if (@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count) {
        throw 'Close PowerPoint before running this script.'
    }
    if ($null -eq [Type]::GetTypeFromProgID('PowerPoint.Application')) {
        throw 'Microsoft PowerPoint is not installed or its COM registration is missing.'
    }
    $extensions = @('.pptx', '.ppt', '.pptm', '.ppsx', '.pps', '.ppsm', '.potx', '.pot', '.potm')
    $files = @(Get-ChildItem -LiteralPath $InputRoot -Recurse -File -Force |
        Where-Object { $_.Extension.ToLowerInvariant() -in $extensions -and -not $_.Name.StartsWith('~$') } |
        Sort-Object FullName)
    $workDirectory = Join-Path ([IO.Path]::GetTempPath()) ('powerpoint-pdf-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($workDirectory)
    $jobPath = Join-Path $workDirectory 'job.json'
    $pidFile = Join-Path $workDirectory 'powerpoint.pid'
    $errorFile = Join-Path $workDirectory 'error.txt'
    $logPath = Join-Path $OutputRoot 'conversion-log.csv'
    $shellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $converted = 0
    $skipped = 0
    $failed = 0
    # Same-stem files with different PowerPoint extensions cannot share a PDF path.
    $destinations = @{}
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($InputRoot.Length + 1)
        $key = [IO.Path]::ChangeExtension($relative, '.pdf')
        if (-not $destinations.ContainsKey($key)) { $destinations[$key] = 0 }
        $destinations[$key]++
    }
    Write-Host "Found $($files.Count) PowerPoint files. Output: $OutputRoot"
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($InputRoot.Length + 1)
        $pdfRelative = [IO.Path]::ChangeExtension($relative, '.pdf')
        $destination = Join-Path $OutputRoot $pdfRelative
        $temporaryPdf = Join-Path ([IO.Path]::GetDirectoryName($destination)) (
            '.powerpoint-' + [guid]::NewGuid().ToString('N') + '.pdf')
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $status = 'failed'
        $message = ''
        try {
            if ($destinations[$pdfRelative] -gt 1) { throw 'Multiple inputs map to this PDF path; rename inputs to resolve the collision.' }
            if (-not $Overwrite -and (Test-Pdf $destination)) {
                $status = 'skipped'
                $skipped++
            } else {
                if (@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count) {
                    throw 'PowerPoint is already running; batch requires exclusive use.'
                }
                [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
                foreach ($path in @($pidFile, $errorFile)) {
                    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
                }
                @{
                    Source = $file.FullName; TemporaryPdf = $temporaryPdf
                    PidFile = $pidFile; ErrorFile = $errorFile
                    IncludeHidden = -not $ExcludeHiddenSlides.IsPresent
                } | ConvertTo-Json | Set-Content -LiteralPath $jobPath -Encoding UTF8
                $arguments = '-NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File "{0}" -WorkerJob "{1}"' -f $PSCommandPath, $jobPath
                $worker = Start-Process -FilePath $shellPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
                if (-not $worker.WaitForExit($TimeoutSeconds * 1000)) {
                    throw "Timed out after $TimeoutSeconds seconds (possibly a blocked Office dialog)."
                }
                if ($worker.ExitCode -ne 0) {
                    if (Test-Path -LiteralPath $errorFile) { throw (Get-Content -LiteralPath $errorFile -Raw) }
                    throw "Export worker exited with code $($worker.ExitCode)."
                }
                if (-not (Test-Pdf $temporaryPdf)) { throw 'Export did not produce a PDF.' }
                Move-Item -LiteralPath $temporaryPdf -Destination $destination -Force
                $status = 'converted'
                $converted++
            }
        } catch {
            $failed++
            $message = $_.Exception.Message
        } finally {
            if ($null -ne $worker) {
                if (-not $worker.HasExited) { $worker.Kill(); $worker.WaitForExit() }
                $worker.Dispose()
                $worker = $null
                # Only terminate the PowerPoint PID recorded by this worker.
                if (Test-Path -LiteralPath $pidFile) {
                    $officeProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
                    $office = Get-Process -Id $officeProcessId -ErrorAction SilentlyContinue
                    if ($null -ne $office -and $office.ProcessName -eq 'POWERPNT') {
                        Stop-Process -InputObject $office -Force -ErrorAction SilentlyContinue
                        [void]$office.WaitForExit(10000)
                    }
                }
            }
            if (Test-Path -LiteralPath $temporaryPdf) { Remove-Item -LiteralPath $temporaryPdf -Force }
        }
        [pscustomobject]@{
            Timestamp = [DateTime]::UtcNow.ToString('o'); Source = $file.FullName
            Pdf = $destination; Status = $status
            Seconds = [Math]::Round($timer.Elapsed.TotalSeconds, 2); Error = $message
        } | Export-Csv -LiteralPath $logPath -NoTypeInformation -Append -Encoding UTF8
        Write-Host "[$($converted + $skipped + $failed)/$($files.Count)] $status : $relative"
        if ($message) { Write-Host "  $message" }
    }
    Write-Host "Converted: $converted; skipped: $skipped; failed: $failed. Log: $logPath"
    $exitCode = 0
    if ($failed -gt 0) { $exitCode = 1 }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
} finally {
    if ($null -ne $worker -and -not $worker.HasExited) { $worker.Kill() }
    if ($null -ne $lock) { $lock.Dispose() }
    if ($workDirectory) {
        # Delete only the uniquely named local work directory created by this run.
        $resolvedWork = [IO.Path]::GetFullPath($workDirectory)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($resolvedWork.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($resolvedWork) -match '^powerpoint-pdf-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $resolvedWork -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
exit $exitCode
