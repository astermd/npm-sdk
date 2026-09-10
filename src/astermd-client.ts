import { InMemoryTokenStore } from './auth/in-memory-token-store.js';
import { TokenManager } from './auth/token-manager.js';
import type { TokenStore } from './auth/token-store.js';
import { Config } from './config.js';
import { FetchHttpClient } from './http/fetch-http-client.js';
import type { HttpClient } from './http/http-client.js';
import { LogRedactor } from './http/log-redactor.js';
import { LoggingHttpClient, type DebugSink } from './http/logging-http-client.js';
import { Transport } from './http/transport.js';
import { UrlBuilder } from './http/url-builder.js';
import { DailyFileLogSink } from './log/daily-file-log-sink.js';
import { Carts } from './resource/carts.js';
import { Categories } from './resource/categories.js';
import { Channels } from './resource/channels.js';
import { CheckoutEvents } from './resource/checkout-events.js';
import { DoctorsNetworks } from './resource/doctors-networks.js';
import { Geo } from './resource/geo.js';
import { IntakeSubmissions } from './resource/intake-submissions.js';
import { LabTests } from './resource/lab-tests.js';
import { Medications } from './resource/medications.js';
import { Opportunities } from './resource/opportunities.js';
import { Patients } from './resource/patients.js';
import { Products } from './resource/products.js';
import { Sessions } from './resource/sessions.js';
import { Shippings } from './resource/shippings.js';
import { Teleforms } from './resource/teleforms.js';
import { Treatments } from './resource/treatments.js';
import { Verification } from './resource/verification.js';

/** Options accepted by {@link AsterMDClient}. */
export interface AsterMDClientOptions {
  /** OAuth2 client ID issued from your AsterMD dashboard. */
  clientId: string;
  /**
   * OAuth2 client secret. Load it from an environment variable or a secrets
   * manager - never commit it and never ship it to a browser.
   */
  clientSecret: string;
  /** Bare API hostname, no scheme and no path. Defaults to `api.astermd.com`. */
  baseHost?: string;
  /** Client used for every request. Defaults to {@link FetchHttpClient}. */
  httpClient?: HttpClient;
  /** Where the bearer token is cached. Defaults to {@link InMemoryTokenStore}. */
  tokenStore?: TokenStore;
  /** Per-request timeout in seconds. Must be >= 1. Defaults to 10. */
  timeoutSeconds?: number;
  /**
   * Turn on debug logging of every request and response. Requires `debugFile` or
   * `debugSink`. Defaults to `false`.
   */
  debug?: boolean;
  /**
   * Base path for daily log files, e.g. `/var/log/astermd/sdk.log`. Dated
   * filenames are derived from it. Ignored when `debugSink` is given.
   */
  debugFile?: string;
  /**
   * Receives each formatted entry instead of a file. Supplying this makes
   * retention and delivery yours.
   */
  debugSink?: DebugSink;
  /** IANA time zone for log timestamps and daily filenames. Defaults to `UTC`. */
  debugTimezone?: string;
  /**
   * Mask credentials and PHI in debug output. Defaults to `true`. Setting it
   * `false` writes live bearer tokens and the client secret to your sink - never
   * do that in production.
   */
  debugRedact?: boolean;
  /** Days of log files to keep; `0` keeps everything. Defaults to 7. */
  debugRetentionDays?: number;
}

/**
 * The SDK's entry point: one client, seventeen resources.
 *
 * Construct it once at application start and share it. It holds the credentials,
 * caches the bearer token, and owns the single transport every resource dispatches
 * through, so creating one per request would throw away the token cache and cost a
 * credential exchange each time.
 *
 * ```ts
 * import { AsterMDClient, Event } from '@astermd-hq/sdk';
 *
 * const client = new AsterMDClient({
 *   clientId: process.env.ASTERMD_CLIENT_ID!,
 *   clientSecret: process.env.ASTERMD_CLIENT_SECRET!,
 * });
 *
 * const { session } = (
 *   await client.sessions().create<{ session: string }>()
 * ).data();
 *
 * await client.intakeSubmissions().create({
 *   session,
 *   event: Event.PreQualifyingInitiated,
 *   teleformId: 'your-teleform-id',
 *   data: answers,
 * });
 * ```
 *
 * Credentials are issued from your AsterMD dashboard, which is also where the
 * full API reference lives. This client holds a secret, so it belongs on a
 * server: never construct it in code that reaches a browser.
 *
 * Authentication needs no attention from you. The token is acquired lazily on the
 * first call, reused until it is close to expiring, refreshed automatically if the
 * server rejects it, and the organisation it authorises is encoded inside it -
 * which is why no method here takes an organisation argument.
 *
 * Every accessor is memoized, so `client.sessions()` returns the same instance
 * each time and calling it in a hot path costs nothing.
 */
export class AsterMDClient {
  readonly #config: Config;
  readonly #transport: Transport;

  #sessions?: Sessions;
  #intakeSubmissions?: IntakeSubmissions;
  #carts?: Carts;
  #checkoutEvents?: CheckoutEvents;
  #teleforms?: Teleforms;
  #patients?: Patients;
  #opportunities?: Opportunities;
  #treatments?: Treatments;
  #doctorsNetworks?: DoctorsNetworks;
  #channels?: Channels;
  #products?: Products;
  #categories?: Categories;
  #labTests?: LabTests;
  #medications?: Medications;
  #shippings?: Shippings;
  #verification?: Verification;
  #geo?: Geo;

  /**
   * @param options Credentials, connection settings, and debug configuration.
   * @throws {TypeError} If the credentials are empty, if `baseHost` carries a
   *   scheme or path, if `timeoutSeconds` is below 1, or if `debug` is on with
   *   neither `debugFile` nor `debugSink`.
   */
  constructor(options: AsterMDClientOptions) {
    const timeoutSeconds = options.timeoutSeconds ?? 10;

    this.#config = new Config({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      baseHost: options.baseHost ?? 'api.astermd.com',
      timeoutSeconds,
    });

    let http: HttpClient = options.httpClient ?? new FetchHttpClient(timeoutSeconds);

    if (options.debug === true) {
      if (options.debugSink === undefined && options.debugFile === undefined) {
        throw new TypeError('debug mode requires debugFile or debugSink.');
      }

      const timeZone = options.debugTimezone ?? 'UTC';
      const sink: DebugSink =
        options.debugSink ??
        ((): DebugSink => {
          const fileSink = new DailyFileLogSink({
            basePath: options.debugFile as string,
            retentionDays: options.debugRetentionDays ?? 7,
            timeZone,
          });

          return async (entry: string) => {
            await fileSink.write(entry);
          };
        })();

      // Wrap before TokenManager is built, so the credential exchange is logged
      // as well as every resource call.
      http = new LoggingHttpClient({
        inner: http,
        sink,
        timeZone,
        redactor: options.debugRedact === false ? null : new LogRedactor(),
      });
    }

    const urlBuilder = new UrlBuilder(this.#config.baseHost());

    const tokenManager = new TokenManager({
      config: this.#config,
      httpClient: http,
      urlBuilder,
      store: options.tokenStore ?? new InMemoryTokenStore(),
    });

    this.#transport = new Transport({
      httpClient: http,
      urlBuilder,
      tokenProvider: async () => await tokenManager.bearerToken(),
      onUnauthorized: async () => await tokenManager.refresh(),
    });
  }

  /**
   * Returns the immutable configuration this client was built with.
   *
   * @returns The configuration, including {@link Config.assetUrl}.
   */
  config(): Config {
    return this.#config;
  }

  /**
   * Resolves a relative asset path returned by the API against the AsterMD CDN.
   *
   * A convenience for `client.config().assetUrl(path)`. Treat the result as a
   * fetch URL: download the asset once and serve your own copy rather than
   * hot-linking.
   *
   * @param path Relative asset path as returned by the API.
   * @returns The fully-qualified CDN URL.
   */
  assetUrl(path: string): string {
    return this.#config.assetUrl(path);
  }

  /** Sessions - the thread tying one visitor's journey together. */
  sessions(): Sessions {
    return (this.#sessions ??= new Sessions(this.#transport));
  }

  /** Intake submissions - pre-qualifying and intake questionnaire answers. */
  intakeSubmissions(): IntakeSubmissions {
    return (this.#intakeSubmissions ??= new IntakeSubmissions(this.#transport));
  }

  /** Carts - what the visitor intends to buy. */
  carts(): Carts {
    return (this.#carts ??= new Carts(this.#transport));
  }

  /** Checkout events - progress through the checkout funnel. */
  checkoutEvents(): CheckoutEvents {
    return (this.#checkoutEvents ??= new CheckoutEvents(this.#transport));
  }

  /** Teleforms - the questionnaire definitions your storefront renders. */
  teleforms(): Teleforms {
    return (this.#teleforms ??= new Teleforms(this.#transport));
  }

  /** Patients - the person receiving care. Carries PHI. */
  patients(): Patients {
    return (this.#patients ??= new Patients(this.#transport));
  }

  /** Opportunities - a named prospect worth following up. */
  opportunities(): Opportunities {
    return (this.#opportunities ??= new Opportunities(this.#transport));
  }

  /** Treatments - the order, once payment has settled. */
  treatments(): Treatments {
    return (this.#treatments ??= new Treatments(this.#transport));
  }

  /** Doctors' networks - handing a case to the clinicians who review it. */
  doctorsNetworks(): DoctorsNetworks {
    return (this.#doctorsNetworks ??= new DoctorsNetworks(this.#transport));
  }

  /** Channels - the storefront's own server-side configuration. */
  channels(): Channels {
    return (this.#channels ??= new Channels(this.#transport));
  }

  /** Products - the read-only catalogue. */
  products(): Products {
    return (this.#products ??= new Products(this.#transport));
  }

  /** Categories - how the catalogue is grouped for browsing. */
  categories(): Categories {
    return (this.#categories ??= new Categories(this.#transport));
  }

  /** Lab tests - diagnostic panels a product may require. */
  labTests(): LabTests {
    return (this.#labTests ??= new LabTests(this.#transport));
  }

  /** Medications - the reference list backing "what are you currently taking?". */
  medications(): Medications {
    return (this.#medications ??= new Medications(this.#transport));
  }

  /** Shipping options - delivery methods available for an order. */
  shippings(): Shippings {
    return (this.#shippings ??= new Shippings(this.#transport));
  }

  /** Verification - address, email, and identity checks. */
  verification(): Verification {
    return (this.#verification ??= new Verification(this.#transport));
  }

  /** Geo - where a visitor is, and whether you may serve them. */
  geo(): Geo {
    return (this.#geo ??= new Geo(this.#transport));
  }
}
