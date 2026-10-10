# Folium — Smart Plant Pot

Diploma project by **Vasiliev Nichita, CR-232**. One controller, two irrigation channels, three registered specimens: Chlorophytum comosum, Tradescantia zebrina and a cactus whose species is pending identification.

## Implemented through v0.3

- Responsive botanical UI in Romanian, Russian and English.
- Node.js API and persistent SQLite storage for plant identities, channel assignments, observations, photos, preferences, calibrations, sensor measurements and irrigation commands.
- Automatic one-time import of the first UI's browser records and photos. Browser originals are retained; retrying does not create duplicates. Import failure is visible.
- Independent demo and real channel assignments. Replacing a real pot preserves its history and disarms the channel.
- Authenticated ESP32 API with binding revisions, packet deduplication and raw ADC readings. Relative moisture is calculated from the saved probe calibration.
- Bounded manual watering requests with dose, rolling 24-hour budget, cooldown, freshness and reservoir checks. Commands are handed off once and require a device result; uncertain results block further watering.
- Full SQLite backup, including photos; complete journal CSV export; paginated journal and measurement API.
- ESP32-WROOM firmware with monitor, offline pump calibration and online irrigation builds; local interlocks, watchdog and persistent command journal. Wiring PDF and step-by-step commissioning guide are included. Physical hardware validation is pending.

**The real controller is not connected. No physical watering or model accuracy has been demonstrated.** Automatic scheduling, trained models, Blender assets, account registration, remote hosting and notification delivery are still future work. SVG illustrations and demo charts remain clearly labelled.

## Run on this PC

Requires **Node.js 24 or later** (tested with 24.19.0; uses built-in `node:sqlite`). There are no npm dependencies to install.

```sh
cd site
npm start
```

Open `http://127.0.0.1:4173`. On Windows, double-click `start-site.cmd`; leave its terminal running. The launcher can also use the bundled Codex Node runtime. If a server is already running, use it instead of launching another.

The database is `data/folium.sqlite`, outside the public website directory and excluded from Git. The server takes an exclusive SQLite lock; run one server per database. The admin interface is bound to loopback. It is a single-user home prototype, not a public multi-user service.

```sh
cd site
npm test
npm run simulate
```

The simulator starts an isolated in-memory database and temporary localhost server. It cannot target the real installation and never operates pumps.

## Connecting hardware later

See [the API and ESP32 connection guide](docs/api.md). The optional device-only network listener stays disabled until explicitly configured. A registered device has its own secret token. Only the hash is stored in SQLite; credentials must never be committed.

Start with the [firmware guide](firmware/README.md), [assembly and fault tests](docs/hardware-assembly.md) and [printable wiring PDF](output/pdf/folium-wiring.pdf). The default build disables pump outputs. The irrigation build implements pump-off on boot, local timing/watchdog, reservoir/probe checks and durable command-ID deduplication. Parts must match the documented voltage, pin mapping and driver circuit. Server-side validation alone cannot stop a pump when the connection or server fails.

## Data and backups

Records and photographs now live on the server, so clearing browser data does not delete them. Language, view mode and the daily checklist remain browser preferences. The first import adopts existing assignments only for the imported mode and only before that mode was configured on the server; later imports merge records without replacing server settings.

In Settings, use **Download database with photos**. Keep backups private: they contain observations, contact preferences, photos and device token hashes. To restore, stop the server, preserve the existing `data` folder as a backup, then place the downloaded database in a new folder and launch with `FOLIUM_DB` pointing to it. Do not replace a live SQLite database or mix it with old WAL files. Restarts always disarm irrigation; delivered-but-unacknowledged commands become uncertain.

The journal CSV contains manual/imported/controller events. High-frequency telemetry is available separately at `/api/measurements` and in the database backup. A controller report contains **estimated** water volume from runtime; it is not a measured volume without a flow sensor.

## Source layout

- `site/dist/`: HTML, CSS, browser modules and original SVG artwork.
- `site/server/`: schema, validation, transactions, HTTP API and irrigation safeguards.
- `site/scripts/`: server, credential provisioning and isolated simulator.
- `site/tests/`: state, translation, persistence, API and irrigation tests.
- `firmware/`: PlatformIO project and shared C++ safety-core tests.
- `hardware/`: source generator for the vector wiring PDF in `output/pdf/`.
- `docs/`: architecture, hardware protocol and publication plan.

Target: an integrated prototype by winter 2026–2027; defense in May 2027. Changing plant profiles is configuration, not proof of machine learning. Evaluation claims require measured results.
