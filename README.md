# Düngerrechner mit API und MCP

Erweiterung von [bergrows Düngerrechner](https://github.com/bergrow/duengerrechner).

- **API:** REST & GraphQL.
- **MCP:** über REST.
- **Sollbereiche:** Jede Berechnung meldet Abweichungen und nötige Anpassungen.
- **Betrieb:** Bare Metal mit FastAPI, Docker/Podman oder Cloudflare Worker.
- **systemd:** Service & Quadlet.
- **Konfiguration:** injizierbare `.env`, optionale Bearer-Tokens.
- **Container:** [ghcr.io/safrano9999/duengerrechner:latest](https://github.com/safrano9999/duengerrechner/pkgs/container/duengerrechner).

**WebUI:** [GitHub Pages](https://safrano9999.github.io/duengerrechner/).

**Derzeit gehostet:** [duengerrechner.safrano9999.workers.dev](https://duengerrechner.safrano9999.workers.dev) – WebUI, API & MCP.

[Einrichtung und Beispiele](docs/betrieb.md)

[Prompt um deinem Agenten diese Webui samt API und MCP auf einem Cloudflare worker einzurichten.](CLOUDFLARE-WORKER-SKILL.md)
