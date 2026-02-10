# churchtools-ts-client

Typsicherer inoffizieller TypeScript-Client für die [ChurchTools API](https://demo.church.tools/api) auf Basis von `fetch` und OpenAPI-Codegenerierung.

## Projektstatus

Dieses Repository trennt klar zwischen:

- Generated Layer (`src/generated/openapi`): aus `swagger.json` erzeugter Code
- Core Layer (`src/core`): eigene Middleware und Laufzeitlogik
- Client Layer (`src/client.ts`): öffentliche Facade

Die verbindliche Ziel-Architektur und API-Oberflaeche ist in [ARCHITECTURE.md](./ARCHITECTURE.md) dokumentiert.

## OpenAPI-Quelle (`swagger.json`)

Die im Repo eingecheckte `swagger.json` stammt von:

- [https://demo.church.tools/system/runtime/swagger/openapi.json](https://demo.church.tools/system/runtime/swagger/openapi.json)

Beispiel zum Aktualisieren der lokalen Spec:

```bash
curl -L "https://demo.church.tools/system/runtime/swagger/openapi.json" -o swagger.json
```

Hinweis: Nach einer neuen Spec immer die komplette Generierungs-Pipeline laufen lassen (`bun run generate:all`).

## Was der Client aktuell abdeckt

- Timeout-Handling pro Request (`AbortController`)
- Normalisierte Fehlertypen (`ChurchToolsHttpError`, `ChurchToolsTimeoutError`, `ChurchToolsRequestError`)
- Session-Auth mit `whoami`-Bridge (`login_token`) inkl. Recovery bei:
  - `401`
  - `200` mit `{ "message": "Session expired!" }`
- Automatischer `X-OnlyAuthenticated`-Header
- Runtime-agnostisches Cookie-/Session-Handling (Cookie-Middleware mit Store-Abstraktion)
- Rate-Limit-Recovery für `429` (`Retry-After` + konfigurierbares Backoff)
- CSRF-Handling für mutierende Requests via `/api/csrftoken`

## Entwickler-Workflow

Voraussetzung: [Bun](https://bun.sh)

```bash
bun install
```

Typischer Ablauf bei API- oder Core-Änderungen:

```bash
# 1) OpenAPI generieren + postprocessen + generated typecheck
bun run generate:all

# 2) Handgeschriebenen Code pruefen
bun run format:check
bun run typecheck
bun run test

# 3) Build der Library (ESM, CJS, d.ts)
bun run build
```

## Skripte

- `bun run build`: Library-Build mit `tsup`
- `bun run typecheck`: TypeScript-Check für handgeschriebenen Layer
- `bun run typecheck:generated`: TypeScript-Check für generated Layer
- `bun run test`: Tests mit integriertem `bun test`
- `bun run test:watch`: Tests im Watch-Modus
- `bun run smoke:e2e`: Manueller End-to-End-Smoke-Test gegen echte ChurchTools-Instanz
- `bun run generate`: OpenAPI-Generator gegen `swagger.json`
- `bun run postprocess:generated`: deterministische Patches für generated Code
- `bun run generate:all`: `generate -> postprocess:generated -> typecheck:generated`
- `bun run format:check`: Prettier Check
- `bun run format:write`: Prettier Write

## Release (Maintainer)

- Der Release-Workflow liegt in `.github/workflows/release.yml`.
- Trigger: manueller Start ueber GitHub Actions (`workflow_dispatch`) mit Input `release_tag` (z. B. `v0.1.0`).
- Schutz: Der Workflow checkt den angegebenen Tag aus und bricht ab, wenn Tag und `package.json`-Version nicht zusammenpassen.
- Publishing: npm Trusted Publishing (OIDC), kein `NPM_TOKEN` im Repo notwendig.

Einmaliges Setup fuer Trusted Publishing in npm:

1. In npm die Package-Settings oeffnen (`churchtools-ts-client`).
2. Unter Trusted Publishers einen GitHub-Publisher fuer dieses Repo und den Workflow `.github/workflows/release.yml` anlegen.
3. Danach Release manuell starten und als `release_tag` den semver-Tag (`vX.Y.Z`) angeben.

## End-to-End Smoke-Test (manuell)

Der Smoke-Test ist fuer reale Zielinstanzen gedacht und prueft reproduzierbar:

- `whoami`-Bridge mit `login_token`
- Session-/Cookie-Aufbau
- `X-OnlyAuthenticated` fuer geschuetzte Requests
- CSRF-Injektion bei mutierendem Request

Pflicht-Umgebungsvariablen:

- `CT_BASE_URL` (z. B. `https://example.church.tools`)
- `CT_LOGIN_TOKEN`

Optionale Umgebungsvariablen:

- `CT_LOGIN_PERSON_ID`
- `CT_TIMEOUT_MS` (Default `15000`)
- `CT_SMOKE_MUTATION_PATH` (Default `/api/whoami`)
- `CT_SMOKE_MUTATION_BODY` (Default `{}`)

Beispiel:

```bash
CT_BASE_URL="https://example.church.tools" \
CT_LOGIN_TOKEN="..." \
bun run smoke:e2e
```

Hinweis: Der mutierende Smoke-Request kann bewusst mit `4xx` antworten; fuer den
Smoke-Test ist entscheidend, dass die Middleware-Pipeline (Cookie/CSRF/Auth)
korrekt angewendet wurde.

## Generierungs-Pipeline im Detail

1. `scripts/generate-api.ts` erzeugt den OpenAPI-Layer in `src/generated/openapi`.
2. `scripts/postprocess-generated.ts` behebt bekannte Generator-Inkompatibilitaeten.

### Überblick: Was das Postprocessing macht

Das Script `scripts/postprocess-generated.ts` korrigiert aktuell bekannte Generator-Probleme für die ChurchTools-Spec:

1. **Fehlendes `Null`-Model ergänzen:** Erzeugt `src/generated/openapi/models/Null.ts` und ergänzt den Export in `src/generated/openapi/models/index.ts`.
2. **Konfliktfreie API-Barrel-Exports:** Schreibt `src/generated/openapi/apis/index.ts` neu und exportiert nur API-Klassen statt `export *`, um Namenskollisionen zu vermeiden.
3. **Ungültige `objectToJSON(...)`-Verwendungen ersetzen:** Patcht fehlerhafte FormData-Serialisierung in generierten API-Dateien.
4. **Fehlende `instanceOf...`-Guards für Alias-Modelle ergänzen:** Fügt Guards nach, wenn der Generator sie nicht emittiert.
5. **Doppelte Date-Serialisierungsblöcke bereinigen:** Vereinheitlicht fehlerhafte doppelte `instanceof Date`-Pfade.

Wichtig:

- Dateien unter `src/generated/openapi` werden nicht manuell editiert.
- Fixes an generated Output gehören in `scripts/postprocess-generated.ts`.

## Nutzung

Als Package-Consumer (nach Publish):

```ts
import { ChurchToolsClient } from 'churchtools-ts-client';
import { PersonApi } from 'churchtools-ts-client/generated';

const client = new ChurchToolsClient({
  baseUrl: 'https://example.church.tools',
  loginToken: process.env.CT_LOGIN_TOKEN,
  forceSession: true,
});

const personApi = client.api(PersonApi);
```

Im Repo waehrend der Entwicklung kannst du alternativ direkt aus `src/` importieren.

### Fehlerbehandlung

```ts
import {
  ChurchToolsClient,
  ChurchToolsHttpError,
  ChurchToolsRequestError,
  ChurchToolsTimeoutError,
} from 'churchtools-ts-client';

const client = new ChurchToolsClient({
  baseUrl: 'https://example.church.tools',
  timeoutMs: 15000,
});

try {
  await client.fetchImpl('https://example.church.tools/api/whoami');
} catch (error) {
  if (error instanceof ChurchToolsHttpError) {
    console.error('HTTP Fehler', error.status, error.url);
  } else if (error instanceof ChurchToolsTimeoutError) {
    console.error('Timeout', error.timeoutMs, error.url);
  } else if (error instanceof ChurchToolsRequestError) {
    console.error('Transportfehler', error.message);
  }
}
```

### Erweiterte Konfiguration

```ts
import { ChurchToolsClient } from 'churchtools-ts-client';

const client = new ChurchToolsClient({
  baseUrl: 'https://example.church.tools',
  loginToken: process.env.CT_LOGIN_TOKEN,
  forceSession: true,
  timeoutMs: 15000,
  cookies: { mode: 'manual' },
  csrf: {},
  rateLimit: {
    maxRetries: 1,
    baseDelayMs: 30000,
  },
});
```

## Migration von `churchtools-js-client` (Legacy)

1. Initialisierung
   Legacy: `new ChurchToolsClient(baseUrl, loginToken, loadCSRFForOldApi)`
   Neu: `new ChurchToolsClient({ baseUrl, loginToken, csrf: {} })`
2. Force-Session
   Legacy: `setForceSession(true)`
   Neu: `new ChurchToolsClient({ ..., forceSession: true })`
3. Timeout
   Legacy: `setRequestTimeout(ms)`
   Neu: `new ChurchToolsClient({ ..., timeoutMs: ms })`
4. Rate-Limit
   Legacy: `setRateLimitTimeout(ms)`
   Neu: `new ChurchToolsClient({ ..., rateLimit: { baseDelayMs: ms } })`
5. Request-Aufrufe
   Legacy: proprietaere Helper wie `oldApi(module, func, params)`
   Neu: generierte API-Klassen via `client.api(...)` und OpenAPI-Operations
6. Fehlerverhalten
   Legacy: Axios-/Interceptor-Fehlerbilder
   Neu: klar typisierte Fehler (`ChurchToolsHttpError`, `ChurchToolsTimeoutError`, `ChurchToolsRequestError`)
7. Middleware/Hooking
   Legacy: direkte Axios-Interceptors
   Neu: Transport-Middleware ueber `ChurchToolsClientConfig.middleware`

## Referenz

Funktionale Referenz für ChurchTools-Spezifika war der offizielle JavaScript Client in https://github.com/churchtools/churchtools-js-client.

## Disclaimer

Der Code hier steht in keinerlei offizieller Verbindung zu Churchtools. Ein Großteil des Codes und der Dokumentation wurde unter Zuhilfenahme von KI generiert. Auch wenn der KI-generierte Code nach bestem Wissen und Gewissen geprüft wurde, kann es durchaus sein, dass die Implementierung Bugs oder sogar Sicherheitslücken enthält. Verwendung bitte auf eigene Gefahr :)
