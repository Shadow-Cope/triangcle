Add-Type -AssemblyName System.Drawing

# Rebuilds pants-guide.png in the original Triancle style:
#   - the blank branded pants template is used as the base (tan art + logo + title)
#   - the labelled guide adds the two-tone tan cells, single letters and the footer legend
# The shirt template is the newer high-res art supplied as shirt-template.png; it already has
# the cells drawn, so this script leaves it (and shirt-guide.png) alone.
# The cell rectangles come from CLOTH_CELLS (js/game/character.js). The torso cells were
# wrong in the first guide (the top face was 86 x 54 and offset); they are now 104 x 52 and
# line up with the front, which is what the rig actually is (2 wide x 2 tall x 1 deep).
#
# Run:  powershell -ExecutionPolicy Bypass -File assets\templates\make-templates.ps1

$root = $PSScriptRoot
$S = 1   # canvas is 512 x 512; CLOTH_CELLS are already in 512px space

# CLOTH_CELLS (keep in step with js/game/character.js)
$cells = @{
  T = @(
    @{ face='U'; r=@(156,83,104,52) },
    @{ face='R'; r=@(104,135,52,104) },
    @{ face='F'; r=@(156,135,104,104) },
    @{ face='L'; r=@(260,135,52,104) },
    @{ face='B'; r=@(312,135,104,104) },
    @{ face='D'; r=@(156,239,104,52) }
  )
  A = @(
    @{ face='U'; r=@(62,263,50,52) },
    @{ face='R'; r=@(8,317,52,106) },
    @{ face='F'; r=@(62,317,50,106) },
    @{ face='L'; r=@(114,317,52,106) },
    @{ face='B'; r=@(168,317,50,106) },
    @{ face='D'; r=@(62,425,50,52) }
  )
  C = @(
    @{ face='U'; r=@(378,263,50,52) },
    @{ face='B'; r=@(270,317,52,106) },
    @{ face='R'; r=@(324,317,52,106) },
    @{ face='F'; r=@(378,317,50,106) },
    @{ face='L'; r=@(430,317,52,106) },
    @{ face='D'; r=@(378,425,50,52) }
  )
}

# Original two-tone cell colours and the quadrant pattern each face had.
$DARK  = [System.Drawing.Color]::FromArgb(255, 148, 104, 9)    # #946809
$LIGHT = [System.Drawing.Color]::FromArgb(255, 203, 143, 12)   # #CB8F0C
$INK   = [System.Drawing.Color]::FromArgb(255, 0, 0, 0)
$NOTE  = [System.Drawing.Color]::FromArgb(255, 74, 55, 8)
$pat = @{
  U = 'DLLD'   # TL TR BL BR
  R = 'DDLL'
  F = 'DLLD'
  L = 'LLDD'
  B = 'LDDL'
  D = 'LDLD'
}
# The limb cells use the same per-letter pattern as the torso.

function Paint-Cell($g, [int]$x, [int]$y, [int]$w, [int]$h, [string]$face, [string]$pattern, $darkBrush, $lightBrush, $inkBrush, $font) {
  $mx = [int][Math]::Floor($x + $w / 2.0)
  $my = [int][Math]::Floor($y + $h / 2.0)
  $quads = @(
    @{ x=$x;  y=$y;  w=($mx - $x);          h=($my - $y) },
    @{ x=$mx; y=$y;  w=($x + $w - $mx);     h=($my - $y) },
    @{ x=$x;  y=$my; w=($mx - $x);          h=($y + $h - $my) },
    @{ x=$mx; y=$my; w=($x + $w - $mx);     h=($y + $h - $my) }
  )
  for ($i = 0; $i -lt 4; $i++) {
    $q = $quads[$i]
    if ($q.w -le 0 -or $q.h -le 0) { continue }
    $b = if ($pattern[$i] -eq 'D') { $darkBrush } else { $lightBrush }
    $g.FillRectangle($b, $q.x, $q.y, $q.w, $q.h)
  }
  $fmt = [System.Drawing.StringFormat]::new()
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$w, [float]$h)
  $g.DrawString($face, $font, $inkBrush, $rect, $fmt)
  $fmt.Dispose()
}

function Make-Guide([string]$kind) {
  $srcPath = Join-Path $root "$kind-template.png"
  $bmp = [System.Drawing.Bitmap]::new($srcPath)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $darkBrush  = [System.Drawing.SolidBrush]::new($DARK)
  $lightBrush = [System.Drawing.SolidBrush]::new($LIGHT)
  $inkBrush   = [System.Drawing.SolidBrush]::new($INK)
  $font       = [System.Drawing.Font]::new('Segoe UI', [float]34, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

  # erase the old torso cells first, so the corrected cells never sit on top of leftovers
  $bgBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 209, 135))
  $old = @(
    @(165, 77, 92, 60), @(100, 133, 60, 112), @(156, 133, 110, 112),
    @(262, 133, 60, 112), @(318, 133, 110, 112), @(156, 241, 110, 60)
  )
  foreach ($r in $old) { $g.FillRectangle($bgBrush, $r[0], $r[1], $r[2], $r[3]) }

  foreach ($set in @('T','A','C')) {
    foreach ($cell in $cells[$set]) {
      $r = $cell.r
      Paint-Cell $g $r[0] $r[1] $r[2] $r[3] $cell.face $pat[$cell.face] $darkBrush $lightBrush $inkBrush $font
    }
  }

  # group labels + footer, same placement as the original guide
  $noteFont = [System.Drawing.Font]::new('Segoe UI', [float]11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $noteBrush = [System.Drawing.SolidBrush]::new($NOTE)
  $g.DrawString('R ARM / LEG', $noteFont, $noteBrush, 42, 244)
  $g.DrawString('L ARM / LEG', $noteFont, $noteBrush, 348, 244)

  $footFont = [System.Drawing.Font]::new('Segoe UI', [float]11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $footFmt = [System.Drawing.StringFormat]::new()
  $footFmt.Alignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('U/D top+bottom      F/B front+back      R/L right+left', $footFont, $noteBrush, [System.Drawing.RectangleF]::new(0, 496, 512, 14), $footFmt)
  $footFmt.Dispose()

  $g.Dispose()
  $bmp.Save((Join-Path $root "$kind-guide.png"), [System.Drawing.Imaging.ImageFormat]::Png)

  $bgBrush.Dispose(); $darkBrush.Dispose(); $lightBrush.Dispose(); $inkBrush.Dispose()
  $noteBrush.Dispose(); $font.Dispose(); $noteFont.Dispose(); $footFont.Dispose(); $bmp.Dispose()
  Write-Host "wrote $kind-guide.png"
}

Make-Guide 'pants'
