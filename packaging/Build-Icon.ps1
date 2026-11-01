$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$output=Join-Path $PSScriptRoot '..\app\assets'
$images=@()
foreach($size in @(16,24,32,48,64,128,256)) {
  $bitmap=New-Object Drawing.Bitmap $size,$size
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform(($size/256.0),($size/256.0))
  $graphics.Clear([Drawing.Color]::Transparent)
  $shape=New-Object Drawing.Drawing2D.GraphicsPath
  $shape.AddArc(8,8,104,104,180,90); $shape.AddArc(144,8,104,104,270,90)
  $shape.AddArc(144,144,104,104,0,90); $shape.AddArc(8,144,104,104,90,90); $shape.CloseFigure()
  $background=New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.Point]::new(0,0)),([Drawing.Point]::new(256,256)),([Drawing.ColorTranslator]::FromHtml('#152d49')),([Drawing.ColorTranslator]::FromHtml('#061321'))
  $graphics.FillPath($background,$shape)
  $outline=New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#24718a')),4
  $graphics.DrawPath($outline,$shape)
  $pen=New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#55deff')),17
  $pen.StartCap='Round'; $pen.EndCap='Round'; $pen.LineJoin='Round'
  $graphics.DrawLines($pen,[Drawing.Point[]]@([Drawing.Point]::new(89,79),[Drawing.Point]::new(42,128),[Drawing.Point]::new(89,177)))
  $graphics.DrawLines($pen,[Drawing.Point[]]@([Drawing.Point]::new(167,79),[Drawing.Point]::new(214,128),[Drawing.Point]::new(167,177)))
  $graphics.DrawLine($pen,142,65,114,191)
  $spark=New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#a5f7ff'))
  $graphics.FillPolygon($spark,[Drawing.Point[]]@([Drawing.Point]::new(205,32),[Drawing.Point]::new(210,46),[Drawing.Point]::new(224,51),[Drawing.Point]::new(210,56),[Drawing.Point]::new(205,70),[Drawing.Point]::new(200,56),[Drawing.Point]::new(186,51),[Drawing.Point]::new(200,46)))
  $stream=New-Object IO.MemoryStream
  $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  $images+=,@{Size=$size;Bytes=$stream.ToArray()}
  if($size -eq 256){$bitmap.Save((Join-Path $output 'ai-builder.png'),[Drawing.Imaging.ImageFormat]::Png)}
  $stream.Dispose();$spark.Dispose();$pen.Dispose();$outline.Dispose();$background.Dispose();$shape.Dispose();$graphics.Dispose();$bitmap.Dispose()
}
$file=[IO.File]::Create((Join-Path $output 'ai-builder.ico')); $writer=New-Object IO.BinaryWriter $file
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
$offset=6+16*$images.Count
foreach($item in $images){$dimension=if($item.Size -eq 256){0}else{$item.Size};$writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$item.Bytes.Length);$writer.Write([uint32]$offset);$offset+=$item.Bytes.Length}
foreach($item in $images){$writer.Write([byte[]]$item.Bytes)}
$writer.Dispose();$file.Dispose()
