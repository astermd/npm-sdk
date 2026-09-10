import { describe, expect, it } from 'vitest';
import { ChannelDetail } from '../../src/presenter/channel-detail.js';

describe('ChannelDetail.from top level', () => {
  it('renames _id and passes the channel fields through', () => {
    const view = ChannelDetail.from({
      _id: 'c-1',
      name: 'Main storefront',
      description: 'Primary brand',
      status: 'active',
      type: 'web',
      auto_inc_id: 12,
    });

    expect(view).toMatchObject({
      id: 'c-1',
      name: 'Main storefront',
      description: 'Primary brand',
      status: 'active',
      type: 'web',
      auto_inc_id: 12,
    });
  });

  it('nulls every missing field and empties every missing list', () => {
    expect(ChannelDetail.from({})).toEqual({
      id: null,
      name: null,
      description: null,
      status: null,
      type: null,
      auto_inc_id: null,
      payment_processor: null,
      products: [],
    });
  });
});

describe('ChannelDetail.from payment processor', () => {
  it('maps the processor and renames provider_category', () => {
    const view = ChannelDetail.from({
      payment_processor: {
        _id: 'pp-1',
        name: 'Primary processor',
        provider_category: 'card',
        type: 'gateway',
        config: { mode: 'live' },
      },
    });

    expect(view.payment_processor).toEqual({
      id: 'pp-1',
      name: 'Primary processor',
      provider: 'card',
      type: 'gateway',
      config: { mode: 'live' },
    });
  });

  it.each([[null], [undefined], ['a string'], [42]])(
    'reports a non-object processor (%o) as null',
    payment_processor => {
      expect(ChannelDetail.from({ payment_processor }).payment_processor).toBeNull();
    },
  );
});

describe('ChannelDetail.from products', () => {
  it('flattens a product with variants, prices and mappings', () => {
    const view = ChannelDetail.from({
      products: [
        {
          product: {
            _id: 'pr-1',
            name: 'Treatment A',
            type: 'rx',
            sku: 'SKU-A',
            status: 'active',
            visibility: 'public',
            image: 'org/tile.png',
            description_long: 'Long copy',
            description_short: 'Short copy',
            restrict_multiple: true,
            min_buy_qty: 1,
            max_buy_qty: 3,
            stock: 42,
            variants: [
              {
                _id: 'v-1',
                name: 'Monthly',
                sku: 'SKU-A-M',
                default_price: 99,
                intro_price: 49,
                sale_price: 79,
                sale_start: '2026-09-01',
                sale_end: '2026-09-30',
              },
            ],
          },
          product_mappings: [
            {
              variant_id: 'v-1',
              integration: { type: 'commerce' },
              mapping: { external_id: 'EXT-1', type: 'ignored', campaign: 'C-1' },
            },
          ],
        },
      ],
    });

    expect(view.products).toHaveLength(1);
    const product = view.products[0]!;

    expect(product).toMatchObject({
      id: 'pr-1',
      name: 'Treatment A',
      sku: 'SKU-A',
      restrict_multiple: true,
      min_buy_qty: 1,
      max_buy_qty: 3,
      stock: 42,
    });

    expect(product.variants[0]).toEqual({
      id: 'v-1',
      name: 'Monthly',
      sku: 'SKU-A-M',
      price: 99,
      intro_price: 49,
      sale_price: 79,
      sale_start: '2026-09-01',
      sale_end: '2026-09-30',
      mapping: { type: 'commerce', external_id: 'EXT-1', campaign: 'C-1' },
    });
  });

  it('drops the mapping key named type in favour of the integration type', () => {
    const view = ChannelDetail.from({
      products: [
        {
          product: { _id: 'pr-1', variants: [{ _id: 'v-1' }] },
          product_mappings: [{ variant_id: 'v-1', integration: { type: 'commerce' }, mapping: { type: 'bogus' } }],
        },
      ],
    });

    expect(view.products[0]!.variants[0]!.mapping).toEqual({ type: 'commerce' });
  });

  it('nulls a variant mapping when no product mapping matches', () => {
    const view = ChannelDetail.from({
      products: [{ product: { _id: 'pr-1', variants: [{ _id: 'v-9' }] }, product_mappings: [] }],
    });

    expect(view.products[0]!.variants[0]!.mapping).toBeNull();
  });

  it('ignores a product mapping whose variant_id is not a string', () => {
    const view = ChannelDetail.from({
      products: [
        {
          product: { _id: 'pr-1', variants: [{ _id: 'v-1' }] },
          product_mappings: [{ variant_id: 42, integration: { type: 'commerce' }, mapping: {} }],
        },
      ],
    });

    expect(view.products[0]!.variants[0]!.mapping).toBeNull();
  });

  it('takes single pricing from the first row and looks its mapping up by the product id', () => {
    const view = ChannelDetail.from({
      products: [
        {
          product: {
            _id: 'pr-1',
            single: [
              {
                default_price: 120,
                intro_price: 60,
                sale_price: null,
                sale_start: null,
                sale_end: null,
              },
              { default_price: 999 },
            ],
          },
          product_mappings: [
            {
              variant_id: 'pr-1',
              integration: { type: 'commerce' },
              mapping: { external_id: 'EXT-P' },
            },
          ],
        },
      ],
    });

    expect(view.products[0]!.single).toEqual({
      price: 120,
      intro_price: 60,
      sale_price: null,
      sale_start: null,
      sale_end: null,
      mapping: { type: 'commerce', external_id: 'EXT-P' },
    });
  });

  it('reports single as null when the product has no single pricing', () => {
    const view = ChannelDetail.from({ products: [{ product: { _id: 'pr-1', single: [] } }] });

    expect(view.products[0]!.single).toBeNull();
  });

  it('flattens refs, renaming _id and keeping the other keys', () => {
    const view = ChannelDetail.from({
      products: [
        {
          product: {
            _id: 'pr-1',
            categories: [{ _id: 'cat-1', name: 'Weight' }],
            condition_treated: [{ _id: 'cond-1', name: 'Obesity' }],
            labtest: [{ _id: 'lt-1', name: 'Panel' }],
          },
        },
      ],
    });

    const product = view.products[0]!;
    expect(product.categories).toEqual([{ id: 'cat-1', name: 'Weight' }]);
    expect(product.condition_treated).toEqual([{ id: 'cond-1', name: 'Obesity' }]);
    expect(product.labtest).toEqual([{ id: 'lt-1', name: 'Panel' }]);
  });

  it('passes a scalar ref through unchanged', () => {
    const view = ChannelDetail.from({
      products: [{ product: { _id: 'pr-1', categories: ['cat-1', 7] } }],
    });

    expect(view.products[0]!.categories).toEqual(['cat-1', 7]);
  });

  it('takes only the first teleform, and null when there are none', () => {
    const withForm = ChannelDetail.from({
      products: [
        {
          product: {
            _id: 'pr-1',
            teleforms: [{ _id: 'tf-1', name: 'Intake' }, { _id: 'tf-2' }],
          },
        },
      ],
    });
    const withoutForm = ChannelDetail.from({ products: [{ product: { _id: 'pr-1' } }] });

    expect(withForm.products[0]!.teleforms).toEqual({ id: 'tf-1', name: 'Intake' });
    expect(withoutForm.products[0]!.teleforms).toBeNull();
  });

  it('flattens add-ons as products in their own right, without mappings of their own', () => {
    const view = ChannelDetail.from({
      products: [
        {
          product: { _id: 'pr-1', name: 'Main' },
          add_ons: [{ _id: 'pr-2', name: 'Add-on', variants: [{ _id: 'v-2', default_price: 10 }] }],
        },
      ],
    });

    const addOn = view.products[0]!.add_ons[0]!;
    expect(addOn).toMatchObject({ id: 'pr-2', name: 'Add-on' });
    expect(addOn.variants[0]).toMatchObject({ id: 'v-2', price: 10, mapping: null });
    expect(addOn.add_ons).toEqual([]);
  });

  it('tolerates a products entry that is not an object', () => {
    expect(() => ChannelDetail.from({ products: ['nonsense', null, 7] })).not.toThrow();
    expect(ChannelDetail.from({ products: ['nonsense'] }).products).toHaveLength(1);
  });
});
