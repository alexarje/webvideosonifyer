## Web Video Sonifyer: turning motion into sound (in your browser)

I’ve been exploring the idea that **movement** can be treated like a kind of instrument. What happens if you take a webcam feed, measure how much the image changes from frame to frame, and then turn that “motion signal” into audio in real time?

That’s what **Web Video Sonifyer** does: it’s a small, dependency-free web app that runs entirely in the browser and turns **visual motion** into **sound**.

### What it is

Web Video Sonifyer is a browser-based motion-to-audio synthesizer. You open the page, enable your webcam, and the app continuously:

- Computes **frame difference** (how much each pixel changes between consecutive frames)
- Compresses those differences into a **motiongram** (a 1D motion profile)
- Converts that motion profile into an **audio spectrum**
- Runs an **inverse FFT (iFFT)** to generate a short audio frame
- Uses **overlap-add** to stitch frames into continuous sound

It also derives a second motion profile across the other image axis and uses it to control **left/right panning**, so motion on the left side of the camera view tends to “pull” sound left, and motion on the right pulls it right.

### Why it’s fun

It’s surprisingly expressive. A few examples:

- Slow gestures can become evolving drones.
- Quick movement becomes brighter/noisier.
- Moving on one side of the frame shifts the stereo image.

It’s not meant to be a realistic “instrument” out of the box; it’s meant to be a **playable mapping** that you can tune.

### How to play it

The app gives you controls that let you shape the behavior:

- **Frequency range**: constrain output to a lower band to reduce harshness
- **Silence threshold**: make it quiet when you’re still
- **Diff gain / noise floor**: adjust sensitivity to motion and lighting flicker
- **Smoothing**: calm the motion signal for less jittery sound

In practice, I recommend starting with a narrower band like **80–800 Hz**, then increasing loudness and diff gain until movement is clearly audible.

### A quick technical overview

At a high level, the audio synthesis is:

1. Take a 1D motion vector (values in \([0,1]\))
2. Use it as **magnitudes** for a selected FFT bin range (with a slight low-frequency tilt)
3. Assign **random phase** to avoid static tonal artifacts
4. Build a conjugate-symmetric spectrum (to get real-valued audio)
5. iFFT → window → overlap-add

The motiongram itself is derived from per-pixel frame difference. For performance, the app analyzes a downscaled video frame, which is usually enough for stable interactive results.

### Where to try it / what’s next

Because it runs on Web Audio and `getUserMedia`, it works best in a modern Chromium browser and needs user interaction to start audio (browser autoplay policy).

Future directions I’m interested in:

- Log-frequency mappings that feel more “musical”
- Optical flow-based motion (direction + magnitude)
- More spatialization (stereo width, multi-band panning)

If you try it and have ideas for mappings or sound goals, that’s the most fun part to iterate on.

