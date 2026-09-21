param(
    [string]$InputPath = (Join-Path $PSScriptRoot '../assets/icon.png')
)

Add-Type -AssemblyName System.Drawing
$resourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../android/app/src/main/res'))
$source = [System.Drawing.Image]::FromFile([System.IO.Path]::GetFullPath($InputPath))
$densities = @(
    @{ Name = 'mdpi'; Size = 48; Foreground = 108; Artwork = 72 },
    @{ Name = 'hdpi'; Size = 72; Foreground = 162; Artwork = 108 },
    @{ Name = 'xhdpi'; Size = 96; Foreground = 216; Artwork = 144 },
    @{ Name = 'xxhdpi'; Size = 144; Foreground = 324; Artwork = 216 },
    @{ Name = 'xxxhdpi'; Size = 192; Foreground = 432; Artwork = 288 }
)

function Save-Icon([string]$Path, [int]$CanvasSize, [int]$ArtworkSize) {
    $bitmap = [System.Drawing.Bitmap]::new($CanvasSize, $CanvasSize)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $scale = [Math]::Min($ArtworkSize / $source.Width, $ArtworkSize / $source.Height)
        $width = [int][Math]::Round($source.Width * $scale)
        $height = [int][Math]::Round($source.Height * $scale)
        $left = [int][Math]::Floor(($CanvasSize - $width) / 2)
        $top = [int][Math]::Floor(($CanvasSize - $height) / 2)
        $graphics.DrawImage($source, $left, $top, $width, $height)
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    foreach ($density in $densities) {
        $directory = Join-Path $resourceRoot ('mipmap-' + $density.Name)
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Save-Icon (Join-Path $directory 'ic_launcher.png') $density.Size $density.Size
        Save-Icon (Join-Path $directory 'ic_launcher_round.png') $density.Size $density.Size
        Save-Icon (Join-Path $directory 'ic_launcher_foreground.png') $density.Foreground $density.Artwork
    }
} finally {
    $source.Dispose()
}
