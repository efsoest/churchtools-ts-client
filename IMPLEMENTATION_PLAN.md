# Implementierungsplan: churchtools-ts-client

Stand: 2026-02-10

## Ziel

Ein langlebiger, typsicherer TypeScript-Client fuer ChurchTools mit minimalen Abhaengigkeiten, klarer Architektur und reproduzierbarer API-Generierung aus `swagger.json`.

## Arbeitsweise

1. Immer nur ein kleiner, nachvollziehbarer Schritt.
2. Nach jedem Schritt den Status in diesem Dokument aktualisieren.
3. Generierten Code strikt von handgeschriebenem Code trennen.
4. Dependencies in `package.json` immer als gepinnte `^`-Versionen aus `bun.lock` pflegen (kein `latest`).
5. Legacy ist funktionale Referenz; bewusst bessere Verhaltensweisen (z. B. 429-Handling) sind erlaubt, wenn dokumentiert und getestet.

## Quellen

- Snapshot-Spec im Repo: `swagger.json`
- Herkunft der Spec: `https://demo.church.tools/system/runtime/swagger/openapi.json`

## Phasen und Status

### Phase 0: Architektur-Fundament

- [x] Anforderungen aus `README.md` und ChurchTools-Sonderfaelle aus `legacy/old-churchtools-client.ts` extrahiert.
- [x] Ziel-Architektur und API-Oberflaeche schriftlich finalisieren.

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

- [x] Core-Transport-Layer (Middleware, Timeout, Fehlernormalisierung) implementieren.
- [x] `ChurchToolsClient` als handgeschriebene Facade auf den Generated Layer aufbauen.
- [x] Token-to-Session-Bridge (`/whoami?login_token=...`) implementieren.
- [x] Session-Recovery fuer `401` und `200 + { message: "Session expired!" }` implementieren.
- [x] Rate-Limit-Recovery fuer `429` mit Backoff implementieren.
- [x] CSRF-Flow fuer mutierende Requests und Upload-Sonderfaelle implementieren.
- [x] Runtime-agnostisches Cookie/Session-Konzept fuer Browser/Node/Bun definieren.

### Phase 4: Qualitaet

- [x] Unit-Tests fuer Auth-, Session- und Rate-Limit-Flow erstellen.
- [x] Mock-gestuetzte Integrationstests fuer Kernpfade erstellen.
- [x] OWASP-Top-10-orientierten Security-Audit fuer handgeschriebenen Core-Code durchfuehren.
- [x] Security-Hardening aus Audit-Findings umsetzen (CSRF-Origin-Guard, Cookie-Credentials-Respect, Host-only-Cookies).
- [x] Security-relevante Code-Stellen mit klaren Security-Kommentaren/JSDoc markieren und Begruendung dokumentieren.
- [x] Security-Regressionstests fuer alle behobenen Findings ergaenzen.
- [x] Strict Typecheck, Build und Test lokal gruen.

### Phase 5: Distribution

- [x] Package-Exports fuer ESM/CJS/Types finalisieren.
- [x] Release-Workflow fuer npm (Tag-basierte Publizierung) einrichten.
- [x] Nutzungsbeispiele und Migrationshinweise dokumentieren.

### Phase 6: Runtime-Validierung

- [x] Reproduzierbaren manuellen End-to-End-Smoke-Test fuer reale ChurchTools-Instanzen bereitstellen.
- [x] Smoke-Test gegen Zielinstanz ausfuehren und Ergebnisprotokoll dokumentieren.

## Aktueller Schritt

`Abgeschlossen: Implementierungsplan-Phasen 0-6`

## Security Findings und Behebungsplan (Stand 2026-02-10)

1. CSRF-Token darf nicht an fremde Origins gesendet werden (hoch)

- Finding: CSRF-Middleware injiziert Token aktuell methodenbasiert, ohne harte Origin-Pruefung.
- Status: [x] umgesetzt
- Behebung:
  - In `src/core/csrf.ts` vor Token-Aufloesung und Header-Injektion zwingend Same-Origin (`request.origin === base.origin`) pruefen.
  - Cross-origin Requests explizit vom CSRF-Handling ausschliessen.
  - Security-Markierung im Code: Kommentar/JSDoc, warum Origin-Guard zwingend ist (Token-Leak-Praevention).
- Tests:
  - Neuer Test in `tests/core/csrf.test.ts`: Cross-origin `POST` darf keinen CSRF-Token laden/injizieren.
  - Negativtest: Same-origin `POST` behaelt bestehendes Verhalten.

2. Cookie-Middleware muss `credentials: 'omit'` respektieren (mittel)

- Finding: Cookie-Header wird aktuell auch dann injiziert, wenn Request explizit keine Credentials senden soll.
- Status: [x] umgesetzt
- Behebung:
  - In `src/core/cookies.ts` im `pre`-Hook bei `credentials === 'omit'` keine Cookie-Injektion.
  - Im `post`-Hook bei `credentials === 'omit'` keine Session-Persistierung aus `Set-Cookie`.
  - Security-Markierung im Code: Kommentar/JSDoc, dass `omit` eine explizite Sicherheits-/Privacy-Intention des Callers ist.
- Tests:
  - Neuer Test in `tests/core/cookies.test.ts`: bei `credentials: 'omit'` wird kein `Cookie`-Header gesetzt.
  - Neuer Test: `Set-Cookie` wird in diesem Modus nicht gespeichert.

3. Host-only-Cookie-Semantik RFC-konform abbilden (niedrig)

- Finding: Cookies ohne `Domain`-Attribut koennen aktuell wie Domain-Cookies wirken.
- Status: [x] umgesetzt
- Behebung:
  - In `src/core/cookies.ts` Cookie-Model um `hostOnly` erweitern.
  - Bei fehlendem `Domain`-Attribut `hostOnly = true`; Match nur bei exaktem Host.
  - Bei vorhandenem `Domain`-Attribut weiterhin Domain-Matching fuer Subdomains.
  - Security-Markierung im Code: Kommentar/JSDoc zur Trennung host-only vs. domain-cookie.
- Tests:
  - Neuer Test in `tests/core/cookies.test.ts`: host-only Cookie wird nicht an Subdomain gesendet.
  - Neuer Test: Domain-Cookie (mit `Domain=`) wird weiterhin an passende Subdomain gesendet.

## Arbeitslog

- 2026-02-10: Projektgrundlage mit Bun erstellt, Library-Build (tsup), Strict-TS-Konfiguration und Startstruktur unter `src/` eingerichtet.
- 2026-02-10: Dependencies installiert, `bun run generate` eingerichtet und erfolgreich gegen `swagger.json` ausgefuehrt (ca. 2000 generierte Dateien unter `src/generated/openapi`).
- 2026-02-10: Verifiziert, dass der generierte Code aktuell bekannte TypeScript-Probleme enthaelt (z. B. fehlendes `Null`-Model, doppelte API-Exports, fehlerhafte Helper-Referenzen); diese werden als eigener Architektur-/Stabilisierungs-Schritt behandelt.
- 2026-02-10: Build (`bun run build`), Typecheck (`bun run typecheck`) und Test-Runner (`bun run test`) fuer den handgeschriebenen Layer sind gruen; Generated-Code ist temporaer vom Root-Typecheck ausgeschlossen, bis die Generator-Strategie final ist.
- 2026-02-10: Prettier mit einheitlicher Konfiguration eingefuehrt (`singleQuote: true`, `trailingComma: all`), Format-Skripte (`format:check`, `format:write`) angelegt und einmal projektweit ausgefuehrt.
- 2026-02-10: Stabile Generator-Pipeline eingefuehrt (`generate:all = generate -> postprocess:generated -> typecheck:generated`) inkl. automatischer Fixes fuer bekannte OpenAPI-Generator-Inkompatibilitaeten.
- 2026-02-10: Test-Setup von `Vitest` auf integriertes `bun test` umgestellt, um Abhaengigkeiten zu reduzieren.
- 2026-02-10: Core-Transport eingefuehrt (Middleware-Hooks, Timeout via AbortController, Fehlernormalisierung) und per Bun-Tests abgesichert.
- 2026-02-10: `ChurchToolsClient` auf Core-Transport umgestellt und API-Facade (`client.api(...)`) fuer Generated APIs eingefuehrt.
- 2026-02-10: Core-Code (`client`, `transport`, `errors`) fuer Lesbarkeit/Wartbarkeit refaktoriert und mit zusaetzlicher JSDoc-Dokumentation versehen.
- 2026-02-10: Auth-/Session-Layer implementiert: automatische `whoami`-Token-Bridge, `X-OnlyAuthenticated`-Header-Management und transparente Session-Recovery fuer `401` sowie `200 + "Session expired!"` (inkl. Bun-Tests).
- 2026-02-10: Rate-Limit-Recovery fuer `429` implementiert (Retry-After + Backoff + Jitter, konfigurierbar im Client) und per Bun-Tests abgesichert.
- 2026-02-10: CSRF-Middleware fuer mutierende Requests implementiert (`/api/csrftoken`-Abruf, Header-Injektion, Refresh nach Session-Retry) und per Bun-Tests abgesichert.
- 2026-02-10: README auf klassische Projektdoku umgestellt (Setup, Nutzung, Scripts, Repo-Workflow); Planungs-/TODO-Inhalte leben ausschliesslich in diesem Implementierungsplan.
- 2026-02-10: Runtime-agnostisches Cookie-/Session-Konzept eingefuehrt (Cookie-Middleware + InMemoryCookieStore, Browser-Auto-Bypass, manuelles Mode-Override) und per Bun-Tests abgesichert.
- 2026-02-10: Security-Audit (OWASP-Top-10-orientiert) ueber den handgeschriebenen Layer durchgefuehrt; drei priorisierte Findings dokumentiert und als Security-Hardening-Backlog in diesem Plan aufgenommen.
- 2026-02-10: Security-Hardening Finding 1 umgesetzt: CSRF-Middleware mit explizitem Same-Origin-Guard abgesichert (security-relevante Code-Markierung in `src/core/csrf.ts`) und Security-Regressionstest fuer Cross-Origin-POST in `tests/core/csrf.test.ts` ergaenzt.
- 2026-02-10: Security-Hardening Finding 2 umgesetzt: Cookie-Middleware respektiert `credentials: 'omit'` strikt in Pre/Post-Hook (security-relevante Code-Markierungen in `src/core/cookies.ts`) und Security-Regressionstests fuer Header-Injektion/Persistierung in `tests/core/cookies.test.ts` ergaenzt.
- 2026-02-10: Security-Hardening Finding 3 umgesetzt: RFC-konforme host-only/domain-cookie Trennung im InMemoryCookieStore eingefuehrt (security-relevante Code-Markierungen in `src/core/cookies.ts`) und Security-Regressionstests fuer Subdomain-Verhalten in `tests/core/cookies.test.ts` ergaenzt.
- 2026-02-10: Mock-gestuetzte Integrationstests fuer die kombinierte Core-Pipeline (`auth + cookies + csrf + 429`) in `tests/integration/core-pipeline.test.ts` ergaenzt; dabei zwei Integrationsluecken geschlossen (CSRF-Refresh trotz vorhandenem Header bei Session-Retry, Entfernen stale Cookie-Header im Auth-Retry-Pfad).
- 2026-02-10: Package-Distribution finalisiert: stabiler Subpath-Export `churchtools-ts-client/generated` eingefuehrt, Build auf duale Entry-Points (`index`, `generated/index`) umgestellt, README-Nutzungsbeispiel auf Package-Imports aktualisiert; Build/Typecheck/Tests sind gruen.
- 2026-02-10: npm-Release-Workflow eingerichtet (`.github/workflows/release.yml`): Tag-Trigger `v*`, Versionsabgleich Tag vs. `package.json`, Quality-Gates (format/typecheck/test/build) und anschliessendes `npm publish` via `NPM_TOKEN`.
- 2026-02-10: README um praxisnahe Consumer-Beispiele erweitert (Grundnutzung, erweiterte Konfiguration, typisierte Fehlerbehandlung) sowie Migrationshinweise vom Legacy-Client auf den neuen API-/Middleware-Ansatz dokumentiert.
- 2026-02-10: Ziel-Architektur und oeffentliche API-Oberflaeche verbindlich in `ARCHITECTURE.md` dokumentiert und im README verlinkt.
- 2026-02-10: Manuellen End-to-End-Smoke-Test (`scripts/smoke-e2e.ts`) eingefuehrt und in README dokumentiert (`bun run smoke:e2e`, erforderliche `CT_*`-Variablen, validierte Pipeline-Invarianten fuer Auth/Cookie/CSRF).
- 2026-02-10: Smoke-Test erfolgreich gegen `https://efss.church.tools` ausgefuehrt (`bun run smoke:e2e` mit `.env`): `GET /api/csrftoken -> 200`, `GET /api/whoami -> 200`, `POST /api/whoami -> 405` (erwartbar fuer diese Probe), alle Pipeline-Checks bestanden (`checks passed`, inkl. whoami-Bridge, Cookie- und CSRF-Injektion).

## Erkenntnisse aus Legacy-Referenz (fuer Umsetzung verbindlich)

- Login-Recovery nutzt `/whoami` mit `login_token` (und optional `user_id`, `with_session`).
- Auth darf nicht nur auf Statuscode vertrauen: auch `200` mit `message: "Session expired!"` behandeln.
- `X-OnlyAuthenticated: 1` bei authentifizierten Requests setzen.
- Bei alten/Upload-Pfaden CSRF-Token ueber `/csrftoken` laden und Header setzen.
- Timeouts per `AbortController` (Default 15s) und Rate-Limit-Recovery fuer `429`.
