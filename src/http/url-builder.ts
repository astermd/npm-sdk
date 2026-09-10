/** Query string parameters accepted by {@link UrlBuilder.build}. */
export type QueryParams = Record<string, string | number | boolean>;

/**
 * Percent-encodes a value the way PHP's `rawurlencode()` does.
 *
 * `encodeURIComponent()` leaves `!`, `'`, `(`, `)`, and `*` unescaped, which
 * `rawurlencode()` escapes. The difference matters because URLs built by the PHP
 * SDK and by this one are compared against the same server and against each
 * other in tests.
 */
function rawUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Serialises query parameters the way PHP's `http_build_query()` does.
 *
 * That means RFC 1738 encoding: a space becomes `+`, and `~` becomes `%7E`.
 * `URLSearchParams` agrees on the space but not on the tilde, so this is written
 * out rather than delegated. Booleans serialise as `1` and `0`, matching PHP's
 * coercion of `true` and `false`.
 */
function buildQuery(query: QueryParams): string {
  return Object.entries(query)
    .map(([key, value]) => {
      const raw = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);

      return `${urlEncode(key)}=${urlEncode(raw)}`;
    })
    .join('&');
}

function urlEncode(value: string): string {
  return rawUrlEncode(value).replace(/%20/g, '+').replace(/~/g, '%7E');
}

/**
 * Builds fully-qualified HTTPS request URLs following the `/v1/{service}/{path}`
 * convention.
 *
 * Every AsterMD endpoint lives under `https://{host}/v1/{service}/{path}`, where
 * `{service}` is `auth`, `sales`, or `platform`. This class is the one place that
 * convention is encoded, so resources never construct URLs and the SDK can never
 * be handed a full URL by a consumer.
 *
 * Path placeholders such as `{id}` are substituted and percent-encoded; query
 * parameters are appended with PHP-compatible encoding so a URL built here is
 * byte-identical to the one the PHP SDK would build for the same call.
 */
export class UrlBuilder {
  readonly #baseHost: string;

  /**
   * @param baseHost Bare hostname to prepend, e.g. `api.astermd.com`.
   */
  constructor(baseHost: string) {
    this.#baseHost = baseHost;
  }

  /**
   * Constructs the fully-qualified URL for a service and path.
   *
   * Placeholder tokens in `path` - `{id}`, `{session}`, `{form_json_identifier}`
   * - are replaced with the matching values from `pathParams`, percent-encoded.
   * A placeholder with no matching entry is left untouched rather than guessed
   * at, which surfaces the programming error in the request URL. Non-empty
   * `query` entries are serialised and appended after `?`.
   *
   * @param service Service segment, e.g. `sales`, `auth`, `platform`.
   * @param path Path relative to `/v1/{service}`, with optional `{placeholder}`
   *             tokens.
   * @param pathParams Placeholder name → replacement value.
   * @param query Query string parameters.
   * @returns The fully-qualified URL.
   */
  build(
    service: string,
    path: string,
    pathParams: Record<string, string | number> = {},
    query: QueryParams = {},
  ): string {
    let resolved = path;

    for (const [key, value] of Object.entries(pathParams)) {
      resolved = resolved.split(`{${key}}`).join(rawUrlEncode(String(value)));
    }

    const url = `https://${this.#baseHost}/v1/${service}${resolved}`;
    const queryString = Object.keys(query).length > 0 ? buildQuery(query) : '';

    return queryString === '' ? url : `${url}?${queryString}`;
  }
}
