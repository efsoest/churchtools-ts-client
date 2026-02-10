# churchtools-ts-client

Typsicherer inoffizieller TypeScript-Client für die [ChurchTools API](https://demo.church.tools/api) auf Basis von `fetch` und OpenAPI-Codegenerierung.

## Projektstatus

Dieses Repository trennt klar zwischen:

- Generated Layer (`src/generated/openapi`): aus `swagger.json` erzeugter Code
- Core Layer (`src/core`): eigene Middleware und Laufzeitlogik
- Client Layer (`src/client.ts`): öffentliche Facade

Die schrittweise Umsetzung und der aktuelle Arbeitsstand liegen in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).

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
- `bun run generate`: OpenAPI-Generator gegen `swagger.json`
- `bun run postprocess:generated`: deterministische Patches für generated Code
- `bun run generate:all`: `generate -> postprocess:generated -> typecheck:generated`
- `bun run format:check`: Prettier Check
- `bun run format:write`: Prettier Write

## Release (Maintainer)

- Der Release-Workflow liegt in `.github/workflows/release.yml`.
- Trigger: Push eines Git-Tags im Format `v*` (z. B. `v0.1.0`).
- Schutz: Der Workflow bricht ab, wenn Tag und `package.json`-Version nicht zusammenpassen.
- Voraussetzung: GitHub-Secret `NPM_TOKEN` mit Publish-Rechten fuer npm.

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

## Referenz

Funktionale Referenz für ChurchTools-Spezifika war der offizielle JavaScript Client in https://github.com/churchtools/churchtools-js-client.

## Disclaimer

Der Code hier steht in keinerlei offizieller Verbindung zu Churchtools. Ein Großteil des Codes und der Dokumentation wurde unter Zuhilfenahme von KI generiert. Auch wenn der KI-generierte Code nach bestem Wissen und Gewissen geprüft wurde, kann es durchaus sein, dass die Implementierung Bugs oder sogar Sicherheitslücken enthält. Verwendung bitte auf eigene Gefahr :)
