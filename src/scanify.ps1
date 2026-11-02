param([Parameter(Mandatory = $true)][string]$Src, [Parameter(Mandatory = $true)][string]$Dst)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$code = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class ScanifyImg {
  public static void Run(string srcPath, string dstPath) {
    using (var raw = new Bitmap(srcPath)) {
      int maxEdge = 1800;
      int w0 = raw.Width, h0 = raw.Height;
      double sc = 1.0;
      int longEdge = Math.Max(w0, h0);
      if (longEdge > maxEdge) sc = (double)maxEdge / longEdge;
      int w = Math.Max(1, (int)Math.Round(w0 * sc));
      int h = Math.Max(1, (int)Math.Round(h0 * sc));
      using (var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
        using (var g = Graphics.FromImage(bmp)) {
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.PixelOffsetMode = PixelOffsetMode.HighQuality;
          g.DrawImage(raw, 0, 0, w, h);
        }
        var rect = new Rectangle(0, 0, w, h);
        var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
        int stride = data.Stride;
        byte[] buf = new byte[stride * h];
        Marshal.Copy(data.Scan0, buf, 0, buf.Length);
        int n = w * h;
        int[] gray = new int[n];
        for (int y = 0; y < h; y++) {
          int row = y * stride;
          for (int x = 0; x < w; x++) {
            int i = row + x * 3;
            int b = buf[i], gch = buf[i + 1], r = buf[i + 2];
            gray[y * w + x] = (r * 77 + gch * 150 + b * 29) >> 8;
          }
        }
        int bs = 48;
        int gw = (w + bs - 1) / bs;
        int gh = (h + bs - 1) / bs;
        int[] grid = new int[gw * gh];
        for (int gy = 0; gy < gh; gy++) {
          for (int gx = 0; gx < gw; gx++) {
            int x0 = gx * bs, y0 = gy * bs;
            int x1 = Math.Min(w, x0 + bs), y1 = Math.Min(h, y0 + bs);
            long sum = 0; int cnt = 0;
            for (int y = y0; y < y1; y += 2) {
              for (int x = x0; x < x1; x += 2) { sum += gray[y * w + x]; cnt++; }
            }
            grid[gy * gw + gx] = cnt > 0 ? (int)(sum / cnt) : 255;
          }
        }
        int[] hist = new int[256];
        int[] corr = new int[n];
        for (int y = 0; y < h; y++) {
          double fy = (y + 0.5) / bs - 0.5;
          int gy0 = (int)Math.Floor(fy); if (gy0 < 0) gy0 = 0; if (gy0 > gh - 1) gy0 = gh - 1;
          int gy1 = gy0 + 1; if (gy1 > gh - 1) gy1 = gh - 1;
          double ty = fy - gy0; if (ty < 0) ty = 0; if (ty > 1) ty = 1;
          for (int x = 0; x < w; x++) {
            double fx = (x + 0.5) / bs - 0.5;
            int gx0 = (int)Math.Floor(fx); if (gx0 < 0) gx0 = 0; if (gx0 > gw - 1) gx0 = gw - 1;
            int gx1 = gx0 + 1; if (gx1 > gw - 1) gx1 = gw - 1;
            double tx = fx - gx0; if (tx < 0) tx = 0; if (tx > 1) tx = 1;
            double bg = grid[gy0 * gw + gx0] * (1 - tx) * (1 - ty)
              + grid[gy0 * gw + gx1] * tx * (1 - ty)
              + grid[gy1 * gw + gx0] * (1 - tx) * ty
              + grid[gy1 * gw + gx1] * tx * ty;
            if (bg < 28) bg = 28;
            int v = (int)Math.Round(gray[y * w + x] * 236.0 / bg);
            if (v < 0) v = 0; if (v > 255) v = 255;
            corr[y * w + x] = v;
            hist[v]++;
          }
        }
        int loN = (int)(n * 0.02), hiN = (int)(n * 0.90);
        int lo = 0, hi = 255, seen = 0;
        for (int i = 0; i < 256; i++) { seen += hist[i]; if (seen >= loN) { lo = i; break; } }
        seen = 0;
        for (int i = 0; i < 256; i++) { seen += hist[i]; if (seen >= hiN) { hi = i; break; } }
        if (hi <= lo + 8) { lo = 0; hi = 255; }
        double span = hi - lo;
        for (int y = 0; y < h; y++) {
          int row = y * stride;
          for (int x = 0; x < w; x++) {
            double t = (corr[y * w + x] - lo) / span;
            if (t < 0) t = 0; if (t > 1) t = 1;
            int v = (int)Math.Round(t * 255.0);
            if (v >= 214) v = 255;
            else if (v <= 48) v = (int)(v * 0.72);
            buf[row + x * 3] = (byte)v;
            buf[row + x * 3 + 1] = (byte)v;
            buf[row + x * 3 + 2] = (byte)v;
          }
        }
        Marshal.Copy(buf, 0, data.Scan0, buf.Length);
        bmp.UnlockBits(data);
        var eps = new EncoderParameters(1);
        eps.Param[0] = new EncoderParameter(Encoder.Quality, 82L);
        ImageCodecInfo jpg = null;
        foreach (var c in ImageCodecInfo.GetImageEncoders()) {
          if (c.MimeType == "image/jpeg") { jpg = c; break; }
        }
        if (jpg == null) bmp.Save(dstPath, ImageFormat.Jpeg);
        else bmp.Save(dstPath, jpg, eps);
      }
    }
  }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[ScanifyImg]::Run($Src, $Dst)
