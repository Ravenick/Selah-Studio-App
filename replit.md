# Selah Studio

Offline-first church presentation software for preparing songs, sermons, scripture, and media, then controlling a separate projector display.

## Run & Operate

- `pnpm --filter @workspace/selah-studio run dev` — run the studio preview
- `pnpm --filter @workspace/api-server run dev` — run provider API routes
- `pnpm --filter @workspace/selah-studio run typecheck` — check the app
- `pnpm --filter @workspace/api-server run typecheck` — check the API server
- `pnpm --filter @workspace/selah-studio run build` — build the web app and regenerate desktop icons
- `pnpm --filter @workspace/selah-studio run build:desktop` — build the Tauri desktop installer
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed API clients and schemas

The provider API server uses the `API_BIBLE_KEY` and `HF_ACCESS_TOKEN` Replit Secrets. The frontend must never bundle either credential. No `DATABASE_URL`, SQL server, account, or cloud database is required.

## Product Constraints

- Keep the existing obsidian/teal visual system, layout, and typography; do not redesign the studio.
- Keep songs, sermons, themes, cached Bible passages, settings, and web media in the local Dexie/IndexedDB workspace.
- Keep public-hymn search local: parse the bundled Open Hymnal source in the frontend and show only records explicitly marked public domain.
- Keep desktop media files under `Documents/SelahStudio/Assets/` and store only their paths in IndexedDB.
- Use `BroadcastChannel("selah_projector_channel")` for operator/projector synchronization.
- Do not add a login or cloud database.

## Where Things Live

- `artifacts/selah-studio` — React/Vite studio, projector view, Dexie workspace, and Tauri desktop shell
- `artifacts/api-server` — server-side API.Bible and sequential Whisper requests
- `lib/api-spec` — OpenAPI contract for provider endpoints
- `lib/api-client-react` and `lib/api-zod` — generated client and validation schemas
- `src-tauri` — Rust/Tauri desktop configuration and filesystem permissions

## Build Notes

- The web client uses the Replit `/api` service by default; set `VITE_API_BASE_URL` to the API service URL when the frontend is hosted separately.
- Hugging Face transcription is an online provider service. Scripture and saved media that have already been cached remain available offline.
- Windows release signing is optional and uses the GitHub Actions certificate secrets configured in `.github/workflows/build.yml`.
