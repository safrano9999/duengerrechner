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

## Ergänzte Dünger

Diese Dünger wurden im Fork ergänzt. Sie stehen in WebUI, REST, GraphQL und MCP zur Verfügung.

| Dünger | Deklaration | Quelle | Originalprojekt |
| --- | --- | --- | --- |
| Green House Powder Feeding CalMag | N 13,5 % (Nitrat-N 13,1 %, Ammonium-N 0,4 %); CaO 16,7 %; MgO 6,0 %. Dosierung in g/l. | [Produktseite](https://www.growmart.de/Green-House-Powder-Feeding-CalMag-50g-25kg) | [Vorgeschlagen in #42](https://github.com/bergrow/duengerrechner/issues/42) |
