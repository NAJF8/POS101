param(
  [Parameter(Mandatory=$true)][string]$PngPath,
  [Parameter(Mandatory=$true)][string]$EscPosPath,
  [Parameter(Mandatory=$true)][int]$TargetWidthDots,
  [int]$FeedLines = 5
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::new($PngPath)
try {
  $scale = $TargetWidthDots / [double]$bmp.Width
  $height = [Math]::Max(1, [int][Math]::Round($bmp.Height * $scale))
  $scaled = [System.Drawing.Bitmap]::new($TargetWidthDots, $height)
  try {
    $g = [System.Drawing.Graphics]::FromImage($scaled)
    $g.Clear([System.Drawing.Color]::White)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($bmp, 0, 0, $TargetWidthDots, $height)
    $g.Dispose()
    $bytesPerRow = [int][Math]::Ceiling($TargetWidthDots / 8.0)
    $payload = [System.Collections.Generic.List[byte]]::new()
    $payload.AddRange([byte[]](0x1B,0x40))
    $payload.AddRange([byte[]](0x1B,0x61,0x01))
    $xL = $bytesPerRow -band 0xFF; $xH = ($bytesPerRow -shr 8) -band 0xFF
    $yL = $height -band 0xFF; $yH = ($height -shr 8) -band 0xFF
    $payload.AddRange([byte[]](0x1D,0x76,0x30,0x00,$xL,$xH,$yL,$yH))
    for ($y=0; $y -lt $height; $y++) {
      for ($xb=0; $xb -lt $bytesPerRow; $xb++) {
        [byte]$v = 0
        for ($bit=0; $bit -lt 8; $bit++) {
          $x = $xb * 8 + $bit
          if ($x -lt $TargetWidthDots) {
            $c = $scaled.GetPixel($x, $y)
            $gray = (0.299 * $c.R) + (0.587 * $c.G) + (0.114 * $c.B)
            if ($gray -lt 180) { $v = $v -bor (1 -shl (7 - $bit)) }
          }
        }
        $payload.Add($v)
      }
    }
    $payload.AddRange([byte[]](0x1B,0x64,[byte]$FeedLines))
    $payload.AddRange([byte[]](0x1D,0x56,0x00))
    [IO.File]::WriteAllBytes($EscPosPath, $payload.ToArray())
    [pscustomobject]@{ widthDots=$TargetWidthDots; heightDots=$height; bytes=$payload.Count; cut='GS V 0'; feedLines=$FeedLines } | ConvertTo-Json -Compress
  } finally { $scaled.Dispose() }
} finally { $bmp.Dispose() }
