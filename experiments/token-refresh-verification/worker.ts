import production from '../../src/worker/index';
import type { Env } from '../../src/worker/types';
import { inWindow, probeOnce, type Probe } from './probe';

type VerificationEnv = Env & { TOKEN_REFRESH_PROBE?: string };
export default {
  fetch: production.fetch,
  async scheduled(event: ScheduledController, env: VerificationEnv): Promise<void> {
    let probe: Probe | null = null;
    try {
      probe = JSON.parse(env.TOKEN_REFRESH_PROBE ?? 'null') as Probe | null;
    } catch {
      /* Not armed. */
    }
    const now = Date.now();
    if (!probe || !inWindow(probe, now)) return production.scheduled(event, env);
    // At most five minutes reserved for an idle-system test; normal Cron resumes
    // automatically at the deadline even if the operator cannot restore the version.
    const result = await probeOnce(env, probe, now);
    if (result.outcome !== 'skipped')
      console.log({ event: 'token_refresh_verification', ...result });
  },
};
