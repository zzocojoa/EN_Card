import { expect, it, vi } from 'vitest';
import { credentialToken } from '../src/automation/credentials';
import type { AutomationEnv } from '../src/automation/types';
import type { TokenSecrets } from '../src/shared/token-rpc';

const secrets = {
  TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  KAKAO_REST_API_KEY: 'synthetic-key',
  KAKAO_CLIENT_SECRET: 'synthetic-secret',
};
function dependencies() {
  const prepare = vi.fn(() => {
    throw new Error('synthetic-private-database-detail');
  });
  const transport = vi.fn(async () => {
    throw new Error('Must not call Kakao');
  });
  const env = {
    DB: { prepare },
    COST_MODE: 'free_only',
    SEND_MODE: 'live',
  } as unknown as AutomationEnv;
  return { env, prepare, transport };
}
it.each([{ COST_MODE: 'paid' }, { SEND_MODE: 'dry_run' }, { SEND_MODE: 'mock' }])(
  'credential RPC rejects disabled modes before storage or provider use: %j',
  async (mode) => {
    const { env, prepare, transport } = dependencies();
    expect(
      await credentialToken({ ...env, ...mode } as AutomationEnv, secrets, 0, transport),
    ).toEqual({ kind: 'unavailable' });
    expect(prepare).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  },
);
it.each([
  {},
  { ...secrets, TOKEN_ENCRYPTION_KEY: 'x'.repeat(4097) },
  { ...secrets, KAKAO_CLIENT_SECRET: 123 },
  { ...secrets, unexpected: 'value' },
  null,
])('credential RPC rejects malformed inputs before storage or provider use: %#', async (input) => {
  const { env, prepare, transport } = dependencies();
  expect(await credentialToken(env, input as unknown as TokenSecrets, 0, transport)).toEqual({
    kind: 'unavailable',
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
it('unexpected database error details do not cross the private RPC boundary', async () => {
  const { env, prepare, transport } = dependencies();
  expect(await credentialToken(env, secrets, 0, transport)).toEqual({ kind: 'unavailable' });
  expect(prepare).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
});
