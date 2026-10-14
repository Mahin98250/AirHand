# Reusable GitHub Pages deployment

AirHand's deployment pipeline lives in `.github/workflows/deploy-pages.yml`. It validates the project, publishes it to GitHub Pages, and checks the deployed entry point.

## Reuse the pattern in another static web app

Copy `.github/workflows/deploy-pages.yml` into the other repository, then adapt the validation section to that app's stack and its real entry files. The deploy job expects GitHub Pages to be configured to use **GitHub Actions**.

### Recommended pipeline contract

1. **Validate:** install dependencies with a lockfile, run syntax/lint/type checks, unit tests, and the production build where applicable.
2. **Package:** publish only the built output directory (for example `dist/` for Vite, `build/` for many React apps, or `.` for a plain static site). Do not upload the whole repository for a built app.
3. **Deploy:** use `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`.
4. **Verify:** fetch the deployed HTML, discover its versioned entry-point assets, fetch those assets, and compare them with the expected build output where feasible.
5. **Diagnose:** inspect the workflow run and job logs before changing browser cache settings.

## Adaptation examples

### Plain HTML/CSS/JavaScript
- Validate: `npm run check` and `npm test` (if present).
- Artifact path: `.` or a dedicated `site/` folder.
- Assert that `index.html` and all referenced local assets exist.

### Vite
- Run `npm ci` and `npm run build`.
- Artifact path: `dist/`.
- Configure the Vite `base` path for the GitHub Pages project URL.
- Verify the generated HTML and at least one generated asset.

### Other frameworks
- Use the framework's production build command and upload only its static output.
- If the app needs server-side rendering or API routes, GitHub Pages alone cannot host those server components.

## Reliability notes

- A cache-busting query string helps when the HTML is fresh but an old JavaScript asset is cached. It does not fix a failed deployment, a wrong Pages source, an incorrect base path, or a service worker serving stale content.
- A successful HTTP response proves availability, not that every UI feature works. Keep automated tests and perform real-device checks for camera, permissions, routing, and interactive behavior.
- Never report a deployment as successful until the Actions run is green and the live smoke test passes.
