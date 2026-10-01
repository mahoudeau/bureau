---
title: Break-room toaster TLS errors
compartment: recipe
scope: global
permalink: toaster-network
version: 2
---

- [gotcha] The toaster fails every HTTPS request with certificate errors; other clients on the same line are fine (source: [[journal/2026-08-11]])
- [step] Run a tiny local relay on 127.0.0.1 and point the toaster at it (source: [[journal/2026-08-11]])
