# Reduce las fotos de estadios que baja actualizar-calendario.js.
#
#   powershell -File herramientas\aligerar-fotos.ps1
#
# ESPN las entrega en 2000 px (unos 44 MB entre todas). A 900 px de ancho y
# calidad 68 quedan en 3.5 MB, que es lo que de verdad se ocupa en pantalla.
# Correr despues de cada actualizacion del calendario que baje fotos nuevas.

Add-Type -AssemblyName System.Drawing

$origen = Join-Path $PSScriptRoot '..\publico\img\estadios'
if (-not (Test-Path $origen)) { Write-Output 'No hay fotos que aligerar.'; exit }

$antes = (Get-ChildItem $origen -Filter *.jpg | Measure-Object -Property Length -Sum).Sum
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, 68L)

foreach ($f in Get-ChildItem $origen -Filter *.jpg) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  if ($img.Width -le 900) { $img.Dispose(); continue }
  $w = 900
  $h = [int]($img.Height * ($w / $img.Width))
  $nuevo = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($nuevo)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose(); $img.Dispose()
  $tmp = $f.FullName + '.tmp'
  $nuevo.Save($tmp, $codec, $params)
  $nuevo.Dispose()
  Move-Item -Force $tmp $f.FullName
}

$despues = (Get-ChildItem $origen -Filter *.jpg | Measure-Object -Property Length -Sum).Sum
Write-Output ('Fotos de estadios: {0:N1} MB -> {1:N1} MB' -f ($antes / 1MB), ($despues / 1MB))
