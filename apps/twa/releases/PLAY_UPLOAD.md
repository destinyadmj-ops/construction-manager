Play Console upload — instructions and CI

Manual steps
1. Create a Google Play Console account (or use your organization's account).
2. Create an "App" in Play Console and note the package name (should match `com.masterhub.app`).
3. Create a Service Account in Google Cloud Console with role "Play Console > Release Manager" (or the recommended minimal roles) and generate a JSON key file.
4. In Play Console, link the service account or use the generated JSON key for API access.
5. For internal testing, open the Internal testing track and upload `apps/twa/releases/app-release.aab`.

CI automation (GitHub Actions) — overview
- Add the Service Account JSON as a repository secret named `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (contents of the JSON key file). Do NOT commit the JSON file.
- Add `PACKAGE_NAME` secret (eg `com.masterhub.app`) or hardcode in workflow inputs.

Example GitHub Actions workflow (place in `.github/workflows/play-deploy.yml`):

```yaml
name: Upload AAB to Play

on:
  workflow_dispatch:
    inputs:
      track:
        description: 'Play track (internal, alpha, beta, production)'
        required: true
        default: internal

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Download artifact (AAB)
        run: |
          ls -la apps/twa/releases

      - name: Upload to Google Play
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJson: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: ${{ secrets.PACKAGE_NAME }}
          releaseFiles: apps/twa/releases/app-release.aab
          track: ${{ github.event.inputs.track }}

```

Notes
- Replace action version as appropriate; test on a dedicated branch. Keep service keys in secrets manager.
- If you prefer to use `google-github-actions` official libraries, you can adapt the workflow accordingly.
