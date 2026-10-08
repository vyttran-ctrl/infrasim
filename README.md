# InfraSim

Interactive transportation infrastructure simulation in the browser.

Load a road network, run up to ~1,000 vehicles, change the infrastructure (lanes, closures, signal timing, speed limits, roundabouts, bus and bike lanes, pedestrian crossings, new roads, one-way streets) and compare performance before and after under identical, seeded traffic demand.

> How does changing transportation infrastructure affect traffic performance across an entire road network?

## Run it

```bash
npm install
npm run dev      # http://localhost:5199
npm test         # unit + simulation tests
npm run build
```

## How it works

```
Main thread                      Web Worker
  React UI, dashboard              vehicle simulation (IDM + MOBIL)
  Three.js / R3F scene   <---->    A* routing, rerouting on edits
  scenario comparison              signals, roundabouts, pedestrians
                                   metrics
```

- **Road graph.** Nodes are junctions, directed edges are road segments with length, speed limit, lanes, capacity and bus/bike lane allocation.
- **Vehicles.** Intelligent Driver Model for car following, MOBIL for discretionary lane changes, mandatory lane changes for bus/bike lane rules. Vehicles stop at red, yield at priority junctions and roundabouts, and reroute when a road on their route closes.
- **Demand.** Origin-destination matrices between named zones (Residential, Campus, Downtown...) with Low / Normal / Rush hour / Event presets.
- **Reproducibility.** The trip list (spawn times, origins, destinations, vehicle types, driver parameters) is generated from the seed before the run and never depends on the infrastructure, so two scenarios with the same seed see exactly the same traffic.
- **Comparison.** Saved scenarios run off-screen in their own workers with a shared seed and config; results show deltas per metric.

## Networks

- **Grid city**: 16 signalized intersections, hand built.
- **Waterloo (OSM)**: a baked snapshot of Uptown Waterloo and the University of Waterloo area, converted from OpenStreetMap (`scripts/bake-waterloo.mjs`). © OpenStreetMap contributors.
- **Import OSM area**: fetch any small bounding box live from the Overpass API.

## Demo question

Would replacing the central four-way signalized intersection with a roundabout improve network performance? Open **Compare → Roundabout demo** to run both under the same 1,000-vehicle rush hour with the same seed.
