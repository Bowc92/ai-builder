const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');
module.exports = function plan(base, prompt, signal) {
  return new Promise((resolve, reject) => {
    const cwd = path.join(base, 'state', 'planner'); fs.mkdirSync(cwd, { recursive: true });
    const child = spawn(process.execPath, [path.join(base, 'pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
      '--mode', 'rpc', '--provider', 'openai', '--model', 'gpt-6.1-sol', '--thinking', 'off',
      '--no-tools', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates',
      '--system-prompt', path.join(base, 'ui', 'PLANNER_PROMPT.md')],
      { cwd, windowsHide: true, env: { ...process.env, PI_CODING_AGENT_DIR: path.join(base, 'pi-state') } });
    let buffer = '', answer = '', done = false;
    const decoder = new StringDecoder('utf8');
    const finish = (error) => {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      child.stdin.end(); child.kill(); error ? reject(error) : resolve(answer);
    };
    const abort = () => finish(new Error('Stopped.'));
    const timer = setTimeout(() => finish(new Error('ChatGPT planning timed out. Try Local mode or send again.')), 180000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    child.on('error', () => finish(new Error('The planner could not start.')));
    child.on('exit', () => { if (!done) finish(new Error('The planner stopped before returning a plan.')); });
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk); let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let record; try { record = JSON.parse(line); } catch { continue; }
        if (record.type === 'response' && record.success === false) { finish(new Error('ChatGPT could not accept the planning request.')); return; }
        if (record.type === 'message_end' && record.message?.role === 'assistant') {
          if (record.message.errorMessage) { finish(new Error('ChatGPT planning failed. Check your connection and plan allowance.')); return; }
          answer = (record.message.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').slice(0, 12000);
        }
        if (record.type === 'agent_settled') { finish(answer.trim() ? null : new Error('ChatGPT returned an empty plan.')); return; }
      }
    });
    child.stdin.write(JSON.stringify({ id: 'plan', type: 'prompt', message: prompt }) + '\n');
  });
};
