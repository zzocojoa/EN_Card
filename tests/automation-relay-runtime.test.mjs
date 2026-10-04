import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// The network stays mocked; workerd performs the real Request/fetch option validation.
it.each([200, 302])(
  'uses Workers fetch and refuses relay/provider redirects (%s)',
  async (status) => {
    const bundle = await build({
      stdin: {
        contents: `import {relayReady} from './src/automation/relay-client.ts';
        import {providerClient} from './src/automation/providers.ts';
        export default {async fetch(request) {
          const route = new URL(request.url).pathname.slice(1);
          try {
            const result = route === 'relay' ? await relayReady({AI_RELAY_KEY:'a'.repeat(64)})
              : await providerClient({GOOGLE_API_KEY:'test-google',GROQ_API_KEY:'test-groq'})({
                provider:route,stage:'draft',settings:{topic:'test',level:'초급',template:'expression',
                base_expression:'',start_date:'2026-10-04',end_date:null,time:'08:00'},
                content:null,review:null,recent:[]});
            return Response.json({result});
          } catch(error) {return Response.json({error:error.code,httpStatus:error.httpStatus},{status:502});}
        }};`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
    });
    const calls = [];
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        host: '127.0.0.1',
        port: 0,
        cf: false,
        telemetry: { enabled: false },
        workers: [
          {
            name: 'relay-runtime',
            modules: true,
            script: bundle.outputFiles[0].text,
            compatibilityDate: '2026-09-01',
            outboundService: async (request) => {
              const host = new URL(request.url).hostname;
              calls.push(host);
              expect([
                'wordgrain-oxford-study.hoihou-o.chatgpt.site',
                'generativelanguage.googleapis.com',
                'api.groq.com',
              ]).toContain(host);
              if (status === 302)
                return new Response(null, {
                  status,
                  headers: { Location: 'https://redirect.invalid/secret' },
                });
              if (host.endsWith('chatgpt.site')) {
                expect(await request.json()).toEqual({ action: 'status' });
                return Response.json({ ready: true });
              }
              const text = JSON.stringify({ synthetic: true });
              return Response.json(
                host === 'api.groq.com'
                  ? { choices: [{ message: { content: text }, finish_reason: 'stop' }] }
                  : { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] },
              );
            },
          },
        ],
      }),
    );
    try {
      for (const route of ['relay', 'google', 'groq']) {
        const response = await mf.dispatchFetch(`https://internal/${route}`);
        expect(await response.json()).toEqual(
          status === 200
            ? { result: route === 'relay' ? true : { synthetic: true } }
            : { error: route === 'relay' ? 'unavailable' : 'config', httpStatus: 302 },
        );
      }
      expect(calls).toHaveLength(3);
    } finally {
      await mf.dispose();
    }
  },
  30000,
);
