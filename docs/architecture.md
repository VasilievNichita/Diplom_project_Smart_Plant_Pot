# Server architecture

## Implemented flow

Browser → same-origin Node.js HTTP API → SQLite.

ESP32 → optional device-only HTTP listener → authenticated device API → the same SQLite database.

The site and local operator API run at `127.0.0.1:4173`. There is no public deployment or cloud database. The hardware listener is off by default. SQLite uses foreign keys, WAL, full synchronous durability, prepared statements, short explicit transactions and an exclusive connection lock. Only one server may use a database at a time. The schema version is 1; destructive automatic schema migrations are not implemented.

## Ownership and identity

The three physical plants have separate IDs, species profile IDs and dedicated probe IDs. The current seed has one specimen per profile; adding multiple specimens of one species requires extending the catalog/UI. Demo and real channel assignments are separate rows. Plant replacement increments the real binding revision and disarms that channel. Calibration belongs to the plant/probe and is retained across swaps; fresh telemetry with the new binding revision is still required before arming.

One ESP32 owns the two real channels. Shared air and reference-position light readings are attached to packets; they do not imply a separate environment sensor for each plant. The reservoir signal is a boolean, not a volume percentage. Missing readings remain null. Raw ADC and calibration provenance are retained. Out-of-calibration-range readings are flagged instead of silently clamped into valid percentages.

## Requests and persistence

Browser mutations require JSON, a custom request header and the expected Host/Origin. The operator listener is loopback-only, with no remote login flow. It trusts processes on the local computer. These checks are not a substitute for authentication before future remote operator access. Static files are allowlisted and cannot expose the database, private credentials or source documentation.

Device routes require a random 256-bit Bearer token whose SHA-256 hash is persisted. The optional network listener serves only device routes, rejects browser origins and exposes no operator controls. It is intended for a trusted test LAN; TLS/network access controls must be added before any untrusted network or Internet exposure. Token rotation and revocation tooling are not yet implemented; lost credentials require a planned local administrative recovery before reconnecting hardware.

Events use client-generated IDs. Telemetry uses device ID, boot ID and sequence; duplicates do not refresh freshness timestamps. Conflicting duplicates and old sequences fail. Calibration/assignment revisions prevent applying an old pot's readings to a new one. Measurements use server receive time for freshness; device observed time, if supplied, must be within two minutes. The live endpoint is not a historical backfill route.

Photo bytes and metadata are in the same database. Uploads are size-limited and checked against supported MIME signatures, with browser-side decode validation. This is not a general public upload service. Large image processing, malware scanning, quotas and multi-user isolation are not implemented.

## Irrigation state

`queued → delivered → completed | failed`

Undelivered expired/unsafe commands become `expired` or `cancelled`. Delivered commands whose acknowledgement times out become `unknown`. A restart or device reboot disarms channels and preserves uncertain delivery. A queued command can be claimed once; it is not automatically redelivered after a lost response. This deliberately prefers a missed dose over an unverified duplicate.

Queueing and handoff both validate current bindings, calibration, fresh probe and controller data, reservoir state and arming. The server also checks maximum dose, 30-second hard runtime, cooldown and rolling 24-hour requested-volume budget. Failed/uncertain deliveries conservatively consume the requested budget. One unresolved command blocks new commands across both channels. Pump limits are prototype bounds, not horticultural recommendations.

No scheduler or ML model creates watering requests in v0.2. The firmware is still to be implemented and hardware-tested. It must persist command acceptance before energizing a pump and enforce its own watchdog, off-on-boot and local interlocks. Exactly-once physical actuation cannot be guaranteed by an HTTP server. The UI's disable control prevents new commands and cancels queued commands; it is not a physical emergency stop.

## Browser migration and recovery

The UI reads the old browser state once per server identity, imports events transactionally, then imports photos individually by stable ID. It only records completion after all requests succeed. Failure leaves the browser originals and a retry notice. Repeated imports do not duplicate records. Server settings are not overwritten by later browsers. Browser storage is no longer the source of truth for records or photographs.

Backups use SQLite's online backup API rather than copying the live database file without its WAL. They include photos and the entire measurement/command history. Restore only into a stopped installation with a clean database path, retain the original installation, and review uncertain commands before re-arming.

## Evaluation boundaries

Demo chart values do not enter the telemetry table or influence irrigation. The simulator uses a separate in-memory database. UI smoke-test records are explicitly DEMO. There are no claimed physical measurements, training runs or accuracy percentages in the implementation.

Photo classification, model training, scheduled care, notification providers, Blender models and public hosting remain separate milestones. The API uses Node's built-in SQLite module; reference: https://nodejs.org/api/sqlite.html.
