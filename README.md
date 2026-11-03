# Selah Studio

Selah Studio is an offline-first church presentation app for preparing songs, sermons, scripture, and media, then sending slides to a separate projector window. The operator workspace is at `/studio`; the audience display is at `/projector`.

## Run the app

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the studio and API server together. `pnpm dev:studio` starts only the frontend. Run `pnpm typecheck` and `pnpm test` to check the workspace. Online Bible versions and speech-transcription fallback need the API server; the bundled KJV works without it.

## Local data and offline behavior

The browser database is the Dexie instance in `artifacts/selah-studio/src/lib/local-workspace.ts`.

- `songs` and `sermons` store editable presentation content.
- Legacy songs from `selah-active-schedule-songs` are migrated into Dexie on startup. The original localStorage value is left intact as a recovery backup.
- `verses` uses `[bibleId+book+chapter+verse]` as its compound key and caches fetched passage text.
- `themes` stores presentation preferences.
- `backgrounds` stores web files as IndexedDB blobs and Tauri asset metadata as local paths.
- In the desktop app, large media files live in `Documents/SelahStudio/Assets/`.

Saved songs, sermons, themes, cached scripture, the bundled KJV, and local media remain available offline. A missing non-KJV passage is fetched from API.Bible and added to the local cache. The app does not require `DATABASE_URL`, Postgres, or an account.

### Studio Connect (Tauri desktop)

The desktop app can start a temporary Wi-Fi submission service from **Studio Connect** in the top navigation. It binds to a dynamically selected private LAN address and ephemeral port, displays a QR code with a one-hour pairing token, and serves the sender form directly from the desktop app. Phones and computers must be on the same Wi-Fi network or hotspot; the workflow needs no internet, account, router configuration, or cloud service. The operator can stop sharing at any time to revoke the token, or refresh the address/QR after changing networks.

Received songs, sermons, and announcements are stored as JSON in Selah Studio's local application-data directory, independent of the sharing session. The Incoming panel supports preview, edit, approve, reject, and delete. Approval writes songs and sermons into the existing local library; announcements are tagged in the sermon library. These actions do not change live projector output. The browser/web build does not host Wi-Fi sharing; this feature is available in the Tauri desktop app.

### Selah Camera (Emerald preview)

The separate Android app in `apps/selah-camera-android` sends a single back-camera feed to Emerald over the same local Wi-Fi network. The first prototype requests a 1280x720 stream and sends JPEG frames at up to 15 fps; the real rate depends on the phone and network. No internet connection is used. Start Studio Connect in Emerald, paste its full local address into Selah Camera, and use **Phone Camera** in the operator controls to show or hide the feed behind the current text.

GitHub Actions builds the Lightweight and Emerald Windows installers on pushes to `main` or `master`. A separate Android workflow builds a debug APK; download it from the workflow run's **Artifacts** section as `selah-camera-android-apk`. Debug APKs are for sideload testing and may need to be reinstalled when a later CI run uses a different debug signing key.

## Public hymn search

The Songs library searches the bundled `artifacts/selah-studio/public/openhymnal.201406.xml` archive for title, author, or lyric text. Search works offline and only returns entries whose source record explicitly says `copyright: public domain`. Results include the author and full lyrics; Add & Load saves the song to Dexie and stages it in the deck.

## Presentation state and projector

`useAppStore` owns the active preview slide, live output slide, auto-live setting, and active canvas track. The operator broadcasts output state over `BroadcastChannel("selah_projector_channel")`; a projector opened later requests the current output and the operator responds. On startup, the operator and projector begin in animated logo mode instead of restoring stale slide content.

## Speech input

Push-to-talk uses the browser/WebView SpeechRecognition API when available. If unavailable, it records audio and sends it to the API server for Hugging Face transcription, which requires an internet connection. Recognized references are parsed locally, and KJV passages load from bundled Bible data. No offline speech model is included.

## Schedule files

Schedule exports use JSON version `1.0`. Imports validate slide and song data before changing the workspace, accept older versionless schedules, and reject unsupported future versions with an error. Unknown fields in supported schedules are preserved for forward compatibility. Tauri schedules created in the app save back to their managed file without reopening Save As; imported files still use Save As until created as a managed schedule.

## Security policy

Tauri and Vercel builds apply a Content Security Policy restricted to same-origin application code, local assets, HTTPS network/media, and the YouTube no-cookie frame. The Vercel policy permits microphone access for browser speech recognition.

## Provider credentials

The API server reads `API_BIBLE_KEY` and `HF_ACCESS_TOKEN` from its environment. Do not add these values to `VITE_*` variables, source files, or the frontend bundle. For a hosted web frontend, configure `VITE_API_BASE_URL` to point to the API server, or serve the API on the same origin. Tauri uses WebView SpeechRecognition when available; if unavailable, configure `VITE_TAURI_API_BASE_URL` for remote transcription. The transcription server defaults to `openai/whisper-large-v3` through Hugging Face Inference Providers; the Hugging Face token needs Inference Providers permission. Optional fallback model IDs can be set with `VITE_HF_MODEL_FALLBACK_1` through `_3`. Keep provider credentials on the API service. API.Bible access to NIV, NKJV, and NLT depends on the account's license and available Bible IDs.

## Desktop and releases

`pnpm --filter @workspace/selah-studio run build` builds the web app and regenerates Tauri icons from `public/selah-logo.png`. `pnpm --filter @workspace/selah-studio run build:desktop` produces Windows installers with Tauri. The GitHub Actions workflow builds on pushes to `master` and publishes installers as a GitHub Release; code signing is enabled only when the certificate secrets are configured.

## Workspace map

- `artifacts/selah-studio` — React/Vite UI, local Dexie data, and Tauri shell
- `artifacts/api-server` — server-only API.Bible and Hugging Face requests
- `lib/api-spec` — OpenAPI contract
- `lib/api-client-react` and `lib/api-zod` — generated API clients and validation schemas
