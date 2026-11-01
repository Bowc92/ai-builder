const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
module.exports = function createChatGPT(base) {
  let flow = null, status = { state: 'disconnected' };
  const load = file => import(pathToFileURL(path.join(base, 'pi/node_modules/@earendil-works', file)).href);
  async function storage() { const { AuthStorage } = await load('pi-coding-agent/dist/core/auth-storage.js'); return AuthStorage.create(path.join(base, 'pi-state/auth.json')); }
  return {
    async status() { const entries = await (await storage()).list(); return { ...status, connected: entries.some(x => x.providerId === 'openai' && x.type === 'oauth') }; },
    async start() {
      if (flow) return this.status();
      const controller = new AbortController(); flow = controller;
      status = { state: 'starting' };
      const idFile = path.join(base, 'state/chatgpt-device-id');
      if (!fs.existsSync(idFile)) fs.writeFileSync(idFile, crypto.randomUUID());
      const { openaiChatGPTOAuth } = await load('pi-ai/dist/auth/oauth/openai-chatgpt.js');
      const timer = setTimeout(() => controller.abort(), 1800000);
      openaiChatGPTOAuth.login({ signal: controller.signal,
        notify(event) { if (event.type === 'auth_url') status = { state: 'waiting', url: event.url }; },
        prompt(request) { return new Promise((resolve, reject) => {
          const signal = request.signal || controller.signal;
          if (signal.aborted) reject(new Error('Cancelled'));
          else signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
        }); }
      }, { agentName: 'AI Builder (Pi)', getDeviceId: () => fs.readFileSync(idFile, 'utf8').trim() })
        .then(async credential => { await (await storage()).modify('openai', () => credential); status = { state: 'connected' }; })
        .catch(() => { status = { state: 'error', error: controller.signal.aborted ? 'The sign-in window expired. Click Sign in with ChatGPT to start again.' : 'Sign-in did not complete. Close any other pending sign-in and retry.' }; })
        .finally(() => { clearTimeout(timer); flow = null; });
      return this.status();
    },
    cancel() { flow?.abort(); },
    async disconnect() { flow?.abort(); await (await storage()).delete('openai'); status = { state: 'disconnected' }; }
  };
};
