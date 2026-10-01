# InfraSim

register: product

## Product purpose
A browser-based transportation simulation platform. Users load a road network, simulate up to ~1,000 vehicles, modify infrastructure (lanes, closures, signal timing, speed limits, roundabouts, bus/bike lanes, pedestrian crossings, new roads, one-way streets) and quantitatively compare performance before vs after under identical seeded demand.

The value is not the 3D view. It is: propose an intervention, simulate the whole network, compare the tradeoffs with numbers.

## Users
- Primary: civil / transportation engineering and urban planning students, researchers. Working on a laptop in a bright campus studio or lab, iterating on a design question for a course project; presenting the final result on a projector.
- Secondary: municipal planners, transport enthusiasts.

## Core flow
Select network → configure demand → run baseline → read metrics → modify infrastructure → run again → compare.

## Tone
Engineering plan sheet. Honest, legible, quantitative. Calm confidence; numbers first. Toy-like clarity in the 3D city (Mini Motorways), engineering density in the panels (PTV Vissim / Aimsun).

## Anti-references
- Dark "control room" dashboards with neon glow.
- SaaS hero-metric tiles, gradient accents, glassmorphism.
- Game UI chrome (Cities: Skylines) that hides the numbers.

## Principles
1. Every number states its unit and its comparison basis.
2. Same seed, different infrastructure: comparisons must be fair and say so.
3. Edits are reversible and listed; nothing changes silently.
4. Colour carries data (congestion), not decoration.
