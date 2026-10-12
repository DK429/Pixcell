# Roadmap: from working editor to photography workstation

The goal is a competitive photography tool, delivered in independently testable stages. A universal "save in any format" promise is not accurate: camera RAW formats are acquisition data, not generic writable image containers. Edited images should export to rendered formats; edits should also be stored as a non-destructive recipe.

## 1. Foundation — delivered in v0.1

Still-image import, non-destructive global edits, crop/orientation, presets, histogram, history, sidecar recipes and browser-native rendered export. Export pixels come from the original image rather than the preview. This is a base for development, not professional editor parity.

## 2. Usability and reliability — v0.2

Before RAW work, this release adds native-pixel zoom and pan, a 100% detail view, clipping indicators, straightening with edge trimming, and optional local recovery of the source and edits. Browser workflows cover desktop and mobile layouts in Chromium, Firefox and WebKit and gate live deployment. See README for recovery limits, shortcuts and the actual test coverage.

## 3. RAW and precision

- Integrate a real RAW decoder such as LibRaw compiled to WebAssembly, or a separately deployed decoding service. Audit licensing and redistribution requirements before selecting a distribution.
- Support DNG and a defined camera-model matrix; record whether full sensor data or only an embedded preview was decoded. An embedded JPEG is not full RAW support.
- Use a linear, floating-point working buffer, actual sensor white balance, demosaic selection, black/white levels, highlight reconstruction and explicit source-to-working colour transforms.
- Preserve source metadata deliberately, with an explicit option to exclude GPS/location.
- Provide 16-bit TIFF/PNG output, ICC conversion and profiles; add HEIC/AVIF codecs only after licensing/browser suitability is established.
- Validate against licensed or user-provided camera fixtures, reference renders, EXIF rotation, colour patches, clipped highlights and corrupt files.

## 4. Professional adjustment and detail

Delivered in v0.3: luma-only, guided multi-scale sharpening with MAD noise estimation, coherence/edge/luminosity masks, coring, asymmetric gains, local overshoot limits and bounded tile filter workspace. Synthetic image-quality and browser pixel tests accompany the controls. v0.4 adds a greyscale actual-effect map, photograph toggle and staged Apply/Cancel controls; preview masks and temporary changes are excluded from exports and saved edits. v0.5 replaces the default difference map with an explicit edge selection, adds pre-detection texture smoothing, threshold/width/feather, source-anchored erase/restore brushes, one editable sharpening layer and portable .pixcell project packages. Real-camera validation and device-specific mobile performance measurement remain open.

Tone curves, HSL and colour mixer, calibrated white balance, eyedropper, split toning, deconvolution and further sharpening refinement, noise reduction, lens correction, chromatic aberration, perspective/straightening, clipping indicators and 100% inspection. Tile large images; use cancellation and memory budgets rather than assuming full images fit in RAM.

## 5. Local tools and organisation

Brushes, gradients, radial masks, subject/sky selections, mask intersections, healing/clone, layers and compositing. Multi-image filmstrip, batch presets/exports, virtual copies, ratings, collections, before/after versions, recoverable local persistence and project packages. Keep full-resolution data and edit graphs distinct.

## 6. Differentiation and production

Drone/landscape workflows, panorama and bracket/HDR merging, optional AI removal and denoise, focus stacking, export presets and watermarking. Treat remote processing as opt-in with visible consent, cost and data retention details. Add accessible touch workflows, colour/reference regression tests, cross-browser fixtures, worker recovery and crash handling.

## Release gates

No claimed format support without a real decoder/encoder and representative fixtures. No claimed RAW processing when only a preview is displayed. Validate crop/resize/rotation and output bit depth, profiles, alpha, metadata and MIME signatures. Benchmark preview responsiveness and export memory on desktop and mobile hardware. Publish a camera/browser support matrix and known limitations with each release.
