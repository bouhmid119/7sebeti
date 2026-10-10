import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseSsl } from './index';

describe('databaseSsl', () => {
  it('uses no TLS options when no CA is configured (local, CI)', () => {
    expect(databaseSsl({})).toBeUndefined();
  });

  it('verifies against the system trust store when asked (public CAs, e.g. Azure)', () => {
    expect(databaseSsl({ DATABASE_SSL: 'verify-full' })).toEqual({ rejectUnauthorized: true });
  });

  it('verifies the server certificate against the configured CA', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ca-')), 'db-ca.pem');
    writeFileSync(file, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
    expect(databaseSsl({ DATABASE_CA_CERT_FILE: file })).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
      rejectUnauthorized: true,
    });
  });
});
