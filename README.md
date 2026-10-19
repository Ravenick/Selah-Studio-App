# Selah Studio

Selah Studio is an offline-first church presentation app for preparing songs, sermons, scripture, and media, then sending slides to a separate projector window. The operator workspace is at `/studio`; the audience display is at `/projector`.

## Run the app

```sh
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/selah-studio run dev
```

The shared API server must be running for uncached API.Bible passages and server-side Whisper transcription. The studio itself and all local presentation data work without an account or SQL database.

## Local data and offline behavior

The browser database is the Dexie instance in `artifacts/selah-studio/src/lib/local-workspace.ts`.

- `songs` and `sermons` store editable presentation content.
- `verses` uses `[bibleId+book+chapter+verse]` as its compound key and caches fetched passage text.
- `themes` stores presentation preferences.
- `backgrounds` stores web files as IndexedDB blobs and Tauri asset metadata as local paths.
- In the desktop app, large media files live in `Documents/SelahStudio/Assets/`.

Cached songs, sermons, themes, scripture, and media remain available offline. A missing scripture passage is fetched from API.Bible and added to the local cache. The app does not require `DATABASE_URL`, Postgres, or an account.

## Public hymn search

The public-hymn search reads the bundled `artifacts/selah-studio/public/openhymnal.201406.xml` archive and parses it in the browser. It is available offline, uses no cloud song database, and only returns entries whose source record explicitly says `copyright: public domain`. Each result retains its author credit and links to the Open Hymnal copying terms.

## Presentation state and projector

`useAppStore` owns the active preview slide, live output slide, auto-live setting, and active canvas track. The operator broadcasts output state over `BroadcastChannel("selah_projector_channel")`; a projector opened later requests the latest output and the operator responds. The last output is also saved locally to restore the display after reload.

## Speech input

On the web, push-to-talk uses the browser Speech Recognition API when available. Tauri and unsupported browsers record audio and send it to the API server, which tries Hugging Face Whisper models one at a time in this order: `openai/whisper-tiny`, `openai/whisper-base`, `openai/whisper-small`, then `openai/whisper-medium`. Transcription requires an internet connection.

## Provider credentials

The API server reads `API_BIBLE_KEY` and `HF_ACCESS_TOKEN` from Replit Secrets. Do not add these values to `VITE_*` variables, source files, or the frontend bundle. If hosting the frontend separately, configure `VITE_API_BASE_URL` to point to the API server; configure the provider secrets on that server as well.

## Desktop and releases

`pnpm --filter @workspace/selah-studio run build` builds the web app and regenerates Tauri icons from `public/selah-logo.png`. `pnpm --filter @workspace/selah-studio run build:desktop` produces Windows installers with Tauri. The GitHub Actions workflow builds on pushes to `master` and publishes installers as a GitHub Release; code signing is enabled only when the certificate secrets are configured.

## Workspace map

- `artifacts/selah-studio` — React/Vite UI, local Dexie data, and Tauri shell
- `artifacts/api-server` — server-only API.Bible and Hugging Face requests
- `lib/api-spec` — OpenAPI contract
- `lib/api-client-react` and `lib/api-zod` — generated API clients and validation schemas
