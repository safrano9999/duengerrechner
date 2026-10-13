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

| Dünger | Deklaration | Quelle |
| --- | --- | --- |
| Green House Powder Feeding CalMag | N 13,5 % (Nitrat-N 13,1 %, Ammonium-N 0,4 %); CaO 16,7 %; MgO 6,0 %. Dosierung in g/l. | [Produktseite](https://www.growmart.de/Green-House-Powder-Feeding-CalMag-50g-25kg) |
| Green House Calcium Chelate | Ca 9 % (EDTA-chelatiert). Dosierung in g/l. EDTA-gebundenes N zählt nicht als pflanzenverfügbares N. | [Hersteller](https://www.greenhousefeeding.com/en/content/11-faq), [Produktleitfaden, S. 13](https://shop.greenhousefeeding.com/downloads/GHF_M%2BB_2019_USA.pdf) |
| Bionova Micromix | B 0,60 %; Cu 0,17 %; Fe 3,48 %; Mn 0,68 %; Mo 0,02 %; Zn 0,44 %. Dosierung in ml/l. Umrechnung mit 1,29 g/ml bei 20 °C. | [Herstellerdeklaration](https://bionovanutrients.com/de/micromix-mineralien/), [Sicherheitsdatenblatt](https://bionovawebshop.com/media/56/66/5a/1601494439/MSDS-MicroMixGB.pdf) |

Micromix nutzt die „EC FERTILIZER“-Deklaration. Der Beschreibungstext nennt abweichende Werte; die Dichte stammt aus dem Sicherheitsdatenblatt vom 06.10.2015. Das Flaschenetikett muss zur Deklaration passen.
