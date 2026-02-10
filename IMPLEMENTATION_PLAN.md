# Implementierungsplan: churchtools-ts-client

Stand: 2026-02-10

## Ziel

Ein langlebiger, typsicherer TypeScript-Client fuer ChurchTools mit minimalen Abhaengigkeiten, klarer Architektur und reproduzierbarer API-Generierung aus `swagger.json`.

## Arbeitsweise

1. Immer nur ein kleiner, nachvollziehbarer Schritt.
2. Nach jedem Schritt den Status in diesem Dokument aktualisieren.
3. Generierten Code strikt von handgeschriebenem Code trennen.
4. Dependencies in `package.json` immer als gepinnte `^`-Versionen aus `bun.lock` pflegen (kein `latest`).

## Phasen und Status

### Phase 0: Architektur-Fundament

- [x] Anforderungen aus `README.md` und ChurchTools-Sonderfaelle aus `legacy/old-churchtools-client.ts` extrahiert.
- [ ] Ziel-Architektur und API-Oberflaeche schriftlich finalisieren.

### Phase 1: Projekt-Setup

- [x] Projekt mit Bun initialisieren.
- [x] `tsconfig.json` fuer strict TypeScript + Library Build konfigurieren.
- [x] Basisskripte in `package.json` definieren (`build`, `test`, `generate`, `typecheck`).
- [x] Basisordner anlegen (`src/generated`, `src/core`, `src/utils`).

### Phase 2: OpenAPI-Generierung

- [x] Generator-Setup fuer `typescript-fetch` erstellen.
- [x] `generate-api` Skript erstellen und gegen `swagger.json` ausfuehren.
- [x] Sicherstellen, dass generierter Code ohne manuelle Anpassung buildbar ist.

### Phase 3: Core-Client

- [ ] `ChurchToolsClient` als handgeschriebene Facade auf den Generated Layer aufbauen.
- [ ] Token-to-Session-Bridge (`/whoami?login_token=...`) implementieren.
- [ ] Session-Recovery fuer `401` und `200 + { message: "Session expired!" }` implementieren.
- [ ] Rate-Limit-Recovery fuer `429` mit Backoff implementieren.
- [ ] CSRF-Flow fuer mutierende Requests und Upload-Sonderfaelle implementieren.
- [ ] Runtime-agnostisches Cookie/Session-Konzept fuer Browser/Node/Bun definieren.

### Phase 4: Qualitaet

- [ ] Unit-Tests fuer Auth-, Session- und Rate-Limit-Flow erstellen.
- [ ] Mock-gestuetzte Integrationstests fuer Kernpfade erstellen.
- [ ] Strict Typecheck, Build und Test lokal gruen.

### Phase 5: Distribution

- [ ] Package-Exports fuer ESM/CJS/Types finalisieren.
- [ ] Release-Workflow fuer npm (Tag-basierte Publizierung) einrichten.
- [ ] Nutzungsbeispiele und Migrationshinweise dokumentieren.

## Aktueller Schritt

`Phase 3: Ziel-Architektur des Smart Clients finalisieren und Core-Bausteine aufsetzen`

## Arbeitslog

- 2026-02-10: Projektgrundlage mit Bun erstellt, Library-Build (tsup), Strict-TS-Konfiguration und Startstruktur unter `src/` eingerichtet.
- 2026-02-10: Dependencies installiert, `bun run generate` eingerichtet und erfolgreich gegen `swagger.json` ausgefuehrt (ca. 2000 generierte Dateien unter `src/generated/openapi`).
- 2026-02-10: Verifiziert, dass der generierte Code aktuell bekannte TypeScript-Probleme enthaelt (z. B. fehlendes `Null`-Model, doppelte API-Exports, fehlerhafte Helper-Referenzen); diese werden als eigener Architektur-/Stabilisierungs-Schritt behandelt.
- 2026-02-10: Build (`bun run build`), Typecheck (`bun run typecheck`) und Test-Runner (`bun run test`) fuer den handgeschriebenen Layer sind gruen; Generated-Code ist temporaer vom Root-Typecheck ausgeschlossen, bis die Generator-Strategie final ist.
- 2026-02-10: Prettier mit einheitlicher Konfiguration eingefuehrt (`singleQuote: true`, `trailingComma: all`), Format-Skripte (`format:check`, `format:write`) angelegt und einmal projektweit ausgefuehrt.
- 2026-02-10: Stabile Generator-Pipeline eingefuehrt (`generate:all = generate -> postprocess:generated -> typecheck:generated`) inkl. automatischer Fixes fuer bekannte OpenAPI-Generator-Inkompatibilitaeten.
- 2026-02-10: Test-Setup von `Vitest` auf integriertes `bun test` umgestellt, um Abhaengigkeiten zu reduzieren.

## Erkenntnisse aus Legacy-Referenz (fuer Umsetzung verbindlich)

- Login-Recovery nutzt `/whoami` mit `login_token` (und optional `user_id`, `with_session`).
- Auth darf nicht nur auf Statuscode vertrauen: auch `200` mit `message: "Session expired!"` behandeln.
- `X-OnlyAuthenticated: 1` bei authentifizierten Requests setzen.
- Bei alten/Upload-Pfaden CSRF-Token ueber `/csrftoken` laden und Header setzen.
- Timeouts per `AbortController` (Default 15s) und Rate-Limit-Recovery fuer `429`.
