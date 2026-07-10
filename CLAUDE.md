# Rungano — notes for coding agents

Desktop TTS app for narrating Shona folktales. Electron shell → Flask proxy
(`:7861`) → SGLang-Omni serving Higgs Audio v3 in WSL2 (`:8000`).
Read `docs/DESIGN.md` first — it is accurate and maintained.

## Commands
- `npm test` — pytest suite in `server/tests/` (no GPU/SGLang needed)
- `npm start` / `npm run dev` — launches the full app **including SGLang in
  WSL2, which loads an ~8 GB model onto the GPU**. Don't launch casually.
- Server standalone: `server\.venv\Scripts\python.exe server\server.py --port 7861`

## Testing without the model
`server/tests/conftest.py` has `FakeTTS` + a `flask_app` fixture wired to temp
dirs. For manual E2E, run a fake SGLang (`/v1/models` + `/v1/audio/speech`
returning any WAV) and point the server at it with `--sglang-url`.

## Gotchas
- **Windows port reuse**: killing the Flask dev server can silently fail, and a
  second instance will bind the same port (SO_REUSEADDR) while the old one
  keeps receiving connections. If test requests hit stale state, check
  `netstat -ano | findstr :7861` before debugging anything else.
- Playback is delegated to the system player (VLC) via `.m3u` files — there is
  deliberately no in-app `<audio>` player. `writeM3u` in `renderer/playlist.js`
  is the only place playlists are built.
- History metadata carries a `run_id` per synthesis request; sessions group by
  it. Batch/stream sentence results include the history entry `id` — the
  renderer needs it for `/api/export/wav`.
- Renderer is plain ES modules, no bundler. DOM refs live in
  `renderer/state.js` (`els`); every id referenced there must exist in
  `index.html`.
- `main.js` resolves APP_ROOT / RES_ROOT / DATA_ROOT differently when packaged
  — see "Paths" in `docs/DESIGN.md` before touching path logic.
- Line endings are LF in the repo; Windows checkout warns about CRLF — ignore.
