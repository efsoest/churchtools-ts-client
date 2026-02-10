# 🚀 Projekt-Spezifikation: churchtools-ts-client

## 1. Vision & Zielsetzung

Entwicklung einer modernen, typsicheren TypeScript-Library zur Interaktion mit der ChurchTools API.

- **Framework-Agnostisch:** Läuft in Bun, Node.js, Deno und im Browser.
- **Typsicher:** Automatisierte Generierung der Datenmodelle aus der `swagger.json`.
- **Standard-basiert:** Nutzt die native `fetch` API (kein Axios).
- **Open-Source Ready:** Klare Struktur, Dokumentation und einfache Erweiterbarkeit.

## 2. Technischer Stack

- **Runtime/Tooling:** [Bun](https://bun.sh) für Development, Testing und Scripts.
- **Sprache:** TypeScript (Strict Mode).
- **Code-Generierung:** `@openapitools/openapi-generator-cli` mit dem `typescript-fetch` Generator.
- **Bundling:** `tsup` (für ESM, CJS und d.ts Exporte).
- **Testing:** `Vitest`.

## 3. Architektur-Design

### A. Layer-Struktur

1. **Generated Layer (`/src/generated`):** Vollständig automatischer Code aus der OpenAPI-Spec. Dieser wird niemals manuell editiert.
2. **Core Layer (`/src/core`):** Enthält die Authentifizierungs-Logik, Middleware/Interceptors und die Basis-Konfiguration.
3. **Client Layer (`/src/client.ts`):** Die öffentliche API der Library, die den generierten Code mit der Auth-Logik verbindet.

### B. Authentifizierungs-Konzept

Basierend auf der Analyse des offiziellen Clients muss die Library folgende Logik implementieren:

- **Token-to-Session Bridge:** Automatischer Aufruf von `/whoami?login_token=...`, um eine Session zu initiieren.
- **Header-Management:** Automatisches Setzen des `X-OnlyAuthenticated: 1` Headers.
- **Session-Recovery:** Interceptor, der auf `401 Unauthorized` reagiert ODER auf `200 OK` mit dem JSON-Inhalt `{ message: 'Session expired!' }`.

## 4. Implementierungs-Phasen (TODO-Liste)

### Phase 1: Projekt-Setup

- [ ] Initialisiere Repository mit `bun init`.
- [ ] Konfiguriere `tsconfig.json` für moderne ESM-Ausgabe.
- [ ] Setup `tsup` für das Packaging der Library.
- [ ] Erstelle Ordnerstruktur: `src/generated`, `src/core`, `src/utils`.

### Phase 2: OpenAPI-Generierung

- [ ] Hinterlege die aktuelle `swagger.json` im Root.
- [ ] Erstelle ein Script `generate-api.sh`, das den Generator mit folgenden Parametern aufruft:
- Generator: `typescript-fetch`
- Additional Properties: `typescriptThreePlus=true`, `useSingleRequestParameter=true`.

- [ ] Validiere, dass die generierten Interfaces alle ChurchTools-Modelle (Events, Personen etc.) enthalten.

### Phase 3: Der "Smart" Client (Core)

- [ ] **AuthInterceptor:** Implementiere eine Logik, die Anfragen abfängt und ggf. den Token-Login durchführt.
- [ ] **Rate-Limiting:** Implementiere einen Backoff-Mechanismus bei Status `429` (Rate Limit reached), wie im offiziellen Client vorgesehen.
- [ ] **Agnostic Cookie Handling:** Da `fetch` im Browser Cookies automatisch handhabt, in Bun/Node aber nicht, muss der Client die Möglichkeit bieten, einen externen `cookie-jar` zu injizieren oder Header manuell zu verwalten.

### Phase 4: Testing & Qualität

- [ ] Erstelle Mock-Tests für den Login-Flow.
- [ ] Teste die Library in einer Bun-Umgebung und simuliere eine Browser-Umgebung.

## 5. Spezielle Logik-Anforderungen (Referenz aus offiziellen Quellen)

Die KI muss beim Erstellen der Logik folgende Punkte aus `churchtoolsClient.ts` beachten:

- **CSRF-Handling:** Bei Datei-Uploads (POST/PUT) muss vorab ein CSRF-Token von `/csrftoken` geholt werden.
- **Status-Handling:** ChurchTools sendet manchmal Fehler innerhalb von `200 OK` Antworten (z. B. "Session expired!"). Der Client muss den Body scannen.
- **Abbruch-Signale:** Unterstützung von `AbortController` für Timeouts (Default 15s).

## 6. Veröffentlichung

- [ ] Konfiguriere `package.json` mit `exports`, `types` und `files`.
- [ ] Erstelle eine GitHub Action für automatische NPM-Veröffentlichung bei neuen Tags.
