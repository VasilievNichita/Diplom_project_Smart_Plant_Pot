# Architecture and boundaries

## Today

Browser → localStorage (records/settings) and IndexedDB (photos).

There is no API call to an AI provider and no automatic hardware command. The two channel slots are interface assignments. Demo and real manual records carry separate `mode` fields. A plant replacement preserves the old specimen's event history and resets calibration readiness for the affected channel.

The prototype uses semantic HTML, responsive CSS, ES modules and original SVG illustrations. This keeps the first UI inspectable, locally runnable and independent of paid services. A framework migration is optional; functionality and data separation are the priority.

## Planned system

ESP32 → local Python API → measurement database → website.

The controller will run a deterministic safety state machine. Models may propose bounded decisions; they do not bypass reservoir checks, sensor validity, per-dose limits, cooldowns, restart behavior or duplicate-command protection.

One air sensor measures the shared room environment. One light sensor measures one reference position. A float switch indicates low water, not a percentage. An unplugged plant has no fresh sensor data. Analog probe values remain raw ADC plus a relative calibrated index until a physical calibration supports stronger units.

## Identity and replacement

Keep separate IDs for species profile, physical plant, probe, calibration, channel and model version. Manual confirmation binds a probe/plant to a channel; an analog probe alone cannot announce which pot was connected.

Stop the physical pump before replacing a pot. Archive the previous channel binding, retain its history, load the new specimen's verified calibration, validate fresh measurements, then explicitly enable automatic operation. A persistent per-pot calibration should be reused only when sensor position and substrate remain valid. The current UI resets readiness conservatively because no calibration implementation exists yet.

## Photos and notifications

Photo storage is implemented. Classification, region localization and training are not implemented yet. Natural purple/silver Tradescantia coloration must not be treated as a disease label.

Notification contact fields are local preferences, not registration or a working subscription. Telegram needs a bot-start/account-link flow and a server-side chat ID. Email requires a mail provider and address verification. Never put bot tokens or mail credentials in browser code or Git.

## Data and evaluation

Keep real measurements, simulation, training/validation/test sets and example screenshots separate. Split time-series evaluation chronologically, allowing for prediction horizons. Group photo splits by physical specimen and acquisition session; remove duplicates before splitting. Publish actual per-task metrics and limitations, not a combined percentage for the whole system.

