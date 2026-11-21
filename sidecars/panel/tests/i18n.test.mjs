import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {quotaModelFamily,classifyQuotaGroupId} from '../usage.mjs';
const create=createRequire(import.meta.url)('../../../compat/i18n.cjs');

test('all locales have matching translation keys and interpolation parameters',()=>{
  const dictionaries=Function('return ('+create.toString().replace('let language=', 'return dictionary; let language=')+')')()();
  const keys=Object.keys(dictionaries.en).sort();
  const parameters=text=>[...text.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
  for(const locale of ['zh-CN','zh-TW']){
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(),keys);
    for(const key of keys)assert.deepEqual(parameters(dictionaries[locale][key]),parameters(dictionaries.en[key]),locale+':'+key);
  }
});

test('Traditional locale has safe error fallback, valid remembered toggle and UTC+8 display',()=>{
  const language=create('zh-TW');
  assert.equal(language.errorMessage('未知错误'),language.t('panelUnavailable'));
  assert.equal(language.t('not-a-translation-key'),'not-a-translation-key');
  assert.equal(language.resetDate('2026-10-06T17:15:00Z'),new Intl.DateTimeFormat('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'}).format(new Date('2026-10-06T17:15:00Z')));
  language.setLanguage('invalid');assert.equal(language.language,'en');assert.equal(language.toggle(),'zh-TW');
});

test('English is the first-use default, regardless of browser/host language',()=>{
  for(const initial of [undefined,null,'','zh','fr']){
    const language=create(initial);assert.equal(language.language,'en');assert.equal(language.t('cacheTitle'),'Token usage');
  }
});
test('saved Chinese selection is restored and toggling translates text and countdowns immediately',()=>{
  const language=create('zh-CN'),now=Date.parse('2026-10-06T08:00:00Z');
  assert.equal(language.t('cacheTitle'),'Token 用量');
  assert.equal(language.countdown('2026-10-08T10:00:00Z',now),'2d 2h 0m');
  const saved=language.toggle();assert.equal(saved,'en');assert.equal(create(saved).t('cacheTitle'),'Token usage');
  assert.equal(language.countdown('2026-10-08T10:00:00Z',now),'2d 2h 0m');
  assert.equal(language.countdown('2026-10-06T09:05:30Z',now),'1h 5m');
  assert.equal(language.countdown('2026-10-06T08:45:00Z',now),'45m');
  assert.equal(language.countdown('2026-10-06T08:00:30Z',now),'<1m');
  assert.equal(language.t('sample',{rounds:2,steps:6,requests:3}),'2 turns · 6 steps · 3 samples');
  language.toggle();assert.equal(language.t('sample',{rounds:2,steps:6,requests:3}),'2轮 6步 · 3 次采样');
});
test('expired resets do not imply refilled quota in either language',()=>{
  const language=create();const now=Date.parse('2026-10-06T08:00:00Z');
  assert.equal(language.countdown('2026-10-06T08:00:00Z',now),'Waiting for refresh');
  language.toggle();assert.equal(language.countdown('2026-10-06T08:00:00Z',now),'等待刷新');
  assert.equal(language.countdown(null,now),'—');
});
test('English errors do not leak untranslated Chinese backend messages',()=>{
  const language=create();assert.equal(language.errorMessage('请先打开 Antigravity'),'Open Antigravity to connect.');
  assert.equal(language.errorMessage('Antigravity 接口 GetUserStatus 返回 401'),'Antigravity GetUserStatus returned HTTP 401.');
  assert.equal(language.errorMessage('未知错误'),'Statistics are temporarily unavailable.');
  language.toggle();assert.equal(language.errorMessage('请先打开 Antigravity'),'请先打开 Antigravity');
  assert.equal(language.errorMessage('Waiting to reconnect'),'等待控件重新连接');
});
test('Traditional Chinese (zh-TW) provides accurate localized terminology and toggle support',()=>{
  const language=create('zh-TW'),now=Date.parse('2026-10-06T08:00:00Z');
  assert.equal(language.language,'zh-TW');
  assert.equal(language.t('cache'),'快取命中');
  assert.equal(language.t('cacheRate'),'快取命中率');
  assert.equal(language.t('cacheMiss'),'未快取輸入');
  assert.equal(language.t('panelSpeed'),'速率');
  assert.equal(language.t('panelCache'),'快取');
  assert.equal(language.t('panelSharedQuota'),'配額');
  assert.equal(language.t('argonWeek'),'Argon 每週配額');
  assert.equal(language.t('sample',{rounds:2,steps:6,requests:3}),'2 輪 6 步 · 3 次取樣');
  assert.equal(language.countdown('2026-10-08T10:00:00Z',now),'2d 2h 0m');
  assert.equal(language.elapsed(90),'1 分 30 秒');
  assert.equal(language.errorMessage('请先打开 Antigravity'),'請先開啟 Antigravity');
  assert.equal(language.errorMessage('未找到 Antigravity 桌面后台'),'找不到 Antigravity 桌面背景程式');
  assert.equal(language.errorMessage('会话统计数据超过内存预算'),'對話統計資料超出記憶體預算');
  assert.equal(language.errorMessage('Antigravity 接口 GetUserStatus 返回 401'),'Antigravity API GetUserStatus 回傳 HTTP 401');
  const saved=language.toggle();assert.equal(saved,'en');
  assert.equal(language.toggle(),'zh-TW');
});

test('errorMessage never leaks raw subprocess commands in any locale and translates IDE/Desktop process errors',()=>{
  const rawLeak='Command failed: powershell.exe -NoLogo -NoProfile Get-CimInstance Win32_Process';
  const zh=create('zh-CN'),tw=create('zh-TW'),en=create('en');
  assert.equal(zh.errorMessage(rawLeak),'统计面板暂时无法连接');
  assert.equal(tw.errorMessage(rawLeak),'統計面板暫時無法連線');
  assert.equal(en.errorMessage(rawLeak),'Statistics are temporarily unavailable.');

  assert.equal(zh.errorMessage('读取 Antigravity 进程信息超时'),'读取 Antigravity 进程信息超时');
  assert.equal(tw.errorMessage('读取 Antigravity 进程信息超时'),'讀取 Antigravity 處理程序資訊逾時');
  assert.equal(en.errorMessage('读取 Antigravity 进程信息超时'),'Timed out reading Antigravity process information.');

  assert.equal(zh.errorMessage('Timed out reading Antigravity IDE processes'),'读取 Antigravity IDE 进程信息超时');
  assert.equal(tw.errorMessage('Timed out reading Antigravity IDE processes'),'讀取 Antigravity IDE 處理程序資訊逾時');
  assert.equal(en.errorMessage('Timed out reading Antigravity IDE processes'),'Timed out reading Antigravity IDE processes.');
});

test('Antigravity 2.34.0 Orchestrator custom planner labels route to matching Gemini / Argon / 3P quota buckets',()=>{
  const language=create('zh-CN');
  const groups=[
    {id:'gemini',name:'Gemini'},
    {id:'gemini-argon',name:'Gemini (Argon)'},
    {id:'3p',name:'Claude / GPT'},
  ];
  assert.equal(language.quotaGroupKind({name:'Orchestrator'}),'gemini');
  assert.equal(language.quotaGroupKind({name:'Select model, current: Orchestrator Gemini 4 Neon (XHigh)'}),'gemini');
  assert.equal(language.quotaGroupKind({name:'Select model, current: Orchestrator Gemini 4 Argon'}),'gemini-argon');
  assert.equal(language.quotaGroupKind({name:'Select model, current: Orchestrator Claude Opus 5.5 (Max)'}),'3p');
  assert.equal(language.quotaGroupKind({name:'Orchestrator GPT-OSS 120B'}),'3p');

  assert.equal(language.chooseQuotaGroup(groups,['Select model, current: Orchestrator Claude Opus 5.5 (Max)'],null)?.id,'3p');
  assert.equal(language.chooseQuotaGroup(groups,['Select model, current: Orchestrator Gemini 4 Carbon'],null)?.id,'gemini');
  assert.equal(language.chooseQuotaGroup(groups,['Orchestrator'],null)?.id,'gemini');

  assert.equal(quotaModelFamily('Orchestrator Claude Opus 5.5 (Max)'),'3p');
  assert.equal(quotaModelFamily('Orchestrator Gemini 4 Neon (XHigh)'),'gemini');
  assert.equal(quotaModelFamily('Orchestrator'),'gemini');
  assert.equal(classifyQuotaGroupId(groups,'Orchestrator Claude Sonnet 4.6'),'3p');
});
