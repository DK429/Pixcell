# Pixcell

A private, non-destructive browser photo editor for DK. Version **0.1.0** is a working foundation for a larger photography app; it does not yet match a professional RAW editor.

## Run

Requires Node.js 22 or newer. No package installation or build step is needed.

Validation completed: all nine engine tests, JavaScript syntax checks, and static UI/asset integrity checks pass. Interactive browser verification is pending because the build environment did not provide an installed browser executable. Treat this as an initial development release until desktop and mobile workflows are verified.

```sh
npm start
```

Open http://localhost:4173. Use `npm test` for engine tests and `npm run check` for JavaScript syntax checks. Serve via localhost or HTTPS; opening `index.html` directly from disk does not support ES modules and workers consistently.

## Included

- Open JPEG, PNG and WebP; file signatures are checked before decoding.
- Exposure in linear light; contrast, highlights, shadows, whites, blacks, warmth, tint, saturation and vibrance.
- Five adjustable looks, RGB histogram, comparison with original colours at the same composition.
- Drag crop selection with free or fixed ratios; rotate by 90° and flip.
- Undo/redo with up to 80 states; originals are never overwritten.
- Save/load JSON edit recipes tied to the original image's SHA-256 fingerprint. Keep the original separately; a recipe does not embed its pixels.
- Full edited resolution or smaller exports in JPEG, PNG and WebP where the browser provides that encoder. Actual output MIME type is checked; unsupported encoders produce an error instead of a wrongly labelled file.
- Alpha preserved in PNG/WebP; JPEG uses a white background.
- Responsive layout, labelled controls, keyboard undo/redo and hold-Space comparison.
- Pixel processing in a worker; preview is capped at 1,600 pixels on its longest edge. Export is processed again from the full decoded original.

## Repository and hosting

The source lives in [DK429/Pixcell](https://github.com/DK429/Pixcell). Clone it using your GitHub account, then run locally:

```sh
git clone https://github.com/DK429/Pixcell.git
cd Pixcell
npm start
```

GitHub Actions checks JavaScript syntax and runs the engine tests on pushes and pull requests.

For optional GitHub Pages hosting, in the repository's **Settings → Pages**, choose **Deploy from a branch**, `main`, and `/ (root)`. The app is static and uses relative asset paths. Repository visibility and account plan determine Pages availability. Any static HTTPS host can also serve these files. Hosting has not been enabled by this source commit.

Do not publish private photographs as repository files. The app opens files chosen from a visitor's own device. This source has no analytics, remote fonts or image upload API.

## Limits in this release

| Area | Current behaviour |
| --- | --- |
| Input formats | JPEG, PNG, WebP. DNG/RAW, TIFF, HEIC, AVIF, PSD and SVG are explicitly unsupported. |
| Size | Up to 50 MiB, 40 megapixels, and 16,384 pixels per edge. Practical limits depend on available browser memory. |
| Editing | 8-bit browser-decoded SDR pixels. Highlight/shadow controls reshape existing tones; they cannot recover clipped source data. Warmth is a creative adjustment, not calibrated Kelvin white balance. |
| Colour | Browser colour conversion; no controlled ICC, wide-gamut, HDR, 16-bit or print-proofing pipeline. |
| Metadata | Exports do not preserve source EXIF/IPTC/XMP or embedded source ICC profiles. Browser JPEG orientation is applied on decode. |
| Multi-frame files | Animated PNG/WebP decode to a single still frame; no animation editing or export. |
| Storage | One source image in memory. Save the recipe and original manually before closing. |
| Browser support | Modern browsers with Canvas, createImageBitmap, Web Crypto and modules. PNG export is the fallback choice; WebP encoding varies by browser. |
| Advanced tools | No masks, layers, curves, retouching, AI edits, denoise, lens profiles, library/catalogue or batch processing yet. |

## Architecture

`src/engine.js` contains shared, testable pixel adjustments, crop sizing, state validation and history. `src/worker.js` processes transferred pixel buffers. `src/app.js` owns file import, Canvas geometry, crop interaction and export. `index.html` and `styles.css` provide the UI. Everything runs on the device.

Read [ROADMAP.md](ROADMAP.md) for the stages required for a competitive editor. The current source uses platform APIs and has no third-party runtime dependencies.

Technical references: [Canvas export](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob), [LibRaw](https://www.libraw.org/about).
