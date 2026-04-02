# AUREX Mandates Index

This folder defines the mandatory engineering standards for AUREX.

---

## Current Direction

AUREX is now **static-first**:
- Offline GEE exports produce versioned COG assets.
- Runtime map tiles are served by TiTiler from Cloudflare R2.
- Frontend interaction is timeline-driven (2019-2024 monthly).
- Runtime GEE calls are intentionally avoided.

---

## Read In This Order

1. `CONTEXT.md` — scope, rules, and stack constraints
2. `ARCHITECTURE.md` — system design and runtime data flow
3. `TASKS.md` — active sprint and acceptance criteria
4. `CONVENTIONS.md` — coding conventions
5. `SECURITY.md` — security controls and non-negotiables
6. `DECISIONS.md` — ADR history and superseding decisions

---

## Sprint Status

Active sprint: **Static Sprint 1 — Data + Tile Foundation**

The objective is to complete the static data pipeline and lock the tile-serving contract
before adding UI polish or advanced analytics.
