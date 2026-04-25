# webvideosonifyer
Web-based Video Sonification

This is a small, dependency-free web app that turns **webcam motion** into **sound**.

Pipeline:

- Webcam frames
- Frame-to-frame difference (per pixel)
- **Motiongram** by averaging the difference across **columns** for each **row** (one motion value per y-row)
- Map that 1D motion vector to an audio magnitude spectrum
- **iFFT** (inverse FFT) + windowing + overlap-add to produce continuous audio

## Run

Because camera permissions require a secure context, run a local server.

If you have Python:

```bash
python3 -m http.server 5173
```

Then open:

- `http://localhost:5173/`

## Controls (UI)

- **Start camera / Stop**: begins/stops webcam capture.
- **Start audio / Stop audio**: starts/stops audio synthesis (Web Audio).
- **Frame diff gain**: multiplies the frame-difference signal (higher = more sensitive motion detection).
- **Motion floor (noise gate)**: values below this are set to 0 (helps suppress sensor noise / flicker).
- **FFT size**: audio synthesis iFFT size \(N\). Larger = more spectral detail, more CPU/latency.
- **Columns per second (analysis rate)**: how often motion vectors are computed and sent to the audio engine.
- **Motion → loudness**: overall output level (motion energy also affects gain).
- **Smoothing (motiongram)**: exponential smoothing of motion values (higher = calmer/less “buzzy”).

## What it does

- Reads webcam video
- Computes frame-to-frame difference
- Builds a **motiongram** by averaging the difference over columns (one value per y-row)
- Maps each motion vector to an audio spectrum and runs an **inverse FFT** to synthesize sound

## How the sound mapping works

For each motion vector:

- We treat the motion values as **magnitudes** for FFT bins (with a slight tilt favoring lower bins).
- We assign a random phase to each bin (to avoid a constant “pure tone” / DC-ish artifact).
- We construct a conjugate-symmetric spectrum and run an **iFFT** to get a time-domain frame.
- We apply a Hann window and **overlap-add** frames to produce continuous audio.

This is intentionally “simple sonification” (fast, stable, and easy to modify). If you want a more
direct mapping (e.g. fixed phase, frequency scaling in Hz, or mapping image x/y differently), open an
issue or tell me what sound you want.

## Troubleshooting

- **Camera permission denied**:
  - You must use a secure context: `https://…` or `http://localhost`.
  - GitHub Pages is `https` so it’s fine, but if you open via `file://` it will often fail.
- **No sound**:
  - Click **Start audio** (browsers block autoplay).
  - Check that your tab isn’t muted and your system output device is correct.
  - Increase **Frame diff gain** and/or **Motion → loudness**.
- **Sound is too quiet**:
  - Increase **Motion → loudness**.
  - Lower **Motion floor** so more motion passes through.
- **It’s glitchy / high CPU**:
  - Lower **FFT size**.
  - Lower **Columns per second (analysis rate)**.

## Deploy on GitHub Pages

1. In your GitHub repo, go to `Settings` → `Pages`
2. Under **Build and deployment**, set:
   - **Source**: `GitHub Actions`
3. Push to `main`

After the workflow finishes, your site will be available at:
`https://<your-user>.github.io/<your-repo>/`

