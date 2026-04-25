# webvideosonifyer
Web-based Video Sonification

## Run

Because camera permissions usually require a secure context, run a local server.

If you have Python:

```bash
python3 -m http.server 5173
```

Then open:

- `http://localhost:5173/`

## What it does

- Reads webcam video
- Computes frame-to-frame difference
- Builds a **motiongram** by averaging the difference over rows (one value per x-column)
- Maps each motion column to an audio spectrum and runs an **inverse FFT** to synthesize sound

## Deploy on GitHub Pages

1. In your GitHub repo, go to `Settings` → `Pages`
2. Under **Build and deployment**, set:
   - **Source**: `GitHub Actions`
3. Push to `main`

After the workflow finishes, your site will be available at:
`https://<your-user>.github.io/<your-repo>/`

