param([Parameter(Mandatory=$true)][string]$PrinterName)
$ErrorActionPreference = 'Stop'
$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
if ($printer) { [pscustomobject]@{ present=$true; name=$printer.Name; driver=$printer.DriverName; port=$printer.PortName } | ConvertTo-Json -Compress }
else { [pscustomobject]@{ present=$false; name=$PrinterName } | ConvertTo-Json -Compress }
