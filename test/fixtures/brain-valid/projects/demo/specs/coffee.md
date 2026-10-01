---
title: Coffee spec
compartment: spec
scope: project:demo
summary: What the office coffee machine does, as numbered rules.
---

# Coffee

## Actors

- The worker who wants coffee. The machine, which is pixels.

## Rules

- RULE-COFFEE-01: The machine never brews. (source: [[coffee-machine]])
- RULE-COFFEE-02: Beans come from the supply closet sprite. (source: [[refill-coffee]], journal/2026-08-11.md)

## Journeys

1. A worker walks to the machine, waits, and walks back with nothing (RULE-COFFEE-01).

## Edge cases

- The hopper is 4 pixels wide; anything wider does not fit (RULE-COFFEE-02).
