const $ = id => document.getElementById(id);
let data, projectId = localStorage.getItem('builder.project'), chatId = localStorage.getItem('builder.chat'), chat = null, working = false, filePath = '', startedAt = 0;
const icon = name => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS(s.namespaceURI, 'use'); u.setAttribute('href', '#' + name); s.append(u); return s; };
function showError(text) { $('error').textContent = text; $('error').hidden = !text; }
async function api(url, body) {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Builder-Token': data.token }, body: JSON.stringify(body) });
  const result = await r.json(); if (!r.ok) throw new Error(result.error || 'Something went wrong.'); return result;
}
function currentProject() { return data.projects.find(p => p.id === projectId); }
function remember() { localStorage.setItem('builder.project', projectId || ''); localStorage.setItem('builder.chat', chatId || ''); }
async function loadState() {
  data = await api('/api/state'); if (!data.projects.some(p => p.id === projectId)) projectId = data.projects[0].id;
  renderSidebar(); $('projectTitle').textContent = currentProject().name;
}
function renderSidebar() {
  $('projectList').replaceChildren();
  for (const project of data.projects) {
    const row = document.createElement('button'); row.className = 'project-row' + (project.id === projectId ? ' active' : '');
    const text = document.createElement('span'); text.textContent = project.name; row.append(icon('folder'), text);
    row.onclick = () => selectProject(project.id).catch(e => showError(e.message)); row.disabled = working;
    $('projectList').append(row);
  }
  const query = $('search').value.toLowerCase();
  const chats = data.chats.filter(c => c.projectId === projectId && c.title.toLowerCase().includes(query));
  $('chatList').replaceChildren();
  if (!chats.length) { const empty = document.createElement('div'); empty.className = 'empty-small'; empty.textContent = query ? 'No matching conversations.' : 'Start a conversation about this project.'; $('chatList').append(empty); }
  for (const item of chats) {
    const row = document.createElement('div'); row.className = 'chat-row' + (item.id === chatId ? ' active' : ''); row.tabIndex = working ? -1 : 0; row.setAttribute('role', 'button');
    const text = document.createElement('span'); text.textContent = item.title; row.append(icon('chat'), text);
    const rename = document.createElement('button'); rename.className = 'rename'; rename.textContent = '···'; rename.title = 'Rename conversation'; rename.setAttribute('aria-label', 'Rename ' + item.title); rename.disabled = working;
    rename.onclick = async e => { e.stopPropagation(); const title = window.prompt('Conversation name', item.title); if (title !== null) { try { await api('/api/rename', { chatId: item.id, title }); await loadState(); } catch (err) { showError(err.message); } } };
    row.append(rename); row.onclick = () => { if (!working) selectChat(item.id).catch(e => showError(e.message)); };
    row.onkeydown = e => { if (e.key === 'Enter' && !working) selectChat(item.id).catch(err => showError(err.message)); };
    $('chatList').append(row);
  }
}
async function selectProject(id) {
  if (working) throw new Error('Press Stop before switching projects.');
  projectId = id; filePath = ''; chatId = data.chats.find(c => c.projectId === id)?.id || null;
  $('projectTitle').textContent = currentProject().name; await selectChat(chatId); await loadFiles();
}
async function selectChat(id) {
  if (working && id !== chatId) throw new Error('Press Stop before switching conversations.');
  chatId = id; chat = id ? await api('/api/chats/' + id) : null;
  working = Boolean(data.busy && data.activeChat === id); remember(); renderSidebar(); renderMessages(true); renderActivity();
  document.body.classList.remove('sidebar-open');
}
function renderText(text) {
  const container = document.createElement('div'); const pattern = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let match, offset = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > offset) { const p = document.createElement('div'); p.className = 'prose'; p.textContent = text.slice(offset, match.index); container.append(p); }
    const block = document.createElement('div'); block.className = 'code-block';
    const heading = document.createElement('div'); heading.className = 'code-heading';
    const language = document.createElement('span'); language.textContent = match[1].trim() || 'Code';
    const button = document.createElement('button'); button.className = 'copy-button'; button.textContent = 'Copy'; const value = match[2];
    button.onclick = async () => { try { await navigator.clipboard.writeText(value); button.textContent = 'Copied'; setTimeout(() => button.textContent = 'Copy', 1500); } catch { showError('Select the code and copy it manually.'); } };
    heading.append(language, button); const pre = document.createElement('pre'); pre.textContent = value; block.append(heading, pre); container.append(block); offset = pattern.lastIndex;
  }
  if (offset < text.length) { const p = document.createElement('div'); p.className = 'prose'; p.textContent = text.slice(offset); container.append(p); }
  return container;
}
function renderMessages(forceScroll = false) {
  const switcher = document.getElementById('modelSwitch');
  if (switcher) { switcher.disabled = working; switcher.textContent = chat?.mode === 'auto' ? 'Auto · ChatGPT + Local ▾' : chat?.mode === 'chatgpt' ? 'ChatGPT ▾' : 'Local model ▾'; }
  const modelLabel = document.querySelector('.composer-bottom > span');
  if (modelLabel) modelLabel.textContent = chat?.mode === 'auto' ? 'Auto · ChatGPT plans, Local executes · max 2 consultations/request' : chat?.mode === 'chatgpt' ? 'ChatGPT · ' + chat.modelId : 'Qwen3.5 · On your computer';
  const conversation = $('conversation'); const nearBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 140;
  $('welcome').hidden = Boolean(chat?.messages.length); $('messages').replaceChildren();
  for (const message of chat?.messages || []) {
    if (!message.text && !message.tools?.length && !working) continue;
    const row = document.createElement('article'); row.className = 'message ' + message.role;
    if (message.role === 'assistant') { const label = document.createElement('div'); label.className = 'assistant-label'; label.textContent = 'AI Builder'; row.append(label); }
    const body = document.createElement('div'); body.className = 'message-body'; body.append(renderText(message.text || ''));
    for (const tool of message.tools || []) {
      const details = document.createElement('details'); details.className = 'tool-card' + (tool.status === 'error' ? ' failed' : '');
      const summary = document.createElement('summary'); const mark = document.createElement('span'); mark.className = 'tool-state'; mark.textContent = tool.status === 'working' ? '◌' : tool.status === 'error' ? '!' : '✓'; summary.append(mark, document.createTextNode(tool.label));
      const pre = document.createElement('pre'); pre.textContent = tool.detail + (tool.output ? '\n\n' + tool.output : ''); details.append(summary, pre); body.append(details);
    }
    row.append(body); $('messages').append(row);
  }
  if (working) { const line = document.createElement('div'); line.className = 'loading-line'; line.textContent = 'Working on your request…'; $('messages').append(line); }
  $('send').hidden = working; $('stop').hidden = !working; $('input').disabled = working;
  $('newChat').disabled = working; $('addProject').disabled = working;
  if (!chat?.messages.length && !working) conversation.scrollTop = 0; else if (forceScroll || nearBottom) conversation.scrollTop = conversation.scrollHeight;
}
function renderActivity() {
  const tools = (chat?.messages || []).flatMap(m => m.tools || []);
  $('statusBadge').textContent = working ? 'Working' : chat?.status === 'error' ? 'Needs attention' : chat?.status === 'stopped' ? 'Stopped' : 'Ready';
  $('statusBadge').className = 'badge' + (working ? ' working' : '');
  $('taskTitle').textContent = chat?.title && chat.messages.length ? chat.title : 'Ready when you are';
  $('taskSubtitle').textContent = working ? (tools.some(t => t.status === 'working') ? 'Working with your project files.' : 'Preparing a response. New conversations can take longer.') : tools.length ? 'Actual actions from this conversation.' : 'The agent’s real actions and results appear here.';
  $('toolList').replaceChildren();
  for (const tool of tools.slice(-10)) {
    const row = document.createElement('div'); row.className = 'activity-tool'; const mark = document.createElement('i'); mark.textContent = tool.status === 'working' ? '◌' : tool.status === 'error' ? '!' : '✓';
    const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = tool.label; const status = document.createElement('span'); status.textContent = tool.status === 'working' ? 'In progress' : tool.status === 'error' ? 'Returned an error' : 'Finished'; info.append(title, status); row.append(mark, info); $('toolList').append(row);
  }
}
async function loadFiles() {
  try {
    const result = await api('/api/files?projectId=' + encodeURIComponent(projectId) + '&path=' + encodeURIComponent(filePath));
    $('filesBack').hidden = !filePath; $('fileList').replaceChildren();
    if (!result.entries.length) { const empty = document.createElement('div'); empty.className = 'empty-small'; empty.textContent = 'Your project files will appear here.'; $('fileList').append(empty); }
    for (const entry of result.entries) {
      const row = document.createElement('button'); row.className = 'file-row'; const text = document.createElement('span'); text.textContent = entry.name; row.append(icon(entry.directory ? 'folder' : 'file'), text);
      row.onclick = async () => { try { if (entry.directory) { filePath = entry.path; await loadFiles(); } else { const file = await api('/api/file?projectId=' + encodeURIComponent(projectId) + '&path=' + encodeURIComponent(entry.path)); $('previewTitle').textContent = file.name; $('previewText').textContent = file.text; $('previewDialog').showModal(); } } catch (e) { showError(e.message); } };
      $('fileList').append(row);
    }
  } catch (e) { showError(e.message); }
}
$('newChat').onclick = async () => { try { const c = await api('/api/chats', { projectId }); await loadState(); await selectChat(c.id); $('input').focus(); } catch (e) { showError(e.message); } };
$('compose').onsubmit = async e => {
  e.preventDefault(); const text = $('input').value.trim(); if (!text || working) return; showError('');
  try {
    if (!chatId) { const c = await api('/api/chats', { projectId }); chatId = c.id; chat = c; }
    working = true; startedAt = Date.now(); chat.messages.push({ id: 'sending', role: 'user', text }); renderMessages(true); renderSidebar(); renderActivity();
    await api('/api/send', { chatId, text }); $('input').value = ''; chat = await api('/api/chats/' + chatId); remember(); await loadState(); renderMessages(true);
  } catch (err) { working = false; chat = chatId ? await api('/api/chats/' + chatId) : null; renderMessages(); renderSidebar(); showError(err.message); }
};
$('input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('compose').requestSubmit(); } };
$('stop').onclick = async () => { $('stop').disabled = true; try { await api('/api/stop', {}); working = false; chat = await api('/api/chats/' + chatId); renderMessages(); renderActivity(); await loadState(); } catch (e) { showError(e.message); } finally { $('stop').disabled = false; } };
$('search').oninput = renderSidebar;
$('addProject').onclick = () => { $('projectForm').reset(); $('projectDialog').showModal(); $('projectName').focus(); };
$('projectForm').onsubmit = async e => { e.preventDefault(); try { const p = await api('/api/projects', { name: $('projectName').value, folder: $('projectFolder').value.trim() || undefined }); $('projectDialog').close(); await loadState(); await selectProject(p.id); } catch (err) { $('projectDialog').close(); showError(err.message); } };
for (const button of document.querySelectorAll('.close-dialog')) button.onclick = () => button.closest('dialog').close();
$('about').onclick = () => $('aboutDialog').showModal();
$('openFolder').onclick = () => api('/api/open-folder', { projectId }).catch(e => showError(e.message));
$('refreshFiles').onclick = loadFiles;
$('filesBack').onclick = () => { const parts = filePath.split(/[\\/]/); parts.pop(); filePath = parts.join('/'); loadFiles(); };
$('sidebarToggle').onclick = () => window.innerWidth <= 760 ? document.body.classList.toggle('sidebar-open') : document.body.classList.toggle('sidebar-hidden');
$('closeSidebar').onclick = () => document.body.classList.remove('sidebar-open');
$('activityToggle').onclick = () => window.innerWidth <= 1250 ? document.body.classList.toggle('activity-open') : document.body.classList.toggle('activity-hidden');
for (const button of document.querySelectorAll('[data-prompt]')) button.onclick = () => { $('input').value = button.dataset.prompt; $('input').focus(); };
async function start() {
  await loadState();
  if (!data.chats.some(c => c.id === chatId && c.projectId === projectId)) chatId = data.chats.find(c => c.projectId === projectId)?.id || null;
  await selectChat(chatId); await loadFiles();
  const stream = new EventSource('/api/events');
  stream.onmessage = async e => {
    const item = JSON.parse(e.data); if (item.chatId !== chatId) return;
    if (item.type === 'status') {
      working = item.busy && item.status === 'working'; if (working && !startedAt) startedAt = Date.now();
      if (!working) { chat = await api('/api/chats/' + chatId); await loadState(); await loadFiles(); if (item.error) showError(item.error); }
      renderMessages(); renderActivity(); return;
    }
    if (!chat) return;
    if (item.type === 'message') { const i = chat.messages.findIndex(m => m.id === item.message.id); if (i < 0) chat.messages.push(item.message); else chat.messages[i] = item.message; }
    if (item.type === 'delta') { const m = chat.messages.find(m => m.id === item.messageId); if (m) m.text += item.delta; }
    if (item.type === 'tool') { let m = chat.messages.find(m => m.id === item.messageId); if (!m) { m = { id: item.messageId, role: 'assistant', text: '', tools: [] }; chat.messages.push(m); } m.tools ||= []; const i = m.tools.findIndex(t => t.id === item.tool.id); if (i < 0) m.tools.push(item.tool); else m.tools[i] = item.tool; }
    renderMessages(); renderActivity();
  };
  stream.onerror = () => { if (working) showError('Connection interrupted. Your conversation is saved; reconnecting…'); };
  stream.onopen = () => { if ($('error').textContent.startsWith('Connection interrupted')) showError(''); };
}
start().catch(e => showError('Could not connect to the local builder: ' + e.message));

// Account authorization stays in the user's browser; credentials never reach this page.
const oldPill = document.querySelector('.model-pill');
const modelSwitch = document.createElement('button'); modelSwitch.id = 'modelSwitch'; modelSwitch.className = 'model-pill'; modelSwitch.textContent = 'Local model ▾'; oldPill.replaceWith(modelSwitch);
const modelDialog = document.createElement('dialog');
modelDialog.innerHTML = '<div class="dialog-header"><h2>Choose your AI</h2><button class="icon" id="closeModels" aria-label="Close">×</button></div><p>Local runs on your computer. ChatGPT uses your plan limits and receives this conversation and project content the agent reads.</p><p id="connectionStatus">Checking connection…</p><div class="dialog-actions"><button class="secondary" id="chooseLocal">Use Local</button><button class="primary" id="chooseChatGPT">Use ChatGPT</button></div><p><button class="text-button" id="connectChatGPT">Sign in with ChatGPT</button></p><p><a id="authLink" target="_blank" rel="noopener noreferrer" hidden>Continue sign-in →</a></p><p class="muted">Local is the default for new conversations. No API key or automatic paid fallback. Stop before switching.</p>';
document.body.append(modelDialog);
const autoButton = document.createElement('button'); autoButton.id = 'chooseAuto'; autoButton.className = 'primary'; autoButton.textContent = 'Auto: ChatGPT plans, Local builds';
modelDialog.querySelector('.dialog-actions').append(autoButton);
const autoNote = document.createElement('p'); autoNote.className = 'muted'; autoNote.textContent = 'Auto sends your task and, if needed, a short failure summary to ChatGPT. One initial plan and at most one repair consultation per request. This uses your subscription allowance; it is not unlimited.'; modelDialog.append(autoNote);
let authTimer;
async function refreshConnection() {
  const result = await api('/api/chatgpt');
  $('connectionStatus').textContent = result.connected ? 'ChatGPT connected.' : result.error || (result.state === 'waiting' ? 'Complete sign-in in your browser.' : 'ChatGPT is not connected.');
  $('authLink').hidden = !result.url;
  if (result.url) $('authLink').href = result.url;
  $('connectChatGPT').disabled = ['starting', 'waiting'].includes(result.state);
  $('chooseChatGPT').disabled = !result.connected;
  $('chooseAuto').disabled = !result.connected;
  if (result.connected) clearInterval(authTimer);
}
modelSwitch.onclick = () => { modelDialog.showModal(); refreshConnection().catch(e => showError(e.message)); };
$('closeModels').onclick = () => { modelDialog.close(); clearInterval(authTimer); };
$('connectChatGPT').onclick = async () => { try { await api('/api/chatgpt/login', {}); await refreshConnection(); clearInterval(authTimer); authTimer = setInterval(() => refreshConnection().catch(() => {}), 1500); } catch(e) { $('connectionStatus').textContent = e.message; } };
async function chooseModel(mode) {
  try {
    if (!chatId) { chat = await api('/api/chats', { projectId }); chatId = chat.id; }
    await api('/api/model', { chatId, mode });
    await loadState(); await selectChat(chatId); modelDialog.close();
  } catch(e) { $('connectionStatus').textContent = e.message; }
}
$('chooseLocal').onclick = () => chooseModel('local');
$('chooseChatGPT').onclick = () => chooseModel('chatgpt');
$('chooseAuto').onclick = () => chooseModel('auto');

