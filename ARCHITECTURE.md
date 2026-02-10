# Architektur und API-Oberflaeche

Stand: 2026-02-10

Dieses Dokument beschreibt die Ziel-Architektur und die oeffentliche API des
Pakets `churchtools-ts-client` verbindlich.

## Architekturziele

- Klare Trennung zwischen generiertem und handgeschriebenem Code.
- Typsichere Nutzung der ChurchTools-OpenAPI ueber stabile Package-Entry-Points.
- Runtime-unabhaengiger Transport mit kontrollierbarer Middleware-Pipeline.
- Minimale externe Abhaengigkeiten im Laufzeitpfad.

## Layering

1. Generated Layer: `src/generated/openapi`
   - Komplett aus `swagger.json` erzeugt.
   - Wird nicht manuell editiert.
2. Core Layer: `src/core`
   - Enthaeit Transport, Fehler, Auth/Session, Cookies, CSRF, Rate-Limit.
   - Kapselt ChurchTools-spezifische Laufzeitlogik.
3. Client Layer: `src/client.ts`
   - Oeffentliche Facade (`ChurchToolsClient`) fuer Consumer.
   - Verbindet Generated APIs mit dem Core-Transport.

## Oeffentliche Package-Oberflaeche

### Root-Entry (`churchtools-ts-client`)

- `ChurchToolsClient`
- `ChurchToolsClientConfig`
- `ChurchToolsApiConstructor`
- Core-Fehlertypen (`ChurchToolsHttpError`, `ChurchToolsTimeoutError`, ...)
- Erweiterungspunkte (`ChurchToolsMiddleware`, `FetchLike`, ...)
- Low-Level Middleware-Factories (`createSessionAuthMiddleware`, ...)

Quelle: `src/index.ts`

### Generated-Entry (`churchtools-ts-client/generated`)

- Re-Export des OpenAPI-Runtime-Layers, API-Klassen und Models
- Quelle: `src/generated/index.ts` -> `src/generated/openapi/index.ts`

Hinweis: Dieser Entry ist fuer API-Operationen gedacht (z. B. `PersonApi`).

## Request-Lebenszyklus

`ChurchToolsClient` baut intern eine Middleware-Kette in fester Reihenfolge:

1. Session-Auth Middleware (`auth`)
2. Cookie-Session Middleware (`cookies`)
3. CSRF Middleware (`csrf`)
4. Rate-Limit Middleware (`rate-limit`)
5. Benutzerdefinierte Middleware (`config.middleware`)

Danach erfolgt der eigentliche `fetch`-Call.

### Reihenfolge-Invariante

Diese Reihenfolge ist absichtlich so gewaehlt:

- Auth zuerst, damit Session-Recovery frueh greift.
- Cookies vor CSRF, damit Token-Fetch bereits mit Session arbeitet.
- CSRF vor Rate-Limit, damit retries denselben Request-Kontext erhalten.
- Custom Middleware zuletzt, damit projektspezifisches Verhalten auf dem finalen
  Request-Kontext aufbauen kann.

## Sicherheitsinvarianten

- CSRF-Token werden nur fuer same-origin mutierende Requests injiziert.
- `credentials: 'omit'` verhindert Cookie-Injektion und Cookie-Persistierung.
- Host-only Cookies bleiben host-only und werden nicht an Subdomains gesendet.
- Session-Recovery auf `401` und auf ChurchTools-Sentinel
  `200 + { "message": "Session expired!" }`.

## Fehler- und Retry-Modell

- Nicht-2xx Responses -> `ChurchToolsHttpError`
- Timeout via AbortController -> `ChurchToolsTimeoutError`
- Sonstige Transportfehler -> `ChurchToolsRequestError`
- Session-Retry: maximal ein transparenter Retry pro Request
- 429-Retry: konfigurierbar, standardmaessig ein Retry mit Backoff

## Erweiterungsregeln

- Generated Dateien nicht manuell patchen.
- Generator-Inkompatibilitaeten nur in `scripts/postprocess-generated.ts` beheben.
- Neue Laufzeitfeatures im Core Layer implementieren, nicht im Generated Layer.
- API-Flaechen-Aenderungen nur ueber `src/index.ts` und `package.json`-Exports.

## Kompatibilitaetsregeln

- SemVer fuer oeffentliche Exports.
- Breaking Changes nur ueber Major-Version.
- Security-Fixes duerfen Verhalten absichern, solange API-Signaturen stabil
  bleiben.
