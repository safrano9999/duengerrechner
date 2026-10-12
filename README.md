# Düngerrechner mit API und MCP

- Dieses Projekt erweitert [bergrows Düngerrechner](https://github.com/bergrow/duengerrechner) um REST für MCP und zusätzlich GraphQL.
- Die [WebUI auf GitHub Pages](https://safrano9999.github.io/duengerrechner/) bleibt erhalten. Unten stehen API, MCP und GitHub.
- Bare Metal nutzt FastAPI. Eine systemd-Datei wird erzeugt.
- Container laufen mit Docker oder Podman. Ein systemd-Quadlet wird erzeugt.
- Das [Container-Image](https://github.com/safrano9999/duengerrechner/pkgs/container/duengerrechner) heißt `ghcr.io/safrano9999/duengerrechner:latest`.
- Auf Cloudflare läuft die [WebUI samt API und MCP](https://duengerrechner.safrano9999.workers.dev).
- Eine `.env` lässt sich injizieren. Bearer-Tokens sind optional.

[Einrichtung und Beispiele](docs/betrieb.md)

[Prompt um deinem Agenten diese Webui samt API und MCP auf einem Cloudflare worker einzurichten.](CLOUDFLARE-WORKER-SKILL.md)

So umgesetzt auf [duengerrechner.safrano9999.workers.dev](https://duengerrechner.safrano9999.workers.dev).
