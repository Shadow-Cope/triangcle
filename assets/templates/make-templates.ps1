Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot
$cells = @{
  T = @(
    @{ face='U'; r=@(158,83,104,52) }, @{ face='R'; r=@(104,135,52,104) }, @{ face='F'; r=@(158,135,104,104) },
    @{ face='L'; r=@(264,135,52,104) }, @{ face='B'; r=@(320,135,104,104) }, @{ face='D'; r=@(158,239,104,52) }
  )
  A = @(
    @{ face='U'; r=@(62,263,50,52) }, @{ face='R'; r=@(8,317,52,106) }, @{ face='F'; r=@(62,317,50,106) },
    @{ face='L'; r=@(114,317,52,106) }, @{ face='B'; r=@(168,317,50,106) }, @{ face='D'; r=@(62,425,50,52) }
  )
  C = @(
    @{ face='U'; r=@(378,263,50,52) }, @{ face='B'; r=@(270,317,52,106) }, @{ face='R'; r=@(324,317,52,106) },
    @{ face='F'; r=@(378,317,50,106) }, @{ face='L'; r=@(430,317,52,106) }, @{ face='D'; r=@(378,425,50,52) }
  )
}

function Load-Base([string]$path) {
  $src = [System.Drawing.Image]::FromFile($path)
  $copy = New-Object System.Drawing.Bitmap $src.Width, $src.Height
  $g = [System.Drawing.Graphics]::FromImage($copy)
  $g.DrawImage($src, 0, 0, $src.Width, $src.Height)
  $g.Dispose(); $src.Dispose()
  return $copy
}

function Make-Atlas([string]$kind, [string]$mode) {
  $basePath = Join-Path $root "$kind-template.png"
  $bmp = Load-Base $basePath
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $bg = $bmp.GetPixel(5, 300)
  $bgBrush = New-Object System.Drawing.SolidBrush $bg
  $g.FillRectangle($bgBrush, 0, 72, 512, 440)
  $bgBrush.Dispose()

  $guide = ($mode -eq 'guide')
  $fillAlpha = if ($guide) { 92 } else { 26 }
  $lineAlpha = if ($guide) { 210 } else { 90 }
  $textAlpha = if ($guide) { 245 } else { 110 }
  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($fillAlpha, 118, 96, 28))
  $line = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($lineAlpha, 74, 58, 16)), 1.5
  $textCol = [System.Drawing.Color]::FromArgb($textAlpha, 58, 44, 10)
  $labelFont = New-Object System.Drawing.Font("Arial", 15, [System.Drawing.FontStyle]::Bold)
  $smallFont = New-Object System.Drawing.Font("Arial", 7.5)
  $headFont = New-Object System.Drawing.Font("Arial", 9, [System.Drawing.FontStyle]::Bold)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center

  foreach ($set in @('T','A','C')) {
    foreach ($cell in $cells[$set]) {
      $r = $cell.r
      $rect = New-Object System.Drawing.RectangleF $r[0], $r[1], $r[2], $r[3]
      $g.FillRectangle($fill, $rect)
      $g.DrawRectangle($line, $r[0], $r[1], $r[2], $r[3])
      $g.DrawString("$set$($cell.face)", $labelFont, (New-Object System.Drawing.SolidBrush $textCol), $rect, $format)
    }
  }

  # pants band: the bottom 25% of the torso (local y 2..2.5 of a 2-high torso)
  if ($kind -eq 'pants') {
    $bandAlpha = if ($guide) { 90 } else { 30 }
    $band = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($bandAlpha, 70, 52, 22))
    foreach ($face in @('F','B','R','L','D')) {
      $r = ($cells['T'] | Where-Object { $_.face -eq $face }).r
      $bandH = if ($face -eq 'D') { $r[3] } else { 26 }
      $bandY = if ($face -eq 'D') { $r[1] } else { $r[1] + $r[3] - 26 }
      $g.FillRectangle($band, $r[0], $bandY, $r[2], $bandH)
      $g.DrawLine($line, $r[0], $bandY, $r[0] + $r[2], $bandY)
    }
    $band.Dispose()
  }

  # headers
  $hcol = [System.Drawing.Color]::FromArgb($textAlpha, 62, 46, 12)
  $hbrush = New-Object System.Drawing.SolidBrush $hcol
  $g.DrawString('TORSO', $headFont, $hbrush, (New-Object System.Drawing.RectangleF 158, 68, 104, 14), $format)
  $g.DrawString('R ARM / LEG', $headFont, $hbrush, (New-Object System.Drawing.RectangleF 8, 246, 146, 14), $format)
  $g.DrawString('L ARM / LEG', $headFont, $hbrush, (New-Object System.Drawing.RectangleF 270, 246, 212, 14), $format)

  if ($guide) {
    $legend = 'U/D top+bottom    F/B front+back    R/L right+left' + $(if ($kind -eq 'pants') { '    band = pants on the bottom of the torso' } else { '' })
    $g.DrawString($legend, $smallFont, $hbrush, (New-Object System.Drawing.RectangleF 6, 490, 500, 16), $format)
  }

  $out = Join-Path $root "$kind-$mode.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $labelFont.Dispose(); $smallFont.Dispose(); $headFont.Dispose(); $fill.Dispose(); $line.Dispose(); $hbrush.Dispose(); $textColBrush = $null
  $format.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $out"
}

foreach ($kind in @('shirt','pants')) {
  Make-Atlas $kind 'template'
  Make-Atlas $kind 'guide'
  $blank = New-Object System.Drawing.Bitmap 512, 512, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($blank)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.Dispose()
  $blank.Save((Join-Path $root "$kind-transparent.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $blank.Dispose()
  Write-Host "wrote $kind-transparent.png"
}
