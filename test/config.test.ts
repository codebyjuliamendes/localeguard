import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({}, '/srv/app')).toEqual({
      env: 'development',
      host: '0.0.0.0',
      port: 3007,
      databasePath: '/srv/app/data/localeguard.sqlite',
      logLevel: 'info',
      seedDemo: true,
      trustProxy: false,
      bodyLimit: 819200,
      rateLimit: { max: 60, timeWindow: '1 minute' },
      shutdownTimeoutMs: 10000,
    });
  });

  it('parses and coerces values, treating empty strings as unset', () => {
    const config = loadConfig({
      PORT: '3204',
      SEED_DEMO: 'false',
      TRUST_PROXY: '1',
      DATABASE_PATH: '/data/x.sqlite',
      LOG_LEVEL: 'warn',
      HOST: '',
    });
    expect(config).toMatchObject({
      port: 3204,
      seedDemo: false,
      trustProxy: true,
      databasePath: '/data/x.sqlite',
      logLevel: 'warn',
      host: '0.0.0.0',
    });
  });

  it('fails fast listing every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud' })).toThrow(/PORT.*LOG_LEVEL/);
  });
});
