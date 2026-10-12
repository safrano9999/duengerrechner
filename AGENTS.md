# Projektvereinbarungen

- `config.sh` bleibt unverändert aus `../SCRIPTS/safrano9999/config/config.sh`. Auf dieser Infrastruktur muss es ein Hardlink auf die SOT sein. Projektspezifische Logik gehört in `setup.sh` und die Example-Dateien. Git überträgt den Dateiinhalt; `setup.sh` stellt den Hardlink wieder her, wenn die lokale SOT vorhanden ist.
- Die SOT für `.github/workflows/` und `.github/scripts/` liegt in `../SCRIPTS/githubactions/duengerrechner/`. Änderungen dort vornehmen und mit `python3 ../SCRIPTS/githubactions/sync.py duengerrechner` synchronisieren. Gemeinsame Example-Releases verwenden `_shared/scripts/examplefiles-githubaction.py`.
- Eigene Laufzeit-Images heißen `ghcr.io/safrano9999/duengerrechner:latest`. Versions-Tags bleiben zusätzlich erhalten. Der vorhandene Supergateway-Pin bleibt bestehen.
- Auf core/rafael keine direkten oder impliziten Image-Pulls. Dafür ausschließlich den beauftragten Smart1-Ablauf verwenden. Das Inventar nicht ohne Auftrag ergänzen.
- Die WebUI behält Darstellung und lokale Rechenfunktion des Originals. Nur die Footer-Links für API, MCP und GitHub kommen hinzu.
- README: kurze deutsche Sätze. Setup- und `ln -s`-Anleitungen erscheinen am Ende von `setup.sh`; Details gehören in `docs/betrieb.md`.
