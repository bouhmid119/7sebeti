import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/converty-order.json';
import { confirmingAgent, convertySource } from './index';

describe('converty adapter', () => {
  it('normalizes a webhook order (contract test on a recorded payload shape)', () => {
    const order = convertySource.parseWebhook(fixture);
    expect(order).not.toBeNull();
    expect(order?.externalId).toBe('665f00000000000000000001');
    expect(order?.lines).toHaveLength(2);
    expect(order?.lines[1]).toMatchObject({ externalProductKey: 'prod-baume', isUpsell: true });
    expect(order?.events.map((e) => e.sourceStatus)).toEqual(['pending', 'Tentative 1', 'confirmed']);
    expect(order?.total).toBe(144);
    expect(order?.deliveryFee).toBe(7);
  });

  it('credits the agent who took the decision', () => {
    const order = convertySource.parseWebhook(fixture);
    expect(order && confirmingAgent(order)).toBe('Amira');
  });

  it('ignores bodies that are not orders', () => {
    expect(convertySource.parseWebhook({ hello: 'world' })).toBeNull();
    expect(convertySource.parseWebhook(null)).toBeNull();
  });
});
