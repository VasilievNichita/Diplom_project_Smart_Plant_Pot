# Incremental releases through October 2026

The user requested daily publication checks until 31 October 2026. Releases must describe actual work and retain real Git author/committer timestamps. Do not create empty commits, fabricate progress or rewrite dates.

## Ready now

- Local trilingual web UI, journal, photos, channel reassignment and tests.
- Hardware procurement candidates and a detailed measurement protocol are retained privately in `planning/` until publication is explicitly approved.

## Next coherent changes

1. Verify purchased board/driver/pump variants against the v0.3 wiring baseline; adjust if needed.
2. Real calibration and fault-injection trials after parts arrive.
3. Device credential rotation and authenticated remote operator access when needed.
4. Automatic irrigation decisions evaluated against a deterministic baseline.
5. Training pipeline after dataset scope and labels are verified.
6. GLB models after reference photos are available.
7. Server-side notification delivery after account linking is configured.

These are work packages, not promises of daily finished features. Hardware arrival, real plant cycles and data review cannot be replaced by scheduled Git pushes.

## Daily publishing procedure

Use only `https://github.com/VasilievNichita/Diplom_project_Smart_Plant_Pot` once that repository is created and authenticated. Check the actual origin before pushing. Work in `D:\diplom` with author `VasilievNichita` and the user's existing local Git email; do not add another author or co-author.

Inspect the diff. Stage only reviewed source/docs/tests, never private plans, photographs, datasets, credentials or experimental records. Run relevant checks. Commit one coherent completed change if needed, and push only reviewed pending commits in order. Do not force-push or auto-resolve remote conflicts. If no completed changes exist, skip publication. If authentication is missing, report the blocker without attempting to access unrelated credentials.

Stop publication after 31 October 2026 in Europe/Chisinau. Notify only on a successful release, a new failure, completion or a required user action. A scheduled check does not guarantee a commit every day.

## Completed backend milestone pending scheduled publication

The v0.2 backend is implemented locally: SQLite persistence and legacy browser migration; server photos and full backups; validated, authenticated telemetry; separate demo/real channel assignments; bounded manual irrigation command lifecycle; and an isolated ESP32 simulator. See docs/api.md and docs/architecture.md for scope and remaining hardware work.

A reviewed local commit may already contain this milestone. At the scheduled check, inspect unpushed commits as well as working-tree changes. Push the existing reviewed commit without creating an empty or duplicate one. Verify with `npm test` and `npm run simulate` from `site` using Node.js 24+. The simulator uses a separate in-memory database and must not be redirected to the actual installation. Never stage `data/`, `private/` or `planning/`.

## Firmware milestone

The v0.3 source, wiring PDF, generator and assembly guide are publishable together with the small backend protocol extension for measured runtime and operator recovery. Review existing pending commits in order. Build `monitor`, `pump-test` and `irrigation` from `firmware`, run `firmware/scripts/test-native.ps1`, then the backend tests. Do not upload firmware to an attached board during an unattended publishing run. Never stage `firmware/include/secrets.h`, `.pio`, generated binaries with credentials, hardware QA renders or physical measurement records. Claims must distinguish host tests and cross-compilation from the still-pending bench trials.
