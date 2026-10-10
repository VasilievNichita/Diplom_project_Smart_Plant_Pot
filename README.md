# Folium — Smart Plant Pot

Diploma project by **Vasiliev Nichita, CR-232**. A two-channel plant-care system with three registered plants: Chlorophytum comosum, Tradescantia zebrina, and a cactus whose species will be confirmed after purchase.

## Current implementation

The first deliverable is a responsive, dependency-free web UI in Romanian, Russian and English. It includes plant profiles, two channel assignments, a care journal, manual measurements, photo storage, CSV/JSON export and notification contact preferences.

**Demo charts are illustrative. No physical controller, trained model, authentication service or notification delivery is connected in this version.** The plant illustrations are original SVG artwork, not Blender models. A future version will add GLB models after the actual plants are photographed.

Data is stored in the current browser only: records and settings in localStorage, photos in IndexedDB. It is not synchronized across devices. JSON export excludes photo binaries; keep originals separately. Clearing browser data removes local records and images.

## Run

Install Node.js 20 or later, then:

```sh
cd site
npm run dev
```

Open `http://127.0.0.1:4173`. The preview binds only to loopback, not the public network. No npm dependencies or installation step are required.

On Windows, `start-site.cmd` starts the same server. If the port is already in use, reuse the existing preview rather than starting another instance.

```sh
cd site
npm test
```

## Layout

- `site/dist/`: browser application and original illustrations.
- `site/scripts/serve.mjs`: local static server.
- `site/tests/`: state transitions, validation and translation completeness.
- `docs/`: public architecture and implementation milestones.

## Planned work

1. Two independent irrigation channels on one ESP32, with three dedicated removable sensor cables.
2. Calibration, event logging, dose limits and fault handling.
3. A moisture forecast evaluated against simple baselines.
4. A small image model trained from random initialization, subject to suitable licensed data.
5. Blender models, server-backed persistence and verified notification delivery.

Replacing a plant applies a registered profile and preserves each specimen's history. Data-driven adaptation requires a separate experiment; changing a profile alone does not demonstrate learning. Plant health or model accuracy claims will be based on measured results.

Target: an integrated prototype by winter 2026–2027, with the diploma defense in May 2027. No exact defense date has been confirmed.

