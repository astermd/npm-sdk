/** One integration's mapping for a variant or a single-price product. */
export interface ChannelProductMapping {
  /** The integration's type, from the mapping's `integration.type`. */
  type: unknown;
  /** Every other key of the raw `mapping` object, verbatim. */
  [key: string]: unknown;
}

/** A purchasable variant of a product, with its price and integration mapping. */
export interface ChannelProductVariant {
  id: unknown;
  name: unknown;
  sku: unknown;
  price: unknown;
  intro_price: unknown;
  sale_price: unknown;
  sale_start: unknown;
  sale_end: unknown;
  mapping: ChannelProductMapping | null;
}

/** Single-purchase pricing for a product that has no variants. */
export interface ChannelProductSingle {
  price: unknown;
  intro_price: unknown;
  sale_price: unknown;
  sale_start: unknown;
  sale_end: unknown;
  mapping: ChannelProductMapping | null;
}

/** A product as the channel offers it. */
export interface ChannelProduct {
  id: unknown;
  name: unknown;
  type: unknown;
  sku: unknown;
  status: unknown;
  visibility: unknown;
  image: unknown;
  description_long: unknown;
  description_short: unknown;
  restrict_multiple: unknown;
  min_buy_qty: unknown;
  max_buy_qty: unknown;
  stock: unknown;
  categories: unknown[];
  condition_treated: unknown[];
  teleforms: unknown;
  labtest: unknown[];
  add_ons: ChannelProduct[];
  single: ChannelProductSingle | null;
  variants: ChannelProductVariant[];
}

/** The channel's payment processor configuration. */
export interface ChannelPaymentProcessor {
  id: unknown;
  name: unknown;
  provider: unknown;
  type: unknown;
  config: unknown;
}

/** The flattened channel-detail envelope. */
export interface ChannelDetailView {
  id: unknown;
  name: unknown;
  description: unknown;
  status: unknown;
  type: unknown;
  auto_inc_id: unknown;
  payment_processor: ChannelPaymentProcessor | null;
  products: ChannelProduct[];
}

/**
 * Read model over the channel-detail envelope.
 *
 * {@link Channels.details} returns everything a storefront needs in one
 * response, which makes it efficient and awkward in equal measure: the payload is
 * deeply nested, uses the server's own field names, and scatters each variant's
 * integration mapping into a separate parallel list keyed by variant id. Rendering
 * straight from it means writing that reassembly into your view layer.
 *
 * This presenter does the reassembly once. It renames `_id` to `id` throughout,
 * joins each variant to its mapping, hoists single-purchase pricing out of its
 * one-element list, flattens reference objects, and recurses through add-ons so
 * they look like ordinary products:
 *
 * ```ts
 * const detail = ChannelDetail.from((await client.channels().details(channelId)).data());
 *
 * for (const product of detail.products) {
 *   for (const variant of product.variants) {
 *     render(product.name, variant.name, variant.price, variant.mapping);
 *   }
 * }
 * ```
 *
 * Field names in the output stay snake_case, matching the PHP SDK's presenter, so
 * a value produced by one can be compared against the other. Anything the server
 * omitted comes back as `null` rather than `undefined`, and an omitted list comes
 * back empty - so a view can read straight through without optional chaining at
 * every level.
 *
 * The class is not instantiable; it exposes only {@link ChannelDetail.from}.
 */
export class ChannelDetail {
  private constructor() {
    // Static-only.
  }

  /**
   * Flattens a channel-detail payload into a shape a view can render directly.
   *
   * Pass `response.data()` from {@link Channels.details}. Malformed or missing
   * branches degrade to `null` and `[]` rather than raising, because a channel is
   * configuration a storefront needs at boot: failing the page over one absent
   * optional field would be the wrong trade.
   *
   * @param data The raw `data` object from the channel-detail response.
   * @returns The flattened view.
   */
  static from(data: Record<string, unknown>): ChannelDetailView {
    return {
      id: data._id ?? null,
      name: data.name ?? null,
      description: data.description ?? null,
      status: data.status ?? null,
      type: data.type ?? null,
      auto_inc_id: data.auto_inc_id ?? null,
      payment_processor: processor(data.payment_processor),
      products: toList(data.products).map(entry => product(toObject(entry))),
    };
  }
}

function processor(value: unknown): ChannelPaymentProcessor | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const pp = value as Record<string, unknown>;

  return {
    id: pp._id ?? null,
    name: pp.name ?? null,
    provider: pp.provider_category ?? null,
    type: pp.type ?? null,
    config: pp.config ?? null,
  };
}

function product(entry: Record<string, unknown>): ChannelProduct {
  // The server sends variant mappings in a parallel list; index them by variant
  // id so each variant can be joined to its own.
  const byVariant = new Map<string, ChannelProductMapping>();

  for (const raw of toList(entry.product_mappings)) {
    const pm = toObject(raw);
    const variantId = pm.variant_id;

    if (typeof variantId === 'string') {
      byVariant.set(variantId, mapping(pm));
    }
  }

  return coreProduct(toObject(entry.product), byVariant, toList(entry.add_ons));
}

function coreProduct(
  p: Record<string, unknown>,
  byVariant: Map<string, ChannelProductMapping>,
  addOns: unknown[],
): ChannelProduct {
  const id = typeof p._id === 'string' ? p._id : null;

  const variants = toList(p.variants).map(raw => {
    const v = toObject(raw);
    const variantId = typeof v._id === 'string' ? v._id : null;

    return variant(v, lookup(byVariant, variantId));
  });

  const singleRows = toList(p.single);
  const single = singleRows.length === 0 ? null : singlePricing(toObject(singleRows[0]), lookup(byVariant, id));

  return {
    id: p._id ?? null,
    name: p.name ?? null,
    type: p.type ?? null,
    sku: p.sku ?? null,
    status: p.status ?? null,
    visibility: p.visibility ?? null,
    image: p.image ?? null,
    description_long: p.description_long ?? null,
    description_short: p.description_short ?? null,
    restrict_multiple: p.restrict_multiple ?? null,
    min_buy_qty: p.min_buy_qty ?? null,
    max_buy_qty: p.max_buy_qty ?? null,
    stock: p.stock ?? null,
    categories: refs(p.categories),
    condition_treated: refs(p.condition_treated),
    teleforms: refs(p.teleforms)[0] ?? null,
    labtest: refs(p.labtest),
    add_ons: addOns.map(addOn => coreProduct(toObject(addOn), new Map(), [])),
    single,
    variants,
  };
}

function variant(v: Record<string, unknown>, productMapping: ChannelProductMapping | null): ChannelProductVariant {
  return {
    id: v._id ?? null,
    name: v.name ?? null,
    sku: v.sku ?? null,
    price: v.default_price ?? null,
    intro_price: v.intro_price ?? null,
    sale_price: v.sale_price ?? null,
    sale_start: v.sale_start ?? null,
    sale_end: v.sale_end ?? null,
    mapping: productMapping,
  };
}

function singlePricing(
  row: Record<string, unknown>,
  productMapping: ChannelProductMapping | null,
): ChannelProductSingle {
  return {
    price: row.default_price ?? null,
    intro_price: row.intro_price ?? null,
    sale_price: row.sale_price ?? null,
    sale_start: row.sale_start ?? null,
    sale_end: row.sale_end ?? null,
    mapping: productMapping,
  };
}

function mapping(pm: Record<string, unknown>): ChannelProductMapping {
  const integration = toObject(pm.integration);
  const out: ChannelProductMapping = { type: integration.type ?? null };

  for (const [key, value] of Object.entries(toObject(pm.mapping))) {
    if (key !== 'type') {
      out[key] = value;
    }
  }

  return out;
}

function refs(list: unknown): unknown[] {
  return toList(list).map(item => ref(item));
}

function ref(r: unknown): unknown {
  if (typeof r !== 'object' || r === null) {
    return r;
  }

  const raw = r as Record<string, unknown>;
  const out: Record<string, unknown> = { id: raw._id ?? null };

  for (const [key, value] of Object.entries(raw)) {
    if (key !== '_id') {
      out[key] = value;
    }
  }

  return out;
}

function lookup(map: Map<string, ChannelProductMapping>, key: string | null): ChannelProductMapping | null {
  return key === null ? null : (map.get(key) ?? null);
}

/** Coerces a value to a list, treating anything else as empty. */
function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  // A PHP associative array reaches JSON as an object; take its values, as
  // PHP's array_values would.
  return typeof value === 'object' && value !== null ? Object.values(value) : [];
}

/** Coerces a value to an object, treating anything else as empty. */
function toObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
