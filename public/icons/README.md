# App Icons — Required Assets

Place the following PNG files in this directory before deploying:

| File | Size | Purpose |
|------|------|---------|
| `icon-192.png` | 192 × 192 px | PWA manifest icon (any + maskable) |
| `icon-512.png` | 512 × 512 px | PWA manifest icon (any + maskable) |
| `apple-touch-icon.png` | 180 × 180 px | iOS Safari Add to Home Screen |

## Design Notes

- Use a square canvas with `#FA855A` (primary/orange) background.
- Center a simple mark — e.g., a stylised "₹" or piggy bank silhouette in white.
- For `maskable` icons, keep the logo within the **safe zone**: a centered circle of diameter ≤ 80% of the canvas.
- Export as PNG with no transparency for `apple-touch-icon.png`.

## Quick Placeholder (macOS/Linux)

```bash
# Install ImageMagick, then:
magick -size 512x512 xc:#FA855A \
  -fill white -font Helvetica-Bold -pointsize 240 \
  -gravity center -annotate 0 "₹" \
  public/icons/icon-512.png

magick public/icons/icon-512.png -resize 192x192 public/icons/icon-192.png
magick public/icons/icon-512.png -resize 180x180 public/icons/apple-touch-icon.png
```

## Quick Placeholder (Windows PowerShell with .NET)

No built-in tool — use an online PNG generator or Figma to export.
