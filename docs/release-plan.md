# Incremental releases through October 2026

The user requested daily publication checks until 31 October 2026. Releases must describe actual work and retain real Git author/committer timestamps. Do not create empty commits, fabricate progress or rewrite dates.

## Ready now

- Local trilingual web UI, journal, photos, channel reassignment and tests.
- Hardware procurement candidates and a detailed measurement protocol are retained privately in `planning/` until publication is explicitly approved.

## Next coherent changes

1. UI changes agreed after the first review.
2. Data import and storage migration, if selected.
3. Local server schema and specimen/sensor identities.
4. Telemetry ingestion with explicit simulation mode.
5. Controller state machine and mocked fault tests.
6. Firmware for the purchased board and sensors.
7. Real calibration routines after parts arrive.
8. Training pipeline after dataset scope and labels are verified.
9. GLB models after reference photos are available.
10. Server-side notification delivery after account linking is configured.

These are work packages, not promises of daily finished features. Hardware arrival, real plant cycles and data review cannot be replaced by scheduled Git pushes.

## Daily publishing procedure

Use only `https://github.com/VasilievNichita/Diplom_project_Smart_Plant_Pot` once that repository is created and authenticated. Check the actual origin before pushing. Work in `D:\diplom` with author `VasilievNichita` and the user's existing local Git email; do not add another author or co-author.

Inspect the diff. Stage only reviewed source/docs/tests, never private plans, photographs, datasets, credentials or experimental records. Run relevant checks. Commit one coherent completed change if needed, and push only reviewed pending commits in order. Do not force-push or auto-resolve remote conflicts. If no completed changes exist, skip publication. If authentication is missing, report the blocker without attempting to access unrelated credentials.

Stop publication after 31 October 2026 in Europe/Chisinau. Notify only on a successful release, a new failure, completion or a required user action. A scheduled check does not guarantee a commit every day.
