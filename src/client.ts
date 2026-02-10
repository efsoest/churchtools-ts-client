export type ChurchToolsClientConfig = {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class ChurchToolsClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(config: ChurchToolsClientConfig) {
    if (!config.baseUrl) {
      throw new Error('`baseUrl` is required.');
    }

    this.#baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.#fetch = config.fetch ?? fetch;
    this.#timeoutMs = config.timeoutMs ?? 15_000;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  get fetchImpl(): typeof fetch {
    return this.#fetch;
  }
}
