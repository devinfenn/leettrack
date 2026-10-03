$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildDirectory = Join-Path $projectDirectory 'build'
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
function Draw-Mark($graphics, $size) {
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $scale = $size / 512.0
  $radius = 106 * $scale
  $edge = 16 * $scale
  $width = 480 * $scale
  $shape = [Drawing.Drawing2D.GraphicsPath]::new()
  $shape.AddArc($edge, $edge, 2*$radius, 2*$radius, 180, 90)
  $shape.AddArc($edge+$width-2*$radius, $edge, 2*$radius, 2*$radius, 270, 90)
  $shape.AddArc($edge+$width-2*$radius, $edge+$width-2*$radius, 2*$radius, 2*$radius, 0, 90)
  $shape.AddArc($edge, $edge+$width-2*$radius, 2*$radius, 2*$radius, 90, 90)
  $shape.CloseFigure()
  $background = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f1f5f9'))
  $graphics.FillPath($background, $shape)
  $stroke = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#536b89'), [single](35*$scale))
  $stroke.StartCap = $stroke.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($stroke,[single](278*$scale),[single](124*$scale),[single](168*$scale),[single](372*$scale))
  $graphics.DrawLine($stroke,[single](354*$scale),[single](224*$scale),[single](288*$scale),[single](372*$scale))
  $stroke.Dispose(); $background.Dispose(); $shape.Dispose()
}
$frames = @()
foreach ($size in @(16,24,32,48,64,128,256)) {
  $bitmap = [Drawing.Bitmap]::new($size,$size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([Drawing.Color]::Transparent)
  Draw-Mark $graphics $size
  $stream = [IO.MemoryStream]::new()
  $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  $frames += ,@{Size=$size;Bytes=$stream.ToArray()}
  if ($size -eq 256) {$bitmap.Save((Join-Path $buildDirectory 'app.png'),[Drawing.Imaging.ImageFormat]::Png)}
  $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$icon = [IO.File]::Create((Join-Path $buildDirectory 'app.ico'))
$writer = [IO.BinaryWriter]::new($icon)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
$offset = 6 + 16*$frames.Count
foreach ($frame in $frames) {
  $dimension = if ($frame.Size -eq 256) {0} else {$frame.Size}
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
  $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) {$writer.Write([byte[]]$frame.Bytes)}
$writer.Dispose(); $icon.Dispose()
$sidebar = [Drawing.Bitmap]::new(164,314,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
$canvas = [Drawing.Graphics]::FromImage($sidebar)
$canvas.Clear([Drawing.ColorTranslator]::FromHtml('#edf2f8'))
$canvas.TranslateTransform(22,88)
Draw-Mark $canvas 120
$canvas.ResetTransform()
$canvas.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = [Drawing.Font]::new('Segoe UI',16,[Drawing.FontStyle]::Regular)
$brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#384a65'))
$canvas.DrawString('LeetTrack',$font,$brush,30,228)
$sidebar.Save((Join-Path $buildDirectory 'installerSidebar.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
$font.Dispose();$brush.Dispose();$canvas.Dispose();$sidebar.Dispose()
Write-Output 'Application icon and installer artwork generated.'
