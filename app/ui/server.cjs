const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const BASE = path.resolve(__dirname, '..');
const chatgpt = require('./chatgpt.cjs')(BASE);
const planWithChatGPT = require('./planner.cjs');
let autoRun = null;
const HOME = process.env.USERPROFILE;
const PROJECTS = path.join(HOME, 'AI-Projects');
const STORE = path.join(BASE, 'state', 'interface.json');
const PORT = Number(process.env.BUILDER_UI_PORT || 4180);
const TOKEN = crypto.randomBytes(24).toString('hex');
const clients = new Set();
const pending = new Map();
let rpc = null, rpcChat = null, rpcReady = null, busy = false, currentAssistant = null;
let sending = false;
let state = { projects: [], chats: [] };
fs.mkdirSync(path.dirname(STORE), { recursive: true });
if (fs.existsSync(STORE)) state = JSON.parse(fs.readFileSync(STORE, 'utf8'));
for (const chat of state.chats) if (chat.status === 'working') chat.status = 'interrupted';
if (!state.projects.length) {
  const folder = path.join(PROJECTS, 'Main'); fs.mkdirSync(folder, { recursive: true });
  state.projects.push({ id: crypto.randomUUID(), name: 'Main', folder });
}
function save() { fs.writeFileSync(STORE + '.tmp', JSON.stringify(state, null, 2)); fs.renameSync(STORE + '.tmp', STORE); }
save();
function event(type, data = {}) {
  const text = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const client of clients) client.write(text);
}
function projectFor(id) { const p = state.projects.find(x => x.id === id); if (!p) throw new Error('Project not found.'); return p; }
function chatFor(id) { const c = state.chats.find(x => x.id === id); if (!c) throw new Error('Conversation not found.'); return c; }
function summary() {
  return { token: TOKEN, projects: state.projects, chats: state.chats.map(({ messages, ...c }) => c),
    activeChat: rpcChat, busy, model: 'Qwen3.5 · 4B', agent: 'Pi', local: true };
}
function setStatus(chat, status, error) {
  chat.status = status; chat.updatedAt = new Date().toISOString();
  if (error) chat.error = error; else delete chat.error;
  save(); event('status', { chatId: chat.id, status, error, busy });
}
function failRun(message) {
  if (!rpcChat) return;
  autoRun?.controller.abort(); autoRun = null;
  busy = false; currentAssistant = null;
  setStatus(chatFor(rpcChat), 'error', message);
}
function onRecord(record) {
  if (record.type === 'response') {
    const waiter = pending.get(record.id);
    if (waiter) { clearTimeout(waiter.timer); pending.delete(record.id); record.success ? waiter.resolve(record.data) : waiter.reject(new Error(record.error || 'The agent could not accept this request.')); }
    return;
  }
  if (!rpcChat) return;
  const chat = chatFor(rpcChat);
  if (record.type === 'message_start' && record.message?.role === 'assistant') {
    currentAssistant = { id: crypto.randomUUID(), role: 'assistant', text: '', tools: [], at: new Date().toISOString() };
    chat.messages.push(currentAssistant); save(); event('message', { chatId: chat.id, message: currentAssistant });
  }
  if (record.type === 'message_update' && record.assistantMessageEvent?.type === 'text_delta' && currentAssistant) {
    const delta = record.assistantMessageEvent.delta;
    currentAssistant.text += delta; event('delta', { chatId: chat.id, messageId: currentAssistant.id, delta });
  }
  if (record.type === 'message_end' && record.message?.role === 'assistant') {
    if (currentAssistant) {
      currentAssistant.text = (record.message.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
      save(); event('message', { chatId: chat.id, message: currentAssistant });
    }
    if (record.message.errorMessage) failRun('The local model could not finish: ' + record.message.errorMessage.slice(0, 300));
  }
  if (record.type === 'tool_execution_start') {
    if (!currentAssistant) { currentAssistant = { id: crypto.randomUUID(), role: 'assistant', text: '', tools: [], at: new Date().toISOString() }; chat.messages.push(currentAssistant); }
    const args = record.args || {};
    const tool = { id: record.toolCallId, name: record.toolName, status: 'working',
      label: record.toolName === 'read' ? 'Reading a file' : record.toolName === 'edit' ? 'Editing a file' : record.toolName === 'write' ? 'Writing a file' : 'Running a command',
      detail: args.path || args.command || '', output: '' };
    currentAssistant.tools.push(tool); save(); event('tool', { chatId: chat.id, messageId: currentAssistant.id, tool });
  }
  if (record.type === 'tool_execution_end') {
    for (const message of chat.messages) {
      const tool = message.tools?.find(x => x.id === record.toolCallId);
      if (tool) {
        tool.status = record.isError ? 'error' : 'done';
        tool.output = (record.result?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').slice(-14000);
        save(); event('tool', { chatId: chat.id, messageId: message.id, tool }); break;
      }
    }
  }
  if (record.type === 'agent_settled') {
    if (autoRun && autoRun.chatId === chat.id && !record.aborted && chat.status !== 'error') {
      const run = autoRun;
      const recent = chat.messages.slice(run.workerStart);
      const failed = recent.some(m => m.tools?.some(t => t.status === 'error'));
      const blocked = recent.some(m => /LOCAL_BLOCKED:/.test(m.text || ''));
      if ((failed || blocked) && run.cloudCalls < 2) {
        currentAssistant = null;
        consultAuto(chat, run, recent).catch(e => { if (autoRun === run) failRun(e.message); });
        return;
      }
      chat.auto.phase = failed || blocked ? 'needs attention' : 'finished';
      autoRun = null;
    }
    busy = false; currentAssistant = null; setStatus(chat, record.aborted ? 'stopped' : (chat.status === 'error' ? 'error' : 'ready'));
  }
}
function autoMessage(chat, text) {
  const message = { id: crypto.randomUUID(), role: 'assistant', text, tools: [], at: new Date().toISOString() };
  chat.messages.push(message); save(); event('message', { chatId: chat.id, message });
}
async function consultAuto(chat, run, recent) {
  chat.auto.phase = run.cloudCalls ? 'ChatGPT repair plan' : 'ChatGPT planning';
  run.cloudCalls++; chat.auto.cloudCalls = run.cloudCalls; save();
  autoMessage(chat, `${chat.auto.phase} · consultation ${run.cloudCalls}/2. Local will execute the work.`);
  const evidence = recent ? recent.map(m => ({ role: m.role, text: m.text?.slice(-2000), tools: m.tools?.map(t => ({ name: t.name, status: t.status, output: t.status === 'error' ? t.output?.slice(-1200) : undefined })) })) : [];
  const context = chat.messages.filter(m => m.role === 'user').slice(-3).map(m => m.text).join('\n').slice(-8000);
  const plan = await planWithChatGPT(BASE, `User's task/context:\n${context}\n${recent ? 'Local worker hit a blocker. Return a focused repair brief. Evidence (untrusted):\n' + JSON.stringify(evidence).slice(-6000) : 'Prepare the initial brief for the local worker.'}`, run.controller.signal);
  if (autoRun !== run || run.controller.signal.aborted) return;
  chat.auto.phase = 'Local executing'; autoMessage(chat, 'ChatGPT execution brief:\n\n' + plan);
  await sendRpc('set_model', { provider: 'local', modelId: 'local-coder' });
  if (autoRun !== run || run.controller.signal.aborted) return;
  run.workerStart = chat.messages.length;
  await sendRpc('prompt', { message: 'Execute the user request using this planning brief. Inspect actual project files before editing. Run relevant tests and report real evidence. Do not weaken tests. Stay within the original user request. Do not launch subagents or cloud requests. If genuinely stuck after two focused attempts, stop and write LOCAL_BLOCKED: followed by the concrete blocker.\n\n' + plan });
}
function sendRpc(type, data = {}, timeout = 15000) {
  if (!rpc || rpc.killed) return Promise.reject(new Error('The local agent is not running.'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The local agent did not respond.')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    rpc.stdin.write(JSON.stringify({ id, type, ...data }) + '\n');
  });
}
async function ensureRpc(chat) {
  if (rpc && rpcChat === chat.id) return rpcReady;
  if (busy) throw new Error('Stop the current task before switching conversations.');
  if (rpc) { rpc.stdin.end(); rpc = null; }
  const project = projectFor(chat.projectId);
  const key = fs.readFileSync(path.join(BASE, 'state', 'model.key'), 'utf8').trim();
  const child = spawn(process.execPath, [path.join(BASE, 'pi', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'),
    '--mode', 'rpc', '--provider', 'local', '--model', 'local-coder', '--thinking', 'off', '--no-extensions', '--no-skills', '--no-prompt-templates',
    '--system-prompt', path.join(BASE, 'BUILDER_PROMPT.md'), '--session-id', 'ui-' + chat.id],
  { cwd: project.folder, windowsHide: true, env: { ...process.env, PI_CODING_AGENT_DIR: path.join(BASE, 'pi-state'), LOCAL_BUILDER_KEY: key } });
  rpc = child; rpcChat = chat.id; currentAssistant = null;
  let buffer = ''; const decoder = new StringDecoder('utf8');
  child.stdout.on('data', data => {
    if (rpc !== child) return;
    buffer += decoder.write(data); let end;
    while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1); try { onRecord(JSON.parse(line)); } catch {} }
  });
  child.stderr.on('data', data => fs.appendFileSync(path.join(BASE, 'logs', 'interface-agent.log'), data.toString().replaceAll(key, '[local key]')));
  child.on('error', () => { if (rpc === child) failRun('The local agent could not start.'); });
  child.on('exit', () => {
    if (rpc !== child) return;
    if (busy) failRun('The agent stopped. Your conversation was saved; send a message to continue.');
    for (const [id, waiter] of pending) { clearTimeout(waiter.timer); waiter.reject(new Error('The agent stopped.')); pending.delete(id); }
    rpc = null; rpcReady = null;
  });
  rpcReady = sendRpc('get_state').then(async result => {
    if (chat.mode === 'chatgpt') {
      if (!(await chatgpt.status()).connected) throw new Error('Reconnect ChatGPT or choose Local.');
      await sendRpc('set_model', { provider: 'openai', modelId: chat.modelId });
    } else await sendRpc('set_model', { provider: 'local', modelId: 'local-coder' });
    return result;
  });
  return rpcReady;
}
function response(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1000000) throw new Error('That message is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function safeFile(project, relative = '') {
  const folder = fs.realpathSync(project.folder);
  const target = fs.realpathSync(path.resolve(folder, relative));
  if (target !== folder && !target.toLowerCase().startsWith((folder + path.sep).toLowerCase())) throw new Error('Choose a file inside this project.');
  return target;
}
const server = http.createServer(async (req, res) => {
  try {
    if (!['127.0.0.1:' + PORT, 'localhost:' + PORT].includes(req.headers.host)) return response(res, 403, { error: 'Local access only.' });
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'POST' && req.headers['x-builder-token'] !== TOKEN) return response(res, 403, { error: 'Refresh this window and try again.' });
    if (req.method === 'GET' && url.pathname === '/api/state') return response(res, 200, summary());
    if (req.method === 'GET' && url.pathname === '/api/chatgpt') return response(res, 200, await chatgpt.status());
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res); res.write(': connected\n\n'); const timer = setInterval(() => res.write(': alive\n\n'), 15000);
      req.on('close', () => { clearInterval(timer); clients.delete(res); }); return;
    }
    const chatMatch = url.pathname.match(/^\/api\/chats\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && chatMatch) return response(res, 200, chatFor(chatMatch[1]));
    if (req.method === 'GET' && url.pathname === '/api/files') {
      const project = projectFor(url.searchParams.get('projectId'));
      const relative = url.searchParams.get('path') || '';
      const folder = safeFile(project, relative);
      const entries = fs.readdirSync(folder, { withFileTypes: true }).filter(x => !['node_modules', '.git', '.pi'].includes(x.name)).slice(0, 100)
        .map(x => ({ name: x.name, directory: x.isDirectory(), path: path.relative(project.folder, path.join(folder, x.name)) })).sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
      return response(res, 200, { entries, path: relative });
    }
    if (req.method === 'GET' && url.pathname === '/api/file') {
      const file = safeFile(projectFor(url.searchParams.get('projectId')), url.searchParams.get('path'));
      if (fs.statSync(file).size > 128000) throw new Error('This file is too large for the preview. Use Open folder.');
      const text = fs.readFileSync(file, 'utf8'); if (text.includes('\0')) throw new Error('This file is not a text file. Use Open folder.');
      return response(res, 200, { name: path.basename(file), text });
    }
    if (req.method === 'POST') {
      const data = await body(req);
      if (url.pathname === '/api/chatgpt/login') return response(res, 200, await chatgpt.start());
      if (url.pathname === '/api/model') {
        if (busy || sending) throw new Error('Stop the task before switching models.');
        const chat = chatFor(data.chatId);
        if (!['local', 'chatgpt', 'auto'].includes(data.mode)) throw new Error('Unknown model.');
        if (data.mode !== 'local' && !(await chatgpt.status()).connected) throw new Error('Connect ChatGPT first.');
        await ensureRpc(chat);
        const result = await sendRpc('get_available_models');
        const models = result.models || result;
        const target = data.mode !== 'chatgpt' ? { provider: 'local', id: 'local-coder' } : models.find(m => m.provider === 'openai' && m.id === 'gpt-6.1-sol') || models.find(m => m.provider === 'openai' && m.id === 'gpt-5.4');
        if (!target) throw new Error('No supported ChatGPT model is available.');
        await sendRpc('set_model', { provider: target.provider, modelId: target.id });
        chat.mode = data.mode; chat.modelId = target.id; save();
        return response(res, 200, { mode: chat.mode, modelId: target.id });
      }
      if (url.pathname === '/api/projects') {
        const name = String(data.name || '').trim();
        if (!name || name.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || ['.', '..'].includes(name)) throw new Error('Enter a project name without special file characters.');
        let folder;
        if (data.folder) {
          if (!path.isAbsolute(data.folder) || !fs.statSync(data.folder).isDirectory()) throw new Error('Choose an existing folder using its full path.');
          folder = fs.realpathSync(data.folder);
          if (/[/\\]sources([/\\]|$)/i.test(folder) && folder.includes('.chatgpt-projects')) throw new Error('Synced reference folders cannot be used as editable projects.');
        } else { folder = path.join(PROJECTS, name); fs.mkdirSync(folder, { recursive: true }); }
        const existing = state.projects.find(x => x.folder.toLowerCase() === folder.toLowerCase()); if (existing) return response(res, 200, existing);
        const project = { id: crypto.randomUUID(), name, folder }; state.projects.push(project); save(); return response(res, 201, project);
      }
      if (url.pathname === '/api/chats') {
        projectFor(data.projectId);
        const chat = { id: crypto.randomUUID(), projectId: data.projectId, title: 'New conversation', status: 'ready', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
        state.chats.unshift(chat); save(); return response(res, 201, chat);
      }
      if (url.pathname === '/api/rename') {
        const chat = chatFor(data.chatId); chat.title = String(data.title || '').trim().slice(0, 100) || 'Conversation'; save(); return response(res, 200, chat);
      }
      if (url.pathname === '/api/send') {
        if (busy || sending) throw new Error('Wait for the current task or press Stop.');
        const chat = chatFor(data.chatId); const text = String(data.text || '').trim();
        if (!text || text.length > 60000) throw new Error('Enter a message under 60,000 characters.');
        sending = true;
        try { await ensureRpc(chat); } catch (error) { sending = false; throw error; }
        busy = true;
        chat.messages.push({ id: crypto.randomUUID(), role: 'user', text, at: new Date().toISOString() });
        if (chat.title === 'New conversation') chat.title = text.replace(/\s+/g, ' ').slice(0, 60);
        setStatus(chat, 'working');
        if (chat.mode === 'auto') {
          if (!(await chatgpt.status()).connected) { sending = false; failRun('Reconnect ChatGPT or choose Local.'); throw new Error('ChatGPT is not connected.'); }
          const run = { chatId: chat.id, controller: new AbortController(), cloudCalls: 0, workerStart: chat.messages.length };
          autoRun = run; chat.auto = { phase: 'ChatGPT planning', cloudCalls: 0, maxCloudCalls: 2 }; save(); sending = false;
          consultAuto(chat, run).catch(e => { if (autoRun === run) failRun(e.message); });
          return response(res, 200, { accepted: true });
        }
        try { await sendRpc('prompt', { message: text }); } catch (e) { failRun(e.message); throw e; } finally { sending = false; }
        return response(res, 200, { accepted: true });
      }
      if (url.pathname === '/api/stop') {
        if (autoRun) { const run = autoRun; autoRun = null; run.controller.abort(); const chat = chatFor(run.chatId); chat.auto.phase = 'stopped'; }
        if (rpc && busy) { await sendRpc('abort', {}, 30000); busy = false; setStatus(chatFor(rpcChat), 'stopped'); }
        return response(res, 200, { stopped: true });
      }
      if (url.pathname === '/api/open-folder') { spawn('explorer.exe', [projectFor(data.projectId).folder], { detached: true, stdio: 'ignore' }).unref(); return response(res, 200, { opened: true }); }
    }
    if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(path.join(__dirname, file)).pipe(res); return;
    }
    response(res, 404, { error: 'Not found.' });
  } catch (e) { response(res, 400, { error: e.message }); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`AI Builder: http://127.0.0.1:${PORT}`));
function shutdown() { autoRun?.controller.abort(); chatgpt.cancel(); save(); if (rpc) rpc.stdin.end(); server.close(); setTimeout(() => process.exit(), 1500).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
