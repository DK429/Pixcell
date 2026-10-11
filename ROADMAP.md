# Roadmap: from working editor to photography workstation

The goal is a competitive photography tool, delivered in independently testable stages. A universal "save in any format" promise is not accurate: camera RAW formats are acquisition data, not generic writable image containers. Edited images should export to rendered formats; edits should also be stored as a non-destructive recipe.

## 1. Foundation — delivered in v0.1

Still-image import, non-destructive global edits, crop/orientation, presets, histogram, history, sidecar recipes and browser-native rendered export. Export pixels come from the original image rather than the preview. This is a base for development, not professional editor parity.

## 2. RAW and precision

- Integrate a real RAW decoder such as LibRaw compiled to WebAssembly, or a separately deployed decoding service. Audit licensing and redistribution requirements before selecting a distribution.
- Support DNG and a defined camera-model matrix; record whether full sensor data or only an embedded preview was decoded. An embedded JPEG is not full RAW support.
- Use a linear, floating-point working buffer, actual sensor white balance, demosaic selection, black/white levels, highlight reconstruction and explicit source-to-working colour transforms.
- Preserve source metadata deliberately, with an explicit option to exclude GPS/location.
- Provide 16-bit TIFF/PNG output, ICC conversion and profiles; add HEIC/AVIF codecs only after licensing/browser suitability is established.
- Validate against licensed or user-provided camera fixtures, reference renders, EXIF rotation, colour patches, clipped highlights and corrupt files.

## 3. Professional adjustment and detail

Tone curves, HSL and colour mixer, calibrated white balance, eyedropper, split toning, sharpening, noise reduction, lens correction, chromatic aberration, perspective/straightening, clipping indicators and 100% inspection. Tile large images; use cancellation and memory budgets rather than assuming full images fit in RAM.

## 4. Local tools and organisation

Brushes, gradients, radial masks, subject/sky selections, mask intersections, healing/clone, layers and compositing. Multi-image filmstrip, batch presets/exports, virtual copies, ratings, collections, before/after versions, recoverable local persistence and project packages. Keep full-resolution data and edit graphs distinct.

## 5. Differentiation and production

Drone/landscape workflows, panorama and bracket/HDR merging, optional AI removal and denoise, focus stacking, export presets and watermarking. Treat remote processing as opt-in with visible consent, cost and data retention details. Add accessible touch workflows, colour/reference regression tests, cross-browser fixtures, worker recovery and crash handling.

## Release gates

No claimed format support without a real decoder/encoder and representative fixtures. No claimed RAW processing when only a preview is displayed. Validate crop/resize/rotation and output bit depth, profiles, alpha, metadata and MIME signatures. Benchmark preview responsiveness and export memory on desktop and mobile hardware. Publish a camera/browser support matrix and known limitations with each release.
