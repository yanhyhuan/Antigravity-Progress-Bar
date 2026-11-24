#!/usr/bin/env node
// agy PreInvocation hook. When the whole prompt is #usage (#u, #用量, ##), it
// shows local usage details and terminates before the model is called, so it
// costs no request or quota. Every other prompt passes through untouched.
import { isUsageTrigger, readStdin, debug, fromCli } from './common.mjs';

const respond = value => process.stdout.write(JSON.stringify(value) + '\n');

let payload = null;
try { payload = await readStdin(8 * 1024 * 1024); } catch (error) { debug(error?.code || 'input'); }
if (!payload || typeof payload !== 'object' || !isUsageTrigger(payload.lastUserInput) || !fromCli(payload)) respond({});
else {
  let text;
  try {
    const { usageText } = await import('./report.mjs');
    text = await usageText({ conversationId: payload.conversationId, color: false });
  } catch {
    debug('report');
    text = 'Antigrative Dashboard: usage details unavailable · 用量详情暂不可用';
  }
  respond({ injectSteps: [{ errorMessage: { userMessage: text } }], terminationBehavior: 'terminate' });
}
