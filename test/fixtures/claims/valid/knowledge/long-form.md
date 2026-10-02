---
title: Long-form claims
summary: Fixture for the v0.3 long form, with prose and relations the parser skips.
compartment: knowledge
scope: global
permalink: fixture-long-form
version: 3
format: 0.3
volatility: stable
---

## Hosting

Prose between claims is allowed and skipped.

- [fact] A recreated alwaysdata site gets a new site id ^c-2p9x4d
  - source: t-356, j-71b0c2aa
  - volatility: volatile
  - verified: 2026-09-22
  - contradicts: c-5h1k0z
- [rule] Never guess a site id before a restart call (source: t-356) ^c-7v4b1e

## Relations
- part_of [[fixture-short-form]]
