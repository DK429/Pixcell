# Pixcell

A non-destructive browser photo editor for DK. Version **0.2.1** adds exact numeric adjustment entry and individual zero resets to image inspection, straightening and local session recovery.

## Run

Requires Node.js 22 or newer. No package installation or build step is needed.

The test suite includes 17 engine/view tests and browser workflows for Chromium, Firefox and WebKit at desktop and mobile widths. Browser tests run in GitHub Actions and must pass before the live demo deploys.

```sh
npm start
```

Open http://localhost:4173. Use `npm test` for engine tests and `npm run check` for JavaScript syntax checks. Serve via localhost or HTTPS; opening `index.html` directly from disk does not support ES modules and workers consistently.

## Included

- Open JPEG, PNG and WebP; file signatures are checked before decoding.
- Exposure in linear light; contrast, highlights, shadows, whites, blacks, warmth, tint, saturation and vibrance.
- Enter exact values beside every Light, Colour and Straighten slider. Press Enter or leave the field to apply; Escape cancels a pending entry. Values stay within the slider's range and step (exposure: 0.05 EV; other adjustments: 1; straightening: 0.1°). The ↺ button resets just that adjustment to exactly zero; both entry and resets support undo/redo.
- Five adjustable looks, RGB histogram, comparison with original colours at the same composition.
- Drag crop selection with free or fixed ratios; rotate by 90° and flip.
- Straighten by up to 15° in either direction, with automatic edge trimming. Undo/reset restores the original composition; exports use the same geometry as the preview.
- Fit and 25–400% inspection with pointer/keyboard pan, scroll zoom and touch pinch. At 100%, one source pixel maps to one CSS pixel. Only the visible region is rendered from the original; the app does not enlarge a reduced preview to simulate detail.
- Toggle clipping indicators: red marks any channel at 255, blue marks all channels at zero; fully transparent pixels are ignored. The overlay is preview-only and is never exported. At zoomed scales, the histogram describes the viewed region, including the small rendering margin.
- Undo/redo with up to 80 states; originals are never overwritten.
- Save/load JSON edit recipes tied to the original image's SHA-256 fingerprint. v0.1 recipes remain compatible; v0.2 recipes also contain straightening. Keep the original separately; a recipe does not embed its pixels.
- Automatic local recovery of the last original file and edits. Reload and choose **Resume last session**. Recovery can be disabled, and **Clear saved session** removes the saved source and edits from this browser.
- Full edited resolution or smaller exports in JPEG, PNG and WebP where the browser provides that encoder. Actual output MIME type is checked; unsupported encoders produce an error instead of a wrongly labelled file.
- Alpha preserved in PNG/WebP; JPEG uses a white background.
- Responsive layout, labelled controls, keyboard undo/redo and hold-Space comparison.
- Pixel processing in a worker; the preview samples a bounded viewport from the original. Export is processed again at the requested resolution.

### Inspection shortcuts

`F`: fit; `1`: 100%; `+` / `-`: zoom; `J`: clipping; arrow keys while the image viewport is focused: pan. Hold Space to compare. Undo/redo also work when an adjustment slider is focused. Drag the image to pan; scroll or pinch to zoom. Crop mode temporarily uses the full original at Fit so selections map correctly to source coordinates.

### Recovery behaviour

The current source file and edit state are stored in IndexedDB on this device. A small synchronous draft records the latest slider state between database saves. The UI reports whether the session was saved or recovery is unavailable. Browser storage may be blocked, cleared or evicted, and private browsing may not retain it; recovery is not a substitute for keeping the original and exporting an edit recipe. Undo history is restarted when resuming. Recovery does not upload photographs or share sessions between devices. Disabling recovery clears the previously saved session.

### Browser tests

Browser tooling is optional for local development and is not loaded by the web app:

```sh
npm install --no-save --package-lock=false playwright@1.58.2
npx playwright install chromium
npm run test:browser
```

Set `BROWSER=firefox` or `BROWSER=webkit` after installing the corresponding test browser. Tests cover encoded image import/export, native pixel inspection, pointer pan, wheel zoom, clipping, crop/rotation/straightening, recipes, recovery, storage/worker failures and mobile touch controls. Screenshots and results are saved to `test-results/`.

## Repository and hosting

The source lives in [DK429/Pixcell](https://github.com/DK429/Pixcell). Clone it using your GitHub account, then run locally:

```sh
git clone https://github.com/DK429/Pixcell.git
cd Pixcell
npm start
```

GitHub Actions checks JavaScript syntax and runs the engine tests on pushes and pull requests.

### Live demo on GitHub Pages

The **Deploy Pixcell demo** workflow builds and publishes the application on pushes to `main`. Syntax, engine tests and the three browser checks must pass before publishing. Only the HTML, stylesheet and runtime JavaScript modules are included in the deployment artifact.

One-time setup: open [Settings → Pages](https://github.com/DK429/Pixcell/settings/pages), then under **Build and deployment → Source** select **GitHub Actions**. The connected coding app cannot modify this repository setting. Private repositories require GitHub Pro or another plan supporting private-repository Pages; the repository does not need to be made public on an eligible plan. The demo itself is publicly accessible and its browser assets are downloadable.

After enabling Pages, open [Actions → Deploy Pixcell demo](https://github.com/DK429/Pixcell/actions/workflows/pages.yml) and run the workflow on `main`, or re-run a deployment that failed because Pages was not enabled. Use the actual deployment URL shown in Pages settings or the completed workflow; the usual project URL is `https://dk429.github.io/Pixcell/` when no custom domain is configured.

For another static HTTPS host, run `npm run build:demo` and upload the contents of `_site/`. Relative asset paths support hosting the app under a project subdirectory.

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
| Storage | One source image in memory and one optional local recovery session. Retain the original and saved recipes for durable backups. |
| Browser support | Modern browsers with Canvas, createImageBitmap, Web Crypto and modules. PNG export is the fallback choice; WebP encoding varies by browser. |
| Advanced tools | No masks, layers, curves, retouching, AI edits, denoise, lens profiles, library/catalogue or batch processing yet. |

## Architecture

`src/engine.js` contains pixel adjustments, composition sizing, clipping, state validation and history. `src/geometry.js` samples crop/orientation/straightening for preview and export. `src/view.js` handles viewport sizing and zoom anchors. `src/recovery.js` manages the local source, edit state and lightweight draft. `src/worker.js` processes transferred pixel buffers. `src/app.js` connects import, controls, inspection and export. Everything runs on the device.

Read [ROADMAP.md](ROADMAP.md) for the stages required for a competitive editor. The current source uses platform APIs and has no third-party runtime dependencies.

Technical references: [Canvas export](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob), [LibRaw](https://www.libraw.org/about).
