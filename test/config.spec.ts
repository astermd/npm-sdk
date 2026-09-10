import { describe, expect, it } from 'vitest';
import { Config } from '../src/config.js';

const valid = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };

describe('Config', () => {
  it('exposes the credentials it was given', () => {
    const config = new Config(valid);

    expect(config.clientId()).toBe('test-client-id');
    expect(config.clientSecret()).toBe('test-client-secret');
  });

  it('defaults the host and the timeout', () => {
    const config = new Config(valid);

    expect(config.baseHost()).toBe('api.astermd.com');
    expect(config.timeoutSeconds()).toBe(10);
  });

  it('accepts an overridden bare host and timeout', () => {
    const config = new Config({ ...valid, baseHost: 'api.example.test', timeoutSeconds: 30 });

    expect(config.baseHost()).toBe('api.example.test');
    expect(config.timeoutSeconds()).toBe(30);
  });

  it.each([
    ['an empty clientId', { clientId: '', clientSecret: 's' }],
    ['an empty clientSecret', { clientId: 'c', clientSecret: '' }],
  ])('rejects %s', (_label, options) => {
    expect(() => new Config(options)).toThrow(TypeError);
    expect(() => new Config(options)).toThrow(/clientId and clientSecret must be non-empty/);
  });

  it.each([
    ['a scheme', 'https://api.astermd.com'],
    ['a path', 'api.astermd.com/v1'],
    ['both', 'https://api.astermd.com/v1'],
  ])('rejects a baseHost containing %s', (_label, baseHost) => {
    expect(() => new Config({ ...valid, baseHost })).toThrow(TypeError);
    expect(() => new Config({ ...valid, baseHost })).toThrow(/must be a bare host/);
  });

  it('rejects a timeout below one second', () => {
    expect(() => new Config({ ...valid, timeoutSeconds: 0 })).toThrow(/timeoutSeconds must be >= 1/);
  });

  it('resolves a relative asset path against the AsterMD CDN', () => {
    const config = new Config(valid);

    expect(config.assetUrl('org/channel/products/tile.png')).toBe(
      'https://cdn.astermd.com/org/channel/products/tile.png',
    );
  });

  it('tolerates a leading slash on an asset path without doubling it', () => {
    expect(new Config(valid).assetUrl('/org/tile.png')).toBe('https://cdn.astermd.com/org/tile.png');
  });

  it('is frozen', () => {
    const config = new Config(valid);

    expect(Object.isFrozen(config)).toBe(true);
  });
});
