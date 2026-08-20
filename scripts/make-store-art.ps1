# Generates the Store logo artwork in every size Partner Center asks for.
#
# The app icon (build/appx) is drawn in code from primitives, which is fine for a 44 px
# tile but cannot render real words. Store art is large enough to show the widget as it
# actually looks, so this uses GDI+ with the real Segoe UI font.
#
# Background is transparent on purpose: the card supplies its own contrast, so the art sits
# correctly on both the light and dark Store surfaces.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-store-art.ps1

Add-Type -AssemblyName System.Drawing

$OutDir = Join-Path $PSScriptRoot "..\build\store"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$CardColor = [System.Drawing.Color]::FromArgb(255, 15, 20, 32)   # #0F1420
$TextColor = [System.Drawing.Color]::White
$SubColor  = [System.Drawing.Color]::FromArgb(200, 255, 255, 255)

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# Draws text so that its ink is centred on (cx, baselineY-ish) horizontally at left edge lx.
function Draw-Text($g, [string]$text, $font, $brush, [single]$lx, [single]$ty) {
    $fmt = [System.Drawing.StringFormat]::GenericTypographic
    $g.DrawString($text, $font, $brush, $lx, $ty, $fmt)
}

function Get-InkSize($g, [string]$text, $font) {
    $fmt = [System.Drawing.StringFormat]::GenericTypographic
    return $g.MeasureString($text, $font, [int]::MaxValue, $fmt)
}

function New-Art([int]$W, [int]$H, [string]$Name, [bool]$Full) {
    $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Card keeps the widget's landscape proportions and is centred on the canvas.
    $cardW = [single]($W * 0.90)
    $aspect = if ($Full) { 1.72 } else { 1.60 }
    $cardH = [single]($cardW / $aspect)
    if ($cardH -gt $H * 0.90) {
        $cardH = [single]($H * 0.90)
        $cardW = [single]($cardH * $aspect)
    }
    $cardX = [single](($W - $cardW) / 2)
    $cardY = [single](($H - $cardH) / 2)
    $radius = [single]($cardW * 0.075)

    $path = New-RoundedPath $cardX $cardY $cardW $cardH $radius
    $brushCard = New-Object System.Drawing.SolidBrush $CardColor
    $g.FillPath($brushCard, $path)

    $pad = [single]($cardW * 0.075)
    $lx = $cardX + $pad
    $brushText = New-Object System.Drawing.SolidBrush $TextColor
    $brushSub = New-Object System.Drawing.SolidBrush $SubColor

    if ($Full) {
        # City, big time, date: the widget as customers actually see it.
        $cityPx = [single]($cardH * 0.135)
        $timePx = [single]($cardH * 0.42)
        $datePx = [single]($cardH * 0.115)

        $fCity = New-Object System.Drawing.Font("Segoe UI", $cityPx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $fTime = New-Object System.Drawing.Font("Segoe UI", $timePx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $fDate = New-Object System.Drawing.Font("Segoe UI", $datePx, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

        $hCity = (Get-InkSize $g "Vancouver" $fCity).Height
        $hTime = (Get-InkSize $g "14:16" $fTime).Height
        $hDate = (Get-InkSize $g "Thursday, August 20, 2026" $fDate).Height
        $gap = [single]($cardH * 0.03)
        $total = $hCity + $gap + $hTime + $gap + $hDate
        $ty = $cardY + ($cardH - $total) / 2

        Draw-Text $g "Vancouver" $fCity $brushText $lx $ty
        $ty += $hCity + $gap
        Draw-Text $g "14:16" $fTime $brushText $lx $ty
        $ty += $hTime + $gap
        Draw-Text $g "Thursday, August 20, 2026" $fDate $brushSub $lx $ty

        $fCity.Dispose(); $fTime.Dispose(); $fDate.Dispose()
    }
    else {
        # Small sizes: the time alone, as large as it will go.
        $timePx = [single]($cardH * 0.52)
        $fTime = New-Object System.Drawing.Font("Segoe UI", $timePx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $sz = Get-InkSize $g "14:16" $fTime
        Draw-Text $g "14:16" $fTime $brushText ($cardX + ($cardW - $sz.Width) / 2) ($cardY + ($cardH - $sz.Height) / 2)
        $fTime.Dispose()
    }

    $out = Join-Path $OutDir $Name
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $brushCard.Dispose(); $brushText.Dispose(); $brushSub.Dispose(); $path.Dispose()
    $g.Dispose(); $bmp.Dispose()
    "wrote build/store/$Name  ($W x $H)"
}

# 9:16 poster art - the main logo on Windows 10/11, required for Xbox display
New-Art 720  1080 "PosterArt-720x1080.png"   $true
New-Art 1440 2160 "PosterArt-1440x2160.png"  $true
# 1:1 box art
New-Art 1080 1080 "BoxArt-1080x1080.png"     $true
New-Art 2160 2160 "BoxArt-2160x2160.png"     $true
# 1:1 Store display images
New-Art 300  300  "AppTileIcon-300x300.png"  $false
New-Art 150  150  "Square-150x150.png"       $false
