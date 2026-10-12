---
name: deploy-duengerrechner-worker
description: Richte die bestehende Düngerrechner-WebUI samt REST, GraphQL, MCP und D1 auf Cloudflare Workers ein. Verwende diesen Ablauf für die Einrichtung oder Aktualisierung dieses Repositorys.
---

# Auftrag an den Agenten

Stelle dieses Repository als Cloudflare Worker bereit. Erhalte die ursprüngliche WebUI. Liefere REST unter `/api`, GraphQL unter `/graphql` und MCP über Streamable HTTP unter `/mcp`. MCP verwendet intern REST. D1 speichert die optionalen Wasserprofile.

Die Referenzadresse lautet `https://duengerrechner.safrano9999.workers.dev`. Verwende beim Nachbauen den gewünschten Worker-Namen und die vorhandene Account-Subdomain. Eine eigene Domain ist nicht erforderlich.

## Zugang und Token-Rechte

Verwende den vorhandenen Cloudflare-API-Token aus der vom Nutzer genannten Umgebung. Gib ihn nicht aus. Speichere ihn weder im Repository noch in öffentlichen Worker-Variablen. Er wird nur als `CLOUDFLARE_API_TOKEN` an die Deployment-Prozesse übergeben. Setze außerdem `CLOUDFLARE_ACCOUNT_ID`.

Für die vollständige Ersteinrichtung braucht der Token im Zielaccount:

- **Account → Workers → Admin** auf Produktebene. Das erlaubt die Erstellung des Workers und die Verwaltung seiner Bereitstellungen und Secrets. Editor allein reicht für einen neuen Worker nicht.
- **Account → D1 → Edit**. Das erlaubt Datenbankanlage und Migrationen. D1 allein berechtigt nicht zur Worker-Bereitstellung.
- **Account → Account Settings → Read**, falls der Account über die API gesucht werden soll. Bei bekannter Account-ID entfällt diese Suche.

Ältere Oberflächen nennen die Worker-Berechtigung **Workers Scripts → Edit/Write**. In der aktuellen Rollenoberfläche ist **Workers → Admin** maßgeblich. Beschränke die Rechte auf den gewünschten Account. Für `workers.dev` sind keine DNS- oder Zonenrechte erforderlich.

Bei `401` oder `403` nenne die fehlgeschlagene Operation und deren benötigte Berechtigung. Verlange keinen neuen Token, wenn der vorhandene ergänzt werden kann. Bei einer bereits bestehenden anderen Account-Subdomain benenne sie nicht eigenmächtig um.

Offizielle Referenzen: [Workers-Rollen](https://developers.cloudflare.com/workers/authorization/workers/), [D1-Erstellung](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/), [Workers-Subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/update/).

## Durchführung

1. Lies die Arbeitsvereinbarungen des Zielsystems. Verwende Node.js 24. Installiere mit `npm ci`. Für die vollständigen Tests installiere zusätzlich die Python-Abhängigkeiten in `.venv`, wie in `docs/betrieb.md` beschrieben.
2. Führe `npm test` und `npm run worker:check` aus. Prüfe den unveränderten Rechner und die drei Footer-Links. Baue statische Dateien ausschließlich über `scripts/build-static.mjs`; dadurch bleiben Secrets und Serverdateien außerhalb der öffentlichen Assets.
3. Nutze `./setup.sh --cloudflare` für die example-basierte Konfiguration. Die Cloudflare-Bereitstellung benötigt keine Bare-Metal-Ports. `wrangler.jsonc` bleibt lokal und ignoriert. Die Platzhalter-UUID wird beim nächsten Schritt ersetzt.
4. Setze `WORKERS_SUBDOMAIN` auf die gewünschte oder bestehende Subdomain. Führe `node scripts/cloudflare-setup.mjs` aus. Das Skript prüft die Account-Subdomain, legt sie bei Bedarf an, verwendet oder erstellt `duengerrechner-profiles` und trägt die D1-UUID in `wrangler.jsonc` ein. Prüfe vorher den Worker- und Datenbanknamen in dieser Datei, wenn eine getrennte Instanz gewünscht ist. Überschreibe keine fremde Instanz.
5. Migriere die Datenbank:

   ```sh
   npx --no-install wrangler d1 migrations apply duengerrechner-profiles --remote
   ```

6. Bearer-Schutz ist optional. `config.sh` kann getrennte `API_BEARER_TOKEN` und `MCP_BEARER_TOKEN` per `openssl rand -hex 32` erzeugen. Der erste schützt REST und GraphQL, der zweite MCP. MCP kennt den API-Token intern. Ohne Tokens sind die Schnittstellen einschließlich der gemeinsamen Wasserprofile öffentlich.

   Bei gewünschten Tokens zuerst den Worker mit diesen Secrets bereitstellen, bevor öffentliche Profiländerungen möglich sind. Wrangler kann eine lokale JSON-Datei mit beiden Secrets über `wrangler deploy --secrets-file <Datei>` übernehmen. Erzeuge diese Datei mit Modus `0600`, übernimm nur die beiden Anwendungstokens aus `.env` und lösche die temporäre Datei danach. Der Cloudflare-Deployment-Token gehört niemals hinein. Alternativ lassen sich Secrets für einen bereits eingerichteten Worker über `wrangler secret put` setzen. Bei Aktualisierungen vorhandene Secrets erhalten; Schutz nur auf ausdrücklichen Wunsch entfernen.

7. Ohne neue Secrets bereitstellen:

   ```sh
   npx --no-install wrangler deploy
   ```

8. Prüfe die tatsächliche Deployment-Adresse:

   ```sh
   node scripts/smoke.mjs https://WORKER.ACCOUNT.workers.dev --profiles
   ```

   Bei aktivem Schutz die beiden Anwendungstokens nur über die Prozessumgebung übergeben. Der Test prüft WebUI, REST, GraphQL, MCP und ein temporäres Wasserprofil; dieses wird wieder gelöscht. Prüfe außerdem im Browser die Buttons und eine Rechnung mit Hakaphos Grün und Rot.

9. Setze in `backend.example.json` die öffentlichen `/api`- und `/mcp`-URLs für GitHub Pages. Der Worker liefert seine eigenen Links relativ zur aktuellen Adresse. Halte den GitHub-Button beim tatsächlichen Repository. Tokens bleiben aus allen Links heraus.
10. Aktualisiere die kurze deutsche README erst nach erfolgreicher Live-Prüfung mit der tatsächlichen Adresse. Nenne knapp WebUI, API und MCP sowie verbleibende Einschränkungen. Eine Einrichtung ohne funktionierenden MCP-Tool-Aufruf ist nicht abgeschlossen.

## Betriebsgrenzen

Nutze die bestehende kostenlose Worker-Konfiguration. Aktiviere keine kostenpflichtigen Pläne oder zusätzlichen Dienste ohne Auftrag. Verwende hier D1 ausschließlich für Wasserprofile; der Düngerkatalog und die Rechenlogik bleiben im Repository.

Für das Cloudflare-Deployment sind keine Container-Pulls erforderlich. Verändere deshalb weder Smart1-Inventare noch Container-Storage. Lokale Container-Tests unterliegen weiterhin dem vorhandenen Smart1-Ablauf.
