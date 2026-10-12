# Einrichtung

## Container

```sh
./setup.sh
```

Das erzeugt `.env`, `config.conf`, `container.conf`, `docker-compose.yml` und `duengerrechner.container`. Am Ende erscheinen die Startbefehle und der passende `ln -s`-Befehl. Es wird nichts gestartet oder heruntergeladen.

Intern gelten fest API `8080`, MCP `8000` und Supergateway `127.0.0.1:8001`. MCP verbindet sich intern mit `http://127.0.0.1:8080/api`. Abgefragt werden nur die optionalen Veröffentlichungen der Ports. Leere Veröffentlichungsports öffnen keine Host-Ports.

`ADDITIONAL_LINE` ergänzt Quadlet-Zeilen. Weitere Zeilen heißen `ADDITIONAL_LINE_02` usw. Beispiel: `Network=mein-netzwerk`. Diese Podman-Einstellungen gelten nur für das Quadlet.

Das Image heißt `ghcr.io/safrano9999/duengerrechner:latest`. Die Basis bleibt Supergateway `4.1.0@sha256:1938c43538a5308bce07d58028e9de00b7acfecb40b39b059b2f3931800ad910`, entsprechend der bestehenden GSC-/Firefly-Konfiguration. Node kommt beim Build aus dem Alpine-Paketbestand; mindestens Version 22.16 wird geprüft. Das Image enthält keinen Python-Proxy.

Auf der Infrastruktur von core/rafael erfolgen Image-Pulls ausschließlich über Smart1 und dessen `images.json`. Eine Aufnahme ins Inventar erfolgt nach ausdrücklicher Beauftragung. Compose und Quadlet verwenden `Pull=never` beziehungsweise `pull_policy: never`.

## Bare Metal

Voraussetzung: Node.js 24 und Python ab 3.10.

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./setup.sh --no-container
npm start
```

FastAPI bedient die HTTP-API und die WebUI. Der vorhandene JavaScript-Rechenkern läuft dahinter lokal in Node. MCP läuft als eigener HTTP-Endpunkt und ruft REST über FastAPI auf. `config.conf` setzt `API_HOST`, `API_PORT`, `MCP_HOST`, `MCP_PORT` und `PROFILES_DB`.

Die erzeugte `duengerrechner.service` startet beide Dienste. `setup.sh` zeigt die Befehle für den systemd-Benutzerdienst.

## Konfiguration und Tokens

`env.example`, `config.conf_example` und `container.example` sind die Vorlagen. `config.sh` ist lokal ein Hardlink auf `SCRIPTS/safrano9999/config/config.sh`. `setup.sh` enthält die projektspezifischen Schritte. Vorhandene Werte bleiben erhalten. Zum Ändern die erzeugte Datei bearbeiten; mit `./setup.sh --render-container` anschließend Compose und Quadlet aktualisieren.

`API_BEARER_TOKEN` schützt REST und GraphQL. `MCP_BEARER_TOKEN` schützt MCP separat. Das Menü erlaubt Überspringen, Eingeben oder Erzeugen per `openssl rand -hex 32`. Leere Werte deaktivieren den jeweiligen Schutz. MCP reicht den API-Token intern weiter.

Eine `.env` kann über `--env-file`, Compose `env_file` oder systemd `EnvironmentFile` injiziert werden. Bare Metal liest sie auch direkt. Umgebungsvariablen überschreiben die Dateien. `ENV_FILE` und `CONFIG_FILE` erlauben andere Dateipfade.

`CORS_ORIGINS` enthält erlaubte Browser-Ursprünge, durch Kommas getrennt. Tokens gehören nicht in die WebUI oder `backend.json`. Wasserprofile gelten für die ganze Instanz; ohne Token können deren Nutzer sie gemeinsam ändern.

## Schnittstellen

| Adresse | Funktion |
| --- | --- |
| `/api` | REST-Übersicht. |
| `/api/openapi.json` | OpenAPI-Beschreibung. |
| `/api/fertilizers?search=Hakaphos` | Dünger suchen. |
| `/api/fertilizers/{id}` | Dünger lesen. |
| `/api/calculate` | Eine Mischung berechnen. |
| `/api/calculate/batch` | Bis zu 50 Mischungen vergleichen. |
| `/api/profiles` | Wasserprofile lesen oder anlegen. |
| `/api/profiles/{id}` | Profil lesen, ersetzen oder löschen. |
| `/graphql` | GraphQL-Abfragen und Profilmutationen. |
| `/mcp` | MCP über Streamable HTTP. |

Lokal liegt MCP auf seinem eigenen Port. Beim Worker liegen alle Pfade auf derselben Adresse. Für lokale stdio-Clients startet `node src/mcp-stdio.mjs`; `API_URL` setzt bei Bedarf die REST-Adresse.

Dosen gelten in `g/l` oder `ml/l`, Ergebnisse in `mg/l`. `volume_l` berechnet zusätzlich die benötigten Gesamtmengen. Katalogwerte sind elementare Nährstoffmengen pro g beziehungsweise ml. Eigene Dünger sind über `custom: {name, unit, nutrients}` möglich; `nutrients` verwendet ebenfalls mg/g oder mg/ml.

Ohne `profile_id` greift das Standardprofil. Ohne gespeichertes Profil funktioniert die Rechnung mit den Düngerwerten allein. `use_default_profile: false` unterdrückt das Standardprofil. Inline-Wasser überschreibt die automatische Auswahl. Härte gilt in °dH, `ks` in mmol/l. Härte allein liefert keine Calcium-/Magnesium-Aufteilung; unbekannte Wasserwerte werden ausgewiesen. `dilution_percent` bezeichnet den Anteil nährstofffreien Verdünnungswassers.

Die Rundung entspricht der WebUI: drei Nachkommastellen je Beitrag. Nitrat aus Wasser wird zusätzlich als bekannter Nitratstickstoff ausgewiesen.

```sh
curl -H 'Content-Type: application/json' \
  --data-binary @examples/mixture.json \
  https://duengerrechner.safrano9999.workers.dev/api/calculate
```

Bei aktivem Schutz zusätzlich `Authorization: Bearer <Token>` senden. Weitere Beispiele stehen in `examples/`.

## ChatGPT

MCP-URL: `https://duengerrechner.safrano9999.workers.dev/mcp`.
Authentication: `None`, solange kein MCP-Bearer-Token gesetzt ist.
MCP `2026-07-28` und ältere Clients werden unterstützt.

## Cloudflare und GitHub Pages

Die genaue Einrichtung steht in [CLOUDFLARE-WORKER-SKILL.md](../CLOUDFLARE-WORKER-SKILL.md).

Der Worker liefert WebUI, REST, GraphQL und MCP aus. D1 speichert Wasserprofile. GitHub Pages liefert dieselbe statische WebUI; `backend.example.json` setzt deren API-/MCP-Links zum Worker. Eigene Ziele stehen in der ignorierten `backend.json` oder den Build-Variablen `PUBLIC_API_URL` und `PUBLIC_MCP_URL`. Der Browserrechner funktioniert weiterhin lokal ohne API-Aufruf.

## Prüfung

```sh
npm test
npm run worker:check
```

Die Tests prüfen Rechenwerte, Wasserprofile, Authentifizierung, GraphQL, den offiziellen MCP-Client, FastAPI, Supergateway und die erzeugten Konfigurationen.

```sh
npx --no-install wrangler d1 migrations apply duengerrechner-profiles --local --config wrangler.example.jsonc
npx --no-install wrangler dev --local --config wrangler.example.jsonc
node scripts/smoke.mjs http://127.0.0.1:8787 --profiles
```

`--profiles` legt ein temporäres Testprofil an und entfernt es wieder.
