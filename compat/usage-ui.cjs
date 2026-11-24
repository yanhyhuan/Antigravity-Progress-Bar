// Shared local usage views. Values and model labels are inserted as text.
module.exports = function createUsageDashboard({root,language,setMarkup,pricing:injectedPricing,hostLabel='Antigravity',guideDismissed=false,onDismissGuide,onLanguage,onRefresh,onScope}) {
function createFallbackPricing() {
  const tierMap = {
    minimal: 'Minimal', low: 'Low', medium: 'Medium', med: 'Medium',
    high: 'High', xhigh: 'XHigh', 'extra high': 'XHigh', extra: 'XHigh', max: 'Max',
    thinking: 'Thinking', tiered: 'Tiered', orchestrator: 'Orchestrator',
  };
  const tierParen = /\s*\(((?:extra[\s-]+high|xhigh|extra|high|medium|med|low|minimal|max)[\s-]+thinking|extra[\s-]+high|xhigh|extra|high|medium|med|low|minimal|thinking|max|tiered|orchestrator)\)\s*$/i;
  const tierSuffix = /[\s-]+(extra[\s-]+high|xhigh|extra|high|medium|med|low|minimal|thinking|max|tiered|orchestrator)$/i;
  const orchParen = /^orchestrator\s*\((.+)\)$/i;
  const orchPrefix = /^orchestrator[\s-]+(.+)$/i;
  const geminiProOrch = /^gemini[\s-]+pro[\s-]+(?:orchestrator|coordinator)(?:[\s-]+(.+))?$/i;
  const geminiSeedAliases = new Map([
    ['argon', 'Gemini 4 Argon'],
    ['argon trial', 'Gemini 4 Argon Trial'],
    ['carbon', 'Gemini 4 Carbon'],
    ['hydrogen', 'Gemini 4 Hydrogen'],
    ['neon', 'Gemini 4 Neon'],
  ]);
  const geminiCodename = /^gemini[\s-]+(\d+(?:\.\d+)?)[\s-]+(.+)$/i;
  const geminiGenericTier = /^(?:pro|flash|ultra|nano|lite|mini|exp|experimental|preview|thinking|live)(?:[\s-].*)?$/i;
  function formatModelBase(base) {
    let name = base.trim().replace(/\s+/g, ' ');
    if (!name) return 'Unknown';
    if (!/[A-Z\s]/.test(name) && name.includes('-')) {
      name = name.replace(/(^|-)(\d+)-(\d)(?=$|-)/g, '$1$2.$3').replace(/-/g, ' ');
      name = name.split(' ').map(tok => (tok === 'gpt' ? 'GPT' : /^o\d/.test(tok) ? tok : /^[a-z]/.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok)).join(' ');
    } else if (!/[A-Z\s]/.test(name) && !/^o\d/.test(name) && /^[a-z]/.test(name)) {
      name = name[0].toUpperCase() + name.slice(1);
    } else {
      name = name.replace(/(^|[\s-])(\d+)-(\d)(?=$|[\s-])/g, '$1$2.$3');
    }
    return name;
  }
  const parsedCache = new Map();
  function parseModelBase(raw) {
    const input = String(raw || '').trim();
    const hit = parsedCache.get(input);
    if (hit) return hit;
    let base = input.replace(/-n$/i, '').trim();
    const tiers = [];
    const gpo = base.match(geminiProOrch);
    if (gpo) {
      tiers.push('Orchestrator');
      base = (gpo[1] || 'carbon').trim();
    }
    for (let i = 0; i < 3; i++) {
      let m = base.match(tierParen) || base.match(tierSuffix);
      if (m) {
        const rest = base.slice(0, m.index).trim();
        if (!rest) break;
        const normTier = m[1].toLowerCase().replace(/[\s-]+/g, ' ');
        if (normTier.endsWith(' thinking') && normTier !== 'thinking') {
          const eff = normTier.slice(0, -9).trim();
          tiers.unshift(tierMap[eff] || eff, 'Thinking');
        } else {
          tiers.unshift(tierMap[normTier] || m[1]);
        }
        base = rest;
        continue;
      }
      m = base.match(orchParen) || base.match(orchPrefix);
      if (m) {
        const inner = m[1].trim();
        if (!inner) break;
        tiers.unshift('Orchestrator');
        base = inner;
        continue;
      }
      break;
    }
    const fullName = formatModelBase(base);
    let shortName = fullName, shortKey = null, hasPrefix = false;
    const gm = fullName.match(geminiCodename);
    if (gm && /^[a-z]/i.test(gm[2]) && !geminiGenericTier.test(gm[2])) {
      shortName = gm[2];
      shortKey = shortName.toLowerCase();
      hasPrefix = true;
    }
    const key = fullName.toLowerCase();
    const tier = tiers.join(' · ');
    const parsed = { key, canonicalKey: key, name: shortName, fullName, baseDisplay: fullName, shortKey, hasPrefix, tier, hasDisplay: /[A-Z\s]/.test(base) };
    if (parsedCache.size >= 2048) parsedCache.clear();
    parsedCache.set(input, parsed);
    return parsed;
  }
  const seedAliases = new Map();
  for (const [sk, fn] of geminiSeedAliases) seedAliases.set(sk, { key: fn.toLowerCase(), name: fn.replace(/^Gemini\s+\d+(?:\.\d+)?\s+/i, ''), fullName: fn });
  const seedState = { shortAliases: seedAliases, ambiguousShorts: new Set() };
  function buildShortAliases(rawModels = []) {
    const observed = new Map();
    for (const raw of rawModels) {
      const p = parseModelBase(raw);
      if (!p.hasPrefix || !p.shortKey) continue;
      const cur = observed.get(p.shortKey);
      if (cur === undefined) observed.set(p.shortKey, { key: p.key, name: p.name, fullName: p.fullName });
      else if (cur && cur.key !== p.key) observed.set(p.shortKey, null);
    }
    const shortAliases = new Map(), ambiguousShorts = new Set();
    for (const [sk, fn] of geminiSeedAliases) {
      if (!observed.has(sk)) shortAliases.set(sk, { key: fn.toLowerCase(), name: fn.replace(/^Gemini\s+\d+(?:\.\d+)?\s+/i, ''), fullName: fn });
    }
    for (const [sk, info] of observed) {
      if (info) shortAliases.set(sk, info);
      else ambiguousShorts.add(sk);
    }
    return { shortAliases, ambiguousShorts };
  }
  function parseModelTier(raw, aliases = seedState) {
    const p = parseModelBase(raw);
    const shortAliases = aliases?.shortAliases || seedState.shortAliases;
    const ambiguousShorts = aliases?.ambiguousShorts || seedState.ambiguousShorts;
    if (!p.hasPrefix) {
      const alias = shortAliases.get(p.key);
      if (alias) return { ...p, key: alias.key, canonicalKey: alias.key, name: alias.name, fullName: alias.fullName, baseDisplay: alias.fullName };
    } else if (p.shortKey && ambiguousShorts.has(p.shortKey)) {
      return { ...p, name: p.fullName };
    }
    return p;
  }
  function modelPrice(key, date = '') {
    const k = String(key || '').toLowerCase(), d = String(date || '');
    const afterDec26 = d >= '2026-12-01', afterJan27 = d >= '2027-01-01';
    if (/^gemini 4 neon\b/.test(k)) return { base: [3, 0.15, 0, 15], note: 'flat1m' };
    if (/^gemini 4 hydrogen\b/.test(k)) return { base: [1.5, 0.075, 0, 7.5], note: 'flat1m' };
    if (/^gemini 4 (carbon|argon)\b/.test(k)) return afterDec26 ? { base: [4, 0.2, 0, 20], note: 'flat1m' } : { base: [2, 0.1, 0, 10], note: 'intro' };
    if (/^gemini 3\.[678] flash\b/.test(k)) return afterJan27 ? { base: [1.5, 0.15, 0, 7.5] } : { base: [0.75, 0.075, 0, 3.75], note: 'intro' };
    if (/^gemini 3\.5 flash[\s-]lite\b/.test(k)) return { base: [0.3, 0.03, 0, 2.5] };
    if (/^gemini 3\.1 flash[\s-]lite\b/.test(k)) return { base: [0.25, 0.025, 0, 1.5] };
    if (/^gemini 2\.5 flash[\s-]lite\b/.test(k)) return { base: [0.1, 0.01, 0, 0.4] };
    if (/^gemini 2\.5 flash\b/.test(k)) return { base: [0.3, 0.03, 0, 2.5] };
    if (/^gemini 2\.0 flash\b/.test(k)) return { base: [0.1, 0.025, 0, 0.4] };
    if (/^gemini (?:3(?:\.\d+)? )?flash\b/.test(k)) return { base: [0.5, 0.05, 0, 3] };
    if (/^gemini 2\.5 pro\b/.test(k)) return { base: [1.25, 0.125, 0, 10], longAt: 200000, long: [2.5, 0.25, 0, 15] };
    if (/^gemini (?:3(?:\.\d+)? )?pro\b/.test(k)) return { base: [2, 0.2, 0, 12], longAt: 200000, long: [4, 0.4, 0, 18] };
    if (/^claude (?:opus 5\.5|5\.5 opus)\b/.test(k)) return { base: [4, 0.2, 5, 20], note: 'flat1m' };
    if (/^claude (?:sonnet 5\.5|5\.5 sonnet)\b/.test(k)) return { base: [2, 0.1, 2.5, 10], note: 'flat1m' };
    if (/^claude (?:haiku 5\.5|5\.5 haiku)\b/.test(k)) return { base: [0.1, 0.01, 0.125, 0.5], longAt: 100000, long: [0.5, 0.05, 0.625, 2.5] };
    if (/^claude (?:opus 4\.6|4\.6 opus)\b/.test(k)) return { base: [5, 0.5, 6.25, 25], note: 'flat1m' };
    if (/^claude (?:opus 4\.5|4\.5 opus)\b/.test(k)) return { base: [5, 0.5, 6.25, 25] };
    if (/^claude (?:opus (?:3|4(?:\.1)?)|(?:3|4(?:\.1)?) opus)\b/.test(k)) return { base: [15, 1.5, 18.75, 75] };
    if (/^claude opus\b/.test(k)) return { base: [5, 0.5, 6.25, 25] };
    if (/^claude (?:sonnet 4\.6|4\.6 sonnet)\b/.test(k)) return { base: [3, 0.3, 3.75, 15], note: 'flat1m' };
    if (/^claude (?:sonnet|[\d.]+ sonnet)\b/.test(k)) return { base: [3, 0.3, 3.75, 15] };
    if (/^claude (?:haiku 3\.5|3\.5 haiku)\b/.test(k)) return { base: [0.8, 0.08, 1, 4] };
    if (/^claude (?:haiku|[\d.]+ haiku)\b/.test(k)) return { base: [1, 0.1, 1.25, 5] };
    if (/^gpt 5\.4 nano\b/.test(k)) return { base: [0.2, 0.02, 0.2, 1.25] };
    if (/^gpt 5\.4 mini\b/.test(k)) return { base: [0.75, 0.075, 0.75, 4.5] };
    if (/^gpt 5\.4\b/.test(k)) return { base: [2.5, 0.25, 2.5, 15], longAt: 272000, long: [5, 0.5, 5, 22.5] };
    if (/^gpt 5 mini\b/.test(k)) return { base: [0.25, 0.025, 0.25, 2] };
    if (/^gpt 5\b/.test(k)) return { base: [1.25, 0.125, 1.25, 10] };
    if (/^gpt-oss 120b\b/.test(k)) return { base: [0.15, 0.075, 0.15, 0.6] };
    if (/^gpt 4\.1\b/.test(k)) return { base: [2, 0.5, 2, 8] };
    if (/^gpt 4o\b/.test(k)) return { base: [2.5, 1.25, 2.5, 10] };
    if (/^o3 pro\b/.test(k)) return { base: [20, 5, 20, 80] };
    if (/^o3\b/.test(k)) return { base: [2, 0.5, 2, 8] };
    if (/^o4 mini\b/.test(k)) return { base: [1.1, 0.275, 1.1, 4.4] };
    return null;
  }
  function tokenCost(r, p) {
    if (!p) return null;
    const inp = (r.uncached || 0) + (r.cacheRead || 0) + (r.cacheWrite || 0);
    const avgIn = p.longAt && r.requests > 0 ? inp / r.requests : 0;
    const rate = p.long && avgIn > p.longAt ? p.long : p.base;
    return ((r.uncached || 0) * rate[0] + (r.cacheRead || 0) * rate[1] + (r.cacheWrite || 0) * rate[2] + (r.output || 0) * rate[3]) / 1e6;
  }
  function quotaFamily(raw) {
    const s = String(raw || '');
    if (/(?:^|[^a-z])argon(?:$|[^a-z])/i.test(s)) return 'gemini-argon';
    if (/gemini|hydrogen|carbon|neon/i.test(s)) return 'gemini';
    if (/claude|sonnet|opus|haiku|anthropic|gpt|openai/i.test(s) || /(?:^|[^a-z0-9])o[134](?:$|[^a-z0-9])/i.test(s) || /^3p(?:$|[-_])/i.test(s)) return '3p';
    if (/orchestrator/i.test(s)) return 'gemini';
    return null;
  }
  return { geminiSeedAliases, formatModelBase, parseModelBase, buildShortAliases, parseModelTier, modelPrice, tokenCost, quotaFamily };
}
  const pricing = injectedPricing || (typeof window !== 'undefined' && window.__agPulsePricingFactory?.()) || createFallbackPricing();
  const dialog=document.createElement('dialog');dialog.id='usage-dashboard';dialog.setAttribute('popover','manual');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',language.language==='zh-TW'?'用量統計':language.language==='zh-CN'?'用量统计':'Token usage');
  dialog.style.cssText='width:min(1040px,calc(100vw - 40px));max-width:none;height:min(840px,calc(100dvh - 40px));max-height:none;box-sizing:border-box;overflow:hidden;visibility:visible;pointer-events:auto;padding:0;border:1px solid var(--pulse-border);border-radius:14px;background:var(--pulse-background);color:var(--pulse-foreground);box-shadow:0 16px 60px var(--pulse-shadow);';
  const shell=document.createElement('div'),view=shell.attachShadow({mode:'open'});shell.style.height='100%';dialog.append(shell);root.append(dialog);
  const backdrop=document.createElement('style');backdrop.textContent='#usage-dashboard{position:fixed;inset:0;margin:auto}#usage-dashboard::backdrop{background:rgba(0,0,0,.48);pointer-events:auto}';root.append(backdrop);
  const css=document.createElement('style');css.textContent=`
    :host{display:block;height:100%;color:var(--pulse-foreground);font:13px/1.5 var(--pulse-font,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif);font-variant-numeric:tabular-nums}
    *{box-sizing:border-box}button,select{font:inherit;color:inherit}button{cursor:pointer}button,select{border:1px solid var(--pulse-border);background:transparent;border-radius:7px}button{transition:background 140ms ease,transform 120ms cubic-bezier(.23,1,.32,1)}button:active{transform:scale(.97)}button:focus-visible,select:focus-visible{outline:2px solid var(--pulse-accent);outline-offset:3px}button[disabled]{opacity:.35;cursor:default}
    .page{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--pulse-background)}
    .page-head{flex:none;padding:16px 24px 0;background:var(--pulse-background);z-index:3}
    .page-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;margin-right:4px;padding:0 14px 14px 24px;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;overflow-anchor:none}.page-body>*{flex:none}
    .page-body::-webkit-scrollbar,.heat-wrap::-webkit-scrollbar,.chart-wrap::-webkit-scrollbar,.table-wrap::-webkit-scrollbar,.legend::-webkit-scrollbar,.year-menu::-webkit-scrollbar,.day-pills::-webkit-scrollbar{width:6px;height:6px}
    .page-body::-webkit-scrollbar-button,.heat-wrap::-webkit-scrollbar-button,.chart-wrap::-webkit-scrollbar-button,.table-wrap::-webkit-scrollbar-button,.legend::-webkit-scrollbar-button,.year-menu::-webkit-scrollbar-button,.day-pills::-webkit-scrollbar-button{display:none;width:0;height:0}
    .page-body::-webkit-scrollbar-track,.heat-wrap::-webkit-scrollbar-track,.chart-wrap::-webkit-scrollbar-track,.table-wrap::-webkit-scrollbar-track,.legend::-webkit-scrollbar-track,.year-menu::-webkit-scrollbar-track,.day-pills::-webkit-scrollbar-track{background:transparent;margin:6px 0}
    .page-body::-webkit-scrollbar-thumb,.heat-wrap::-webkit-scrollbar-thumb,.chart-wrap::-webkit-scrollbar-thumb,.table-wrap::-webkit-scrollbar-thumb,.legend::-webkit-scrollbar-thumb,.year-menu::-webkit-scrollbar-thumb,.day-pills::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--pulse-muted) 28%,transparent);border-radius:999px}
    .page-body::-webkit-scrollbar-thumb:hover,.heat-wrap::-webkit-scrollbar-thumb:hover,.chart-wrap::-webkit-scrollbar-thumb:hover,.table-wrap::-webkit-scrollbar-thumb:hover,.legend::-webkit-scrollbar-thumb:hover,.year-menu::-webkit-scrollbar-thumb:hover,.day-pills::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--pulse-muted) 48%,transparent)}
    .top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}h1{font-size:19px;letter-spacing:-.4px;line-height:1.25;margin:0 0 3px;font-weight:600}.sub{font-size:12px;color:var(--pulse-muted)}.actions{display:flex;gap:8px;align-items:center}.actions button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;line-height:1;border-radius:8px;color:var(--pulse-muted)}.actions button:hover{background:var(--pulse-hover);color:var(--pulse-foreground)}.actions svg{display:block;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.locale-label{display:block;min-width:16px;height:16px;line-height:16px;text-align:center;font-size:11px}.live-dot{display:inline-block;width:5px;height:5px;background:var(--pulse-success);border-radius:50%;margin-right:6px}
    .tabs-bar{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;border-bottom:1px solid var(--pulse-separator);margin:10px 0 0}.tabs{display:flex;gap:22px;border-bottom:0;margin:0}.tabs button{border:0;border-radius:0;background:transparent;color:var(--pulse-muted);padding:0 2px 10px;position:relative;font-size:13px}.tabs button[aria-selected=true]{color:var(--pulse-foreground);font-weight:600}.tabs button[aria-selected=true]:after{content:'';position:absolute;height:2px;background:var(--pulse-accent);bottom:-1px;left:0;right:0}
    .totals{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-bottom:1px solid var(--pulse-separator);padding:10px 0;margin-bottom:12px}.metric{padding:0 14px;min-width:0}.metric:first-child{padding-left:0}.metric:last-child{padding-right:0}.metric+.metric{border-left:1px solid var(--pulse-separator)}.metric label{display:block;color:var(--pulse-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.value{font-size:19px;letter-spacing:-.55px;line-height:1.2;margin:2px 0 0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.unit{font-size:11px;color:var(--pulse-muted);margin-left:5px;font-weight:400;letter-spacing:0}.approx{font-weight:450;opacity:.68;margin-right:1px}.metric-sub{font-size:10px;line-height:1.25;color:var(--pulse-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    section[hidden]{display:none}.section-head{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:0 0 8px}h2{font-size:14px;font-weight:600;letter-spacing:-.2px;margin:0}.detail-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}.muted{font-size:11px;color:var(--pulse-muted)}.seg{display:flex;padding:3px;background:var(--pulse-hover);border-radius:8px;gap:2px}.seg button{border:0;padding:4px 12px;border-radius:5px;font-size:11px;color:var(--pulse-muted)}.seg button[aria-pressed=true]{background:var(--pulse-control);color:var(--pulse-foreground);box-shadow:0 1px 3px #0001}select{padding:4px 8px;font-size:11px;background:var(--pulse-background)}
    .scope-seg{position:relative;display:inline-grid;grid-template-columns:1fr 1fr;padding:3px;border:1px solid var(--pulse-border);background:var(--pulse-hover);border-radius:9px;gap:0;margin-bottom:6px;flex:none;isolation:isolate}#scope-controls[hidden]{display:none}.scope-thumb{position:absolute;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:6px;background:var(--pulse-card);border:1px solid color-mix(in srgb,var(--pulse-accent) 35%,var(--pulse-border));box-shadow:0 1px 3px var(--pulse-shadow);transition:transform 190ms cubic-bezier(.23,1,.32,1);pointer-events:none;z-index:0}.scope-seg[data-active-scope=account] .scope-thumb{transform:translateX(100%)}.scope-seg button{position:relative;z-index:1;background:transparent!important;box-shadow:none!important;padding:4px 12px;font-weight:500;transition:color 150ms ease}.scope-seg button[aria-pressed=true]{color:var(--pulse-foreground);font-weight:600}.page[data-scope-loading=true] .totals,.page[data-scope-loading=true] #overview,.page[data-scope-loading=true] #details{opacity:.62;transition:opacity 120ms ease}
    .heat-wrap{overflow-x:auto;padding:3px 3px 7px}#heat-view[hidden],#hourly-view[hidden]{display:none}.calendar{min-width:680px}.months{display:grid;margin-left:35px;font-size:11px;color:var(--pulse-muted);margin-bottom:7px}.months span{white-space:nowrap}.heat-row{display:flex;gap:9px}.weekdays{display:grid;grid-template-rows:repeat(7,1fr);width:26px;flex:none;font-size:11px;color:var(--pulse-muted)}.heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,1fr);gap:3px;width:100%}.heat button{border:0;border-radius:3px;padding:0;min-width:0;aspect-ratio:1;background:var(--pulse-hover);outline-offset:1px}.heat button[data-level="1"],.swatch[data-level="1"]{background:color-mix(in srgb,var(--pulse-accent) 22%,var(--pulse-hover))}.heat button[data-level="2"],.swatch[data-level="2"]{background:color-mix(in srgb,var(--pulse-accent) 45%,var(--pulse-hover))}.heat button[data-level="3"],.swatch[data-level="3"]{background:color-mix(in srgb,var(--pulse-accent) 68%,var(--pulse-hover))}.heat button[data-level="4"],.swatch[data-level="4"]{background:var(--pulse-accent)}.heat button.future{opacity:.25;cursor:default}.heat.week{grid-template-columns:repeat(26,minmax(0,1fr))!important;grid-template-rows:repeat(2,1fr);grid-auto-flow:row}.week button{max-height:28px;aspect-ratio:1}.heat-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:8px 0 14px;font-size:11px;color:var(--pulse-muted)}.scale{display:flex;align-items:center;gap:4px}.swatch{width:11px;height:11px;border-radius:3px;background:var(--pulse-hover)}
    .day-pills{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px;margin-bottom:8px}.day-pill{border:1px solid var(--pulse-border);background:var(--pulse-hover);color:var(--pulse-muted);padding:3px 9px;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap}.day-pill:hover{color:var(--pulse-foreground);background:var(--pulse-control)}.day-pill[aria-pressed=true]{background:var(--pulse-accent);color:#fff;border-color:var(--pulse-accent);font-weight:550}
    .selected{padding:12px 0 0;border-top:1px solid var(--pulse-separator);display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.selected-main{flex:1;min-width:0}.selected-header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.selected button{border:0;color:var(--pulse-accent);font-size:12px;font-weight:550;padding:5px 8px;flex:none}.selected button:hover{background:var(--pulse-hover)}.selected .title{font-weight:550;margin-bottom:2px}.selected strong{font-weight:550}
    .composition-bar-wrap{margin-top:8px;width:100%}.composition-bar-wrap[hidden]{display:none}.composition-bar{height:5px;width:100%;background:var(--pulse-track);border-radius:3px;overflow:hidden;display:flex}.comp-seg{height:100%}.comp-seg.uncached{background:var(--pulse-accent)}.comp-seg.cached{background:#2d8a68}.comp-seg.output{background:#cf7429}.comp-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;font-size:11px}.comp-item{display:flex;align-items:center;gap:5px}.comp-dot{width:7px;height:7px;border-radius:2px;display:inline-block}.comp-dot.uncached{background:var(--pulse-accent)}.comp-dot.cached{background:#2d8a68}.comp-dot.output{background:#cf7429}
    .dot,.comp-filter-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none;background:var(--model-color)}
    .chart-controls{display:flex;gap:10px;align-items:center;flex-wrap:nowrap;white-space:nowrap}.range{display:flex;align-items:center;gap:10px;flex-shrink:0;white-space:nowrap}.range button{height:26px;width:26px;border:0}.range strong{font-size:12px;font-weight:500;min-width:106px;text-align:center}
    .filter-strip{display:flex;flex-direction:column;gap:5px;margin:0 0 8px}.comp-filters{display:flex;flex-wrap:wrap;gap:4px 14px}.comp-filters button{display:flex;align-items:center;gap:6px;padding:1px 0;border:0;border-radius:3px;background:transparent;font-size:11px;line-height:1.3;color:var(--pulse-muted)}.comp-filters button:hover,.comp-filters button[aria-pressed=true]{color:var(--pulse-foreground)}.comp-filters button[aria-pressed=false]{opacity:.38;text-decoration:line-through}
    .legend{display:flex;flex-wrap:wrap;gap:3px 12px;margin:0;max-height:44px;overflow-y:auto;padding-right:4px}.legend button{display:flex;align-items:center;gap:5px;padding:2px 0;border:0;border-radius:3px;background:transparent;font-size:11px;line-height:1.35;color:var(--pulse-muted)}.legend button:hover,.legend button[aria-pressed=true]{color:var(--pulse-foreground)}.legend button[aria-pressed=false]{opacity:.35;text-decoration:line-through}
    .legend-badge{font-size:10px;color:var(--pulse-muted);margin-left:3px;opacity:.82}.legend-dismiss{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;margin-left:2px;border-radius:50%;font-size:11px;line-height:1;color:var(--pulse-muted);opacity:0;transition:opacity 120ms ease,background 120ms ease}.legend button:hover .legend-dismiss{opacity:.72}.legend-dismiss:hover{opacity:1!important;background:var(--pulse-hover);color:var(--pulse-foreground)}
    .legend-trace-btn,.legend-restore-btn{font-size:10px;padding:1px 7px!important;border-radius:5px!important;border:1px dashed var(--pulse-border)!important;background:var(--pulse-hover)!important;color:var(--pulse-muted);align-self:center}.legend-trace-btn:hover,.legend-restore-btn:hover{color:var(--pulse-foreground);border-color:var(--pulse-accent)!important}
    .excluded-val{text-decoration:line-through;opacity:.38}
    .drilldown-banner{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;background:color-mix(in srgb,var(--pulse-accent) 8%,transparent);border:1px solid color-mix(in srgb,var(--pulse-accent) 25%,transparent);border-radius:7px;margin-bottom:8px;font-size:11px}.drilldown-banner button{border:0;color:var(--pulse-accent);background:transparent;padding:1px 6px;font-size:11px}.drilldown-banner button:hover{text-decoration:underline}.drilldown-banner[hidden]{display:none}
    .chart-wrap{overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--pulse-separator);padding:8px 0 8px;margin-bottom:8px}.chart{height:168px;display:flex;gap:16px;min-width:650px}#hourly-view .chart{height:208px}.axis{width:42px;flex:none;position:relative;font-size:11px;color:var(--pulse-muted)}.axis span{position:absolute;right:0;transform:translateY(50%)}.plot{position:relative;flex:1;display:flex;align-items:stretch;gap:5px;padding:0 1px}.grid-line{position:absolute;left:0;right:0;border-top:1px solid var(--pulse-separator);opacity:.45;pointer-events:none}.grid-line:first-child{opacity:.85}.bar-column{position:relative;flex:1;min-width:0;display:flex;align-items:flex-end;border:0;border-radius:4px;background:transparent;padding:0;margin-bottom:18px}.bar-column:hover{background:transparent}.bar-column:active{transform:none}.bar-column.focused-bar:after{content:'';position:absolute;bottom:-5px;left:15%;right:15%;height:2px;background:var(--pulse-accent);border-radius:2px}.stack{display:flex;flex-direction:column-reverse;width:62%;max-width:30px;margin-inline:auto;gap:0;pointer-events:none;border-radius:4px 4px 0 0;overflow:hidden}.bar-segment{display:block;flex:none;width:100%;min-height:0;border-radius:0;pointer-events:auto;background:var(--model-color);transition:opacity 140ms ease}.plot[data-highlight] .bar-segment:not([data-highlight=true]){opacity:.24}.x-label{position:absolute;top:calc(100% + 5px);left:50%;transform:translateX(-50%);font-size:11px;color:var(--pulse-muted);white-space:nowrap}.empty-bar{height:1px;width:100%;background:var(--pulse-track);border-radius:2px;opacity:.35}.chart-empty{position:absolute;left:0;right:0;top:40%;text-align:center;color:var(--pulse-muted);font-size:12px;pointer-events:none}.chart-summary{font-size:11px;color:var(--pulse-muted);margin:0}.chart-summary strong{color:var(--pulse-foreground);font-weight:550}
    .table-wrap{overflow:visible}.table{width:100%;border-collapse:collapse;text-align:right;font-size:11px;white-space:nowrap}.table th{font-weight:500;color:var(--pulse-muted);padding:6px 10px;border-bottom:0;position:sticky;top:0;z-index:2;background:var(--pulse-background);box-shadow:inset 0 -1px 0 var(--pulse-separator)}.table th.sortable{cursor:pointer;user-select:none}.table th.sortable:hover{color:var(--pulse-foreground)}.sort-arrow{display:inline-block;margin-left:3px;font-size:9px;opacity:.75}.table td{padding:7px 10px;border-bottom:1px solid var(--pulse-separator)}.table td:nth-child(2),.table td.col-cost{font-weight:550}.table tbody tr:hover td{background:color-mix(in srgb,var(--pulse-hover) 55%,transparent)}.table th:first-child,.table td:first-child{text-align:left;padding-left:0}.table th:last-child,.table td:last-child{padding-right:0}.table td:first-child span{margin-right:7px}.table tr:last-child td{border-bottom:0}
    .footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:auto;padding-top:14px;font-size:11px;color:var(--pulse-muted)}.alert{color:var(--pulse-warning);margin-top:12px;font-size:11px}.tip{position:fixed;z-index:20;max-width:320px;padding:12px 14px;border:1px solid var(--pulse-border);border-radius:9px;background:var(--pulse-menu);box-shadow:0 8px 30px var(--pulse-shadow);color:var(--pulse-foreground);font-size:11px;pointer-events:none}.tip[hidden]{display:none}.tip .tip-title{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--pulse-muted);margin-bottom:5px}.tip strong{font-size:16px;font-weight:550}.tip-model{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:5px;padding:3px 0}.tip-model.dimmed{opacity:.5}.tip-model.active{font-weight:600}.tip-model .dot{margin-right:6px}.tier-cost{color:var(--pulse-foreground);font-weight:550;margin-left:7px}.model-share{font-size:11px;color:var(--pulse-muted);margin-left:8px}.tip-rule{height:1px;background:var(--pulse-separator);margin:6px 0 2px}.tip-foot{font-size:10px;color:var(--pulse-muted);line-height:1.45;margin-top:4px}.usage-waiting{display:grid;place-items:center;min-height:260px;color:var(--pulse-muted);font-size:12px}.usage-waiting[hidden]{display:none}
    .year-picker{position:relative;flex:none}.year-picker[hidden]{display:none}.year-trigger{display:flex;align-items:center;justify-content:space-between;gap:14px;min-width:76px;height:30px;padding:0 10px;background:var(--pulse-control);color:var(--pulse-foreground);font-size:11px;border-radius:8px}.year-trigger:hover,.year-trigger[aria-expanded=true]{background:var(--pulse-hover)}.year-chevron{width:12px;height:12px;fill:none;stroke:var(--pulse-muted);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;transition:transform 160ms cubic-bezier(.23,1,.32,1)}.year-trigger[aria-expanded=true] .year-chevron{transform:rotate(180deg)}
    .year-menu{position:fixed;inset:auto;margin:0;padding:5px;width:112px;max-height:232px;overflow-y:auto;border:1px solid var(--pulse-border);border-radius:10px;background:var(--pulse-menu);color:var(--pulse-foreground);box-shadow:0 8px 26px var(--pulse-shadow);transform-origin:top right;opacity:1;transform:scale(1);transition:opacity 140ms ease,transform 160ms cubic-bezier(.23,1,.32,1)}.year-menu::backdrop{background:transparent;pointer-events:none}.year-option{width:100%;border:0;border-radius:6px;padding:7px 9px;display:flex;align-items:center;justify-content:space-between;gap:18px;font-size:12px;text-align:left;background:transparent;color:var(--pulse-foreground);font-variant-numeric:tabular-nums}.year-option:hover,.year-option:focus-visible{background:var(--pulse-hover)}.year-option[aria-selected=true]{background:color-mix(in srgb,var(--pulse-accent) 12%,var(--pulse-menu))}.year-check{color:var(--pulse-accent);width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;opacity:0}.year-option[aria-selected=true] .year-check{opacity:1}
    .usage-intro{margin:12px 0 0;padding:12px 14px;border:1px solid var(--pulse-separator);border-radius:10px;background:color-mix(in srgb,var(--pulse-hover) 45%,transparent)}.usage-intro[hidden]{display:none}
    .intro-heading{display:flex;align-items:center;gap:8px;margin-bottom:6px}.intro-heading h2{font-size:13px;font-weight:600;margin:0}.intro-mark{display:flex;color:var(--pulse-accent)}.intro-mark svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
    .intro-copy{display:grid;gap:3px;color:var(--pulse-muted);font-size:12px;line-height:1.55}.intro-copy p{margin:0;font-size:12px}.intro-bottom{display:flex;justify-content:flex-end;align-items:center;gap:14px;margin-top:10px}.intro-bottom span{margin-right:auto;color:var(--pulse-warning);font-size:11px}
    #usage-intro-done{padding:5px 12px;min-height:28px;border:1px solid var(--pulse-border);border-radius:6px;background:var(--pulse-control);color:var(--pulse-foreground);font:inherit;font-size:11px;font-weight:550;cursor:pointer;transition:background-color 140ms ease,transform 120ms ease}#usage-intro-done:hover{background:var(--pulse-hover)}#usage-intro-done:active{transform:scale(.98)}#usage-intro-done:disabled{opacity:.55;cursor:wait}
    @starting-style{.year-menu:popover-open{opacity:0;transform:scale(.97)}}
    @media(max-width:860px){.totals{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:12px}.metric:nth-child(3n+1){padding-left:0;border-left:0}.metric:nth-child(3n){padding-right:0}}
    @media(max-width:760px){.table-wrap{overflow-x:auto}}
    @media(max-width:650px){.page-head{padding:14px 16px 0}.page-body{margin-right:2px;padding:0 8px 14px 16px}.tabs-bar{flex-wrap:wrap;gap:8px}.totals{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 0}.metric{padding:0 12px}.metric:nth-child(odd){padding-left:0;border-left:0}.metric:nth-child(even){padding-left:12px;padding-right:0;border-left:1px solid var(--pulse-separator)}.value{font-size:18px}.section-head{align-items:flex-start;flex-wrap:wrap}.chart-controls{width:100%;justify-content:space-between}.table-wrap{overflow-x:auto}.footer{align-items:flex-start;flex-direction:column;gap:5px}.selected{align-items:flex-start}.chart{gap:8px}}
    @media(max-width:520px){.intro-bottom{align-items:flex-start}.intro-bottom span{line-height:1.5}}
    @media(prefers-reduced-motion:reduce){button,.year-menu,.year-chevron,.scope-thumb,.totals,#overview,#details{transition:none}button:active{transform:none}}
  `;view.append(css);
  const page=document.createElement('div');page.className='page';
  setMarkup(page,`<div class="page-head"><header class="top"><div><h1 id="title"></h1><div class="sub"><span class="live-dot"></span><span id="subtitle"></span></div></div><div class="actions"><button id="locale" type="button" aria-label="Language"><span id="locale-label" class="locale-label">中</span></button><button id="refresh" type="button" aria-label="Refresh"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 7a5 5 0 1 0-1.3 4.4M13 3v4H9"/></svg></button><button id="close" type="button" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button></div></header><div class="tabs-bar"><nav class="tabs" role="tablist"><button id="overview-tab" role="tab" aria-controls="overview"></button><button id="details-tab" role="tab" aria-controls="details"></button></nav><div class="seg scope-seg" id="scope-controls" role="group" hidden><i class="scope-thumb" aria-hidden="true"></i><button type="button" data-usage-scope="local"></button><button type="button" data-usage-scope="account"></button></div></div></div><div class="page-body" id="page-body"><div class="totals" id="totals"></div><section id="usage-waiting" class="usage-waiting" role="status" hidden></section><section id="overview" role="tabpanel"><div class="section-head"><div><h2 id="activity-title"></h2><div class="muted" id="heat-sub"></div></div><div class="chart-controls"><div class="seg" id="heat-controls"><button data-heat="day"></button><button data-heat="week"></button><button data-heat="hour"></button></div><div class="year-picker" id="year-wrap"><button id="year" type="button" class="year-trigger" aria-label="Year" aria-haspopup="listbox" aria-controls="year-menu" aria-expanded="false"><span id="year-label"></span><svg class="year-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div id="year-menu" class="year-menu" role="listbox" aria-label="Year" popover="manual"></div></div></div></div><div id="heat-view"><div class="heat-wrap"><div class="calendar"><div class="months" id="months"></div><div class="heat-row"><div class="weekdays" id="weekdays"></div><div class="heat" id="heat"></div></div></div></div><div class="heat-footer"><span id="heat-summary"></span><div class="scale"><span id="less"></span><i class="swatch"></i><i class="swatch" data-level="1"></i><i class="swatch" data-level="2"></i><i class="swatch" data-level="3"></i><i class="swatch" data-level="4"></i><span id="more"></span></div></div></div><div id="hourly-view" hidden><div class="day-pills" id="day-pills"></div><div class="chart-wrap"><div class="chart"><div class="axis" id="hourly-axis"></div><div class="plot" id="hourly-plot"></div></div></div></div><div class="selected"><div class="selected-main"><div class="selected-header"><div class="title" id="selection-title"></div><span class="muted" id="selection-value"></span></div><div class="composition-bar-wrap" id="selection-comp-wrap" hidden><div class="composition-bar" id="selection-comp-bar"></div><div class="comp-legend" id="selection-comp-legend"></div></div></div><button id="selection-details"></button></div></section><section id="details" role="tabpanel" hidden><div class="section-head"><h2 id="detail-title"></h2><div class="chart-controls"><div class="range"><button id="previous" aria-label="Previous">‹</button><strong id="range-label"></strong><button id="next" aria-label="Next">›</button></div><div class="seg" id="period-controls"><button data-period="day"></button><button data-period="week"></button><button data-period="month"></button></div></div></div><div class="filter-strip"><div class="comp-filters" id="comp-filters"></div><div class="legend" id="legend"></div></div><div class="chart-wrap"><div class="chart"><div class="axis" id="axis"></div><div class="plot" id="plot"></div></div></div><div class="drilldown-banner" id="drilldown-banner" hidden><span id="drilldown-banner-text"></span><button type="button" id="clear-drilldown"></button></div><div class="table-wrap"><table class="table"><thead><tr id="table-head"></tr></thead><tbody id="table-body"></tbody></table></div></section><div class="alert" id="alert" hidden></div><footer class="footer"><span id="coverage"></span><span id="timezone"></span></footer></div><div class="tip" id="tip" role="status" hidden></div>`);view.append(page);
  const intro=document.createElement('section');intro.id='usage-intro';intro.className='usage-intro';intro.hidden=true;intro.setAttribute('aria-labelledby','usage-intro-title');
  setMarkup(intro,'<div class="intro-heading"><span class="intro-mark" aria-hidden="true"><svg viewBox="0 0 16 16"><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 2 10 2 10 0V4M3 8c0 2 10 2 10 0"/></svg></span><h2 id="usage-intro-title"></h2></div><div class="intro-copy"><p id="usage-intro-history"></p><p id="usage-intro-scope"></p><p id="usage-intro-storage"></p></div><div class="intro-bottom"><span id="usage-intro-error" role="status"></span><button id="usage-intro-done" type="button"></button></div>');
  page.querySelector('#totals').before(intro);
  const $=id=>view.getElementById(id),text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  const normalizeHostModelRaw=raw=>{
    const s=String(raw||'').trim();
    const gm=s.match(/^gemini[\s-]+pro[\s-]+(?:orchestrator|coordinator)(?:[\s-]+(.+))?$/i);
    if(gm)return `Orchestrator (${(gm[1]||'Carbon').trim()})`;
    return s.replace(/\s+extra$/i,' (XHigh)');
  };
  let modelAliases=pricing.buildShortAliases([]);
  const parseModelTier=raw=>pricing.parseModelTier(normalizeHostModelRaw(raw),modelAliases);
  const modelPrice=pricing.modelPrice;
  const tokenCost=pricing.tokenCost;
  const quotaFamily=pricing.quotaFamily;
  let value=null,tab='overview',heatMode='day',period='day',year=null,anchor=null,selected=null,selectedDay=null,focusedBucket=null,disabledModels=new Set(),disabledComponents=new Set(),sortKey='total',sortOrder='desc',lastKey='',busy=false,opener=null;
  let showDormantTrace=false,userDismissedModels=new Set();
  try{const saved=localStorage.getItem('ag_pulse_dismissed_models');if(saved)userDismissedModels=new Set(JSON.parse(saved).map(m=>parseModelTier(m).key));}catch{}
  const saveDismissed=()=>{try{localStorage.setItem('ag_pulse_dismissed_models',JSON.stringify([...userDismissedModels]));}catch{}};
  let disposed=false,refreshMotion=null,refreshDelay=null,finishRefresh=null,accountKey=null,tipTarget=null,tipModel=null,lastScrollTop=0,activeHover=null,restoringDom=false,suppressScrollTipHide=false;
  const scopeCache=new Map();let pendingScope=null,scopeLoading=false,scopeAnimations=[];
  function animateScopeChange(){
    for(const anim of scopeAnimations)anim.cancel();scopeAnimations=[];
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    for(const el of [$('subtitle'),$('totals'),$(tab==='overview'?'overview':'details'),$('usage-waiting')]){
      if(!el||el.hidden)continue;
      scopeAnimations.push(el.animate([{opacity:.45,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(0.23,1,0.32,1)'}));
    }
  }
  const zh=()=>language.language==='zh-CN'||language.language==='zh-TW',tw=()=>language.language==='zh-TW',w=(cn,en,twText)=>(tw()&&twText!==undefined)?twText:(zh()?cn:en);
  let guideSaving=false,guideError=false,guideSignature=null;
  const replayGuide=window.__agPulseUsageGuidePreview===true;
  function renderGuide(){
    const signature=language.language+'|'+themeSignature();
    if(replayGuide&&signature!==guideSignature){guideDismissed=false;guideError=false;}
    guideSignature=signature;intro.hidden=guideDismissed;
    text('usage-intro-title',w('先了解你的用量统计','About your token usage','先了解您的用量統計'));
    text('usage-intro-history',w('自动汇总本机 Antigravity 可读取的本地历史对话，再持续记录新请求（默认统计本机全部流经流量，也可切换查看当前账号）；已删除或缺失的历史可能无法补齐。','Available local conversations are imported automatically and new requests are recorded continuously (defaulting to all local Antigravity traffic, with an option to filter by the current account). Deleted or missing history may leave gaps.','自動彙總本機 Antigravity 可讀取的本機歷史對話，並持續記錄新請求（預設統計本機全部流經流量，亦可切換檢視目前帳號）；已刪除或缺失的記錄可能無法補齊。'));
    text('usage-intro-scope',w('统计仅代表本机已记录的 Token 用量，不是账户账单；天、周、月均按 UTC+8 划分。','Totals cover usage recorded on this device, not account billing. Days, weeks and months use UTC+8.','統計僅代表本機已記錄的 Token 用量，非帳號帳單；日、週、月均按 UTC+8 劃分。'));
    text('usage-intro-storage',w('只在本地保存时间、模型和用量，不保存对话正文。删除对话不会扣除已记录的用量。','Only times, models and usage counters are saved locally, never conversation text. Deleting a chat does not subtract usage already recorded.','僅於本機儲存時間、模型與用量，不儲存對話內文。刪除對話不會扣減已記錄的用量。'));
    text('usage-intro-done',guideSaving?w('保存中…','Saving…','儲存中…'):w('知道了','Got it','我知道了'));
    text('usage-intro-error',guideError?w('未能保存，请再试一次。','Could not save. Please try again.','未能儲存，請再試一次。'):'' );
    $('usage-intro-done').disabled=guideSaving;$('usage-intro-done').setAttribute('aria-busy',String(guideSaving));
  }
  function dismissGuide(){
    if(disposed)return;const focused=view.activeElement===$('usage-intro-done');guideDismissed=true;renderGuide();
    if(focused&&dialog.open)$('overview-tab').focus({preventScroll:true});
  }
  $('usage-intro-done').addEventListener('click',async()=>{
    if(guideSaving||disposed)return;guideSaving=true;guideError=false;renderGuide();
    try{await onDismissGuide();dismissGuide();}catch{if(!disposed)guideError=true;}
    finally{guideSaving=false;if(!disposed)renderGuide();}
  });
  const full=n=>Number(n||0).toLocaleString(language.language==='en'?'en-US':language.language);
  const compact=n=>{n=Number(n||0);for(const [base,suffix,nextBase,nextSuffix]of [[1e12,'T',0,''],[1e9,'B',1e12,'T'],[1e6,'M',1e9,'B'],[1e3,'K',1e6,'M']])if(n>=base){const scaled=n/base,rounded=Number(scaled.toFixed(1));return nextBase&&rounded*base>=nextBase?`1${nextSuffix}`:`${rounded}${suffix}`;}return full(n);};
  const scaleUnits=['K','M','B','T'];
  const sig3=n=>{let i=Math.min(scaleUnits.length-1,Math.max(0,Math.floor(Math.log10(n)/3)-1));for(;;){const s=(n/10**(3*(i+1))).toPrecision(3);if(Number(s)>=1000&&i<scaleUnits.length-1){i++;continue;}if(Number(s)<1&&i>0){i--;continue;}return (s.includes('e')?Number(s).toFixed(0):s)+scaleUnits[i];}};
  const shortNum=n=>{n=Number(n||0);if(!Number.isFinite(n))return '—';const sign=n<0?'-':'';n=Math.abs(n);return sign+(Math.round(n)<1e3?full(Math.round(n)):sig3(n));};
  const usd=v=>{if(v===null||v===undefined||!Number.isFinite(v))return '—';if(v===0)return '$0.00';if(v<0.01)return '$'+v.toFixed(3);return '$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};
  const compactUsd=v=>{if(v===null||v===undefined||!Number.isFinite(v))return '—';if(v===0)return '$0.00';if(v<0.01)return '$'+v.toFixed(3);if(v<1000)return '$'+v.toFixed(2);if(v<10000)return '$'+Math.round(v).toLocaleString('en-US');return '$'+(v/1000).toFixed(1)+'K';};
  const familyLabel=f=>f==='gemini-argon'?'Argon':f==='3p'?'Claude / GPT':'Gemini';
  const add=(date,days)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const week=date=>{const d=new Date(date+'T00:00:00Z');return add(date,-((d.getUTCDay()+6)%7));};
  const month=(date,shift)=>{const d=new Date(date.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+shift);return d.toISOString().slice(0,10);};
  let modelFull=new Map(),mergedModelList=[];
  function syncModels(){
    modelFull.clear();
    const allRaw=[];
    for(const raw of value?.models||[])allRaw.push(raw);
    for(const day of value?.days||[]){
      for(const raw of Object.keys(day.models||{}))allRaw.push(raw);
      for(const hd of Object.values(day.hours||{}))for(const raw of Object.keys(hd?.models||{}))allRaw.push(raw);
    }
    modelAliases=pricing.buildShortAliases(allRaw.map(normalizeHostModelRaw));
    const seen=new Map();
    for(const raw of allRaw){
      const p=parseModelTier(raw);
      const prev=seen.get(p.key);
      if(!prev||(!prev.hasDisplay&&p.hasDisplay))seen.set(p.key,p);
      if(!modelFull.has(p.key)||(!prev?.hasDisplay&&p.hasDisplay))modelFull.set(p.key,p.fullName);
    }
    mergedModelList=[...seen.keys()];
    if(userDismissedModels.size){
      const nextDismissed=new Set();
      for(const m of userDismissedModels)nextDismissed.add(parseModelTier(m).key);
      userDismissedModels=nextDismissed;
    }
  }
  const fullModelName=key=>modelFull.get(key)||parseModelTier(key).fullName;
  const modelName=key=>fullModelName(key);
  const defaultPricing={'google/gemini-4-carbon':{prompt:0.000002,completion:0.000012,cacheRead:0.0000002,cacheWrite:0.00000025},'google/gemini-4-neon':{prompt:0.00000125,completion:0.000005,cacheRead:0.000000125,cacheWrite:0.0000001875},'google/gemini-4-hydrogen':{prompt:0.00000075,completion:0.000003,cacheRead:0.000000075,cacheWrite:0.0000001},'google/gemini-4-argon':{prompt:0.000002,completion:0.00001,cacheRead:0.0000001,cacheWrite:0.0000001875},'google/gemini-3.8-flash':{prompt:0.00000075,completion:0.00000375,cacheRead:0.000000075,cacheWrite:0.0000000416666666666667},'google/gemini-3.8-pro':{prompt:0.00000125,completion:0.000005,cacheRead:0.0000003125,cacheWrite:0.00000125},'anthropic/claude-opus-5.5':{prompt:0.000004,completion:0.00002,cacheRead:0.0000002,cacheWrite:0.000005},'anthropic/claude-opus-4.6':{prompt:0.000005,completion:0.000025,cacheRead:0.0000005,cacheWrite:0.00000625},'anthropic/claude-sonnet-5.5':{prompt:0.000002,completion:0.00001,cacheRead:0.0000001,cacheWrite:0.0000025},'anthropic/claude-sonnet-4.6':{prompt:0.000003,completion:0.000015,cacheRead:0.0000003,cacheWrite:0.00000375},'anthropic/claude-haiku-5.5':{prompt:0.0000001,completion:0.0000005,cacheRead:0.00000001,cacheWrite:0.000000125},'openai/gpt-5.4-mini':{prompt:0.00000075,completion:0.0000045,cacheRead:0.000000075,cacheWrite:0.00000075},'openai/gpt-5.4':{prompt:0.0000025,completion:0.00001,cacheRead:0.000000625,cacheWrite:0},'openai/gpt-oss-120b':{prompt:0.00000015,completion:0.0000006,cacheRead:0.000000075,cacheWrite:0.00000015},'openai/o3-pro':{prompt:0.00002,completion:0.00008,cacheRead:0.000005,cacheWrite:0.00002},'openai/gpt-4o':{prompt:0.0000025,completion:0.00001,cacheRead:0.00000125,cacheWrite:0}};
  const normalizeKey=str=>typeof str==='string'?str.toLowerCase().trim().replace(/^https?:\/\/[^\/]+\//,'').replace(/^[~@]/,'').replace(/^(?:google|anthropic|openai)\//,'').replace(/\((?:(?:extra[\s-]+high|xhigh|high|medium|med|low|minimal|max)[\s-]+thinking|extra[\s-]+high|xhigh|high|medium|med|low|minimal|max|neon|thinking|tiered|orchestrator)\)/gi,'').trim().replace(/^orchestrator[\s-]+/,'').replace(/-(?:n|thinking|orchestrator|xhigh|high|medium|med|low|minimal|max|tiered|preview|latest)$/,'').replace(/:batch$/,'').replace(/\s+/g,'-'):'';
  function findPricing(model,refDate=''){
    const catalog=value?.pricing?.models||defaultPricing,raw=String(model||'').trim().toLowerCase();
    if(catalog[raw])return catalog[raw];
    for(const prefix of ['google/','anthropic/','openai/']){if(catalog[prefix+raw])return catalog[prefix+raw];}
    const canonKey=parseModelTier(model).key;
    const norm=normalizeKey(raw),canonNorm=normalizeKey(canonKey);
    if(!norm&&!canonNorm)return null;
    for(const target of [norm,canonNorm]){
      if(!target)continue;
      for(const [key,p]of Object.entries(catalog)){if(normalizeKey(key)===target)return p;}
      const dotNorm=target.replace(/-(\d+)-(\d+)/g,'-$1.$2'),dashNorm=target.replace(/\./g,'-');
      for(const [key,p]of Object.entries(catalog)){const kNorm=normalizeKey(key);if(kNorm===dotNorm||kNorm===dashNorm)return p;}
    }
    for(const target of [norm,canonNorm]){
      if(!target)continue;
      for(const [key,p]of Object.entries(catalog)){const kNorm=normalizeKey(key);if(kNorm.startsWith(target)||target.startsWith(kNorm))return p;}
    }
    const probe=canonNorm||norm;
    if(probe.includes('carbon')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('carbon'));if(c)return c[1];}
    if(probe.includes('hydrogen')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('hydrogen'));if(c)return c[1];}
    if(probe.includes('argon')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('argon'));if(c)return c[1];}
    if(probe.includes('neon')||probe.includes('orchestrator')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('neon'));if(c)return c[1];}
    if(probe.startsWith('gemini-4')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).startsWith('gemini-4'));if(c)return c[1];}
    if(probe.includes('opus')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('opus'));if(c)return c[1];}
    if(probe.includes('sonnet')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('sonnet'));if(c)return c[1];}
    if(probe.includes('haiku')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('haiku'));if(c)return c[1];}
    if(probe.includes('flash')){const c=Object.entries(catalog).find(([k])=>normalizeKey(k).includes('flash'));if(c)return c[1];}
    const mp=modelPrice(canonKey,refDate||value?.today||'');
    if(mp?.base)return {prompt:mp.base[0]/1e6,cacheRead:mp.base[1]/1e6,cacheWrite:mp.base[2]/1e6,completion:mp.base[3]/1e6};
    return null;
  }
  function modelActiveTokens(r){
    if(!r)return 0;
    let sum=0;
    if(!disabledComponents.has('uncached'))sum+=Number(r.uncached||0)+Number(r.cacheWrite||0);
    if(!disabledComponents.has('cacheRead'))sum+=Number(r.cacheRead||0);
    if(!disabledComponents.has('output'))sum+=Number(r.output||0);
    return sum;
  }
  function costOfSingle(model,r,respectFilters=true,refDate=''){
    const p=findPricing(model,refDate);if(!p||!r)return null;
    const filter=respectFilters&&tab==='details';
    const uncached=(!filter||!disabledComponents.has('uncached'))?Number(r.uncached||0):0;
    const read=(!filter||!disabledComponents.has('cacheRead'))?Number(r.cacheRead||0):0;
    const write=(!filter||!disabledComponents.has('uncached'))?Number(r.cacheWrite||0):0;
    const output=(!filter||!disabledComponents.has('output'))?Number(r.output||0):0;
    return (uncached*(p.prompt||0))+(read*(p.cacheRead||0))+(write*(p.cacheWrite||0))+(output*(p.completion||0));
  }
  function costOf(model,r,respectFilters=true,refDate=''){
    if(!r)return null;
    let usdVal=0,has=false;
    if(r.raws&&Object.keys(r.raws).length){
      for(const [rawModel,rb]of Object.entries(r.raws)){
        const u=costOfSingle(rawModel,rb,respectFilters,refDate);
        if(u!==null){usdVal+=u;has=true;}
      }
    }else{
      const u=costOfSingle(model,r,respectFilters,refDate);
      if(u!==null){usdVal=u;has=true;}
    }
    if(!has)return null;
    const rate=Number(value?.pricing?.exchangeRate)||7.15;
    const amount=zh()?usdVal*rate:usdVal,symbol=zh()?'¥':'$';
    return {usd:usdVal,amount,symbol};
  }
  function rangeCost(models,respectFilters=true,refDate=''){
    let usdVal=0,has=false;
    for(const [model,r]of Object.entries(models||{})){
      if(respectFilters&&tab==='details'&&(disabledModels.has(model)||userDismissedModels.has(model)))continue;
      const c=costOf(model,r,respectFilters,refDate);
      if(c){usdVal+=c.usd;has=true;}
    }
    const rate=Number(value?.pricing?.exchangeRate)||7.15;
    return has?{usd:usdVal,amount:zh()?usdVal*rate:usdVal,symbol:zh()?'¥':'$'}:null;
  }
  function formatCost(cost){
    if(!cost||Number.isNaN(cost.amount))return '—';
    const {amount,symbol}=cost;
    if(amount===0)return symbol+'0.00';
    if(amount>0&&amount<0.01)return '< '+symbol+'0.01';
    return symbol+amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function computeOverviewFinance(){
    const today=value?.today||'',weekFrom=today?week(today):'',monthFrom=today?month(today,0):'',recentFrom=today?add(today,-6):'';
    const qw=value?.quotaWindows&&typeof value.quotaWindows==='object'?value.quotaWindows:{};
    const weeklyEntries=Object.entries(qw).filter(([k])=>k.endsWith(':weekly'));
    const hasDedicatedArgon=weeklyEntries.some(([k])=>quotaFamily(k.slice(0,-7))==='gemini-argon');
    const normFam=raw=>{const f=quotaFamily(raw);return f==='gemini-argon'&&!hasDedicatedArgon?'gemini':f;};
    let allCost=0,allPriced=false,allUnpriced=false,todayCost=0,todayPriced=false,weekCost=0,weekPriced=false,monthCost=0,monthPriced=false;
    const recentPool={},allPool={};let recentAllCost=0,recentAllTok=0,totalAllTok=0;
    for(const day of value?.days||[]){
      const inToday=day.date===today,inWeek=weekFrom&&day.date>=weekFrom&&day.date<=today,inMonth=monthFrom&&day.date>=monthFrom&&day.date<=today,inRecent=recentFrom&&day.date>=recentFrom&&day.date<=today;
      for(const [rawModel,r]of Object.entries(day.models||{})){
        const {key:model}=parseModelTier(rawModel),p=modelPrice(model,day.date),c=tokenCost(r,p),tok=r.total||0;
        if(c===null){if(tok>0)allUnpriced=true;continue;}
        allCost+=c;allPriced=true;totalAllTok+=tok;
        if(inToday){todayCost+=c;todayPriced=true;}
        if(inWeek){weekCost+=c;weekPriced=true;}
        if(inMonth){monthCost+=c;monthPriced=true;}
        if(inRecent){recentAllCost+=c;recentAllTok+=tok;}
        const fam=normFam(model);
        if(fam&&tok>0){
          const ap=allPool[fam]||(allPool[fam]={cost:0,tok:0});ap.cost+=c;ap.tok+=tok;
          if(inRecent){const rp=recentPool[fam]||(recentPool[fam]={cost:0,tok:0});rp.cost+=c;rp.tok+=tok;}
        }
      }
    }
    const fallbackRate=recentAllTok>0?recentAllCost/recentAllTok:(totalAllTok>0?allCost/totalAllTok:null);
    const rateFor=fam=>{
      const rp=fam&&recentPool[fam];if(rp&&rp.tok>0)return rp.cost/rp.tok;
      const ap=fam&&allPool[fam];if(ap&&ap.tok>0)return ap.cost/ap.tok;
      return fallbackRate;
    };
    const pools=[];let weeklyTotal=0,waitingSamples=false;
    for(const [k,win]of weeklyEntries){
      const gid=k.slice(0,-7),fam=normFam(gid);
      const fullUsdDirect=Number.isFinite(win?.estimatedFullUsd)&&win.estimatedFullUsd>0?win.estimatedFullUsd:null;
      const fullTokDirect=Number.isFinite(win?.estimatedFullTokens)&&win.estimatedFullTokens>0?win.estimatedFullTokens:null;
      if(!fullUsdDirect&&!fullTokDirect){if(win?.observedTokens>0||win?.usedFraction>0)waitingSamples=true;continue;}
      const rate=rateFor(fam);
      const estUsd=fullUsdDirect??(rate!==null&&fullTokDirect?fullTokDirect*rate:null);
      if(estUsd===null)continue;
      const fullTok=fullUsdDirect!==null&&rate>0?Math.round(fullUsdDirect/rate):fullTokDirect;
      weeklyTotal+=estUsd;
      pools.push({label:familyLabel(fam),usd:estUsd,fullTokens:fullTok,usedFraction:typeof win.usedFraction==='number'?win.usedFraction:null,costBased:fullUsdDirect!==null});
    }
    const zeroAll=!allPriced&&Number(value?.totalTokens||0)===0;
    return {
      allCost:allPriced?allCost:(zeroAll?0:null),allUnpriced,
      todayCost:todayPriced?todayCost:null,weekCost:weekPriced?weekCost:null,monthCost:monthPriced?monthCost:null,
      weeklyEst:pools.length?{totalUsd:weeklyTotal,pools}:null,waitingSamples,
    };
  }
  function priceHint(p){
    if(!p)return w('暂无官网公开标价','No official list price available','暫無官網公開標價');
    const b=p.base,core=w(`输入 $${b[0]}/M · 缓存 $${b[1]}/M · 输出 $${b[3]}/M`,`In $${b[0]}/M · Cache $${b[1]}/M · Out $${b[3]}/M`,`輸入 $${b[0]}/M · 快取 $${b[1]}/M · 輸出 $${b[3]}/M`);
    if(p.longAt&&p.long){
      const k=Math.round(p.longAt/1000)+'K',l=p.long;
      return w(`官网 API 标价（≤${k}）：${core}；>${k} 档：$${l[0]}/$${l[1]}/$${l[3]}/M（思考计入输出）`,`Official API (≤${k}): ${core}; >${k}: $${l[0]}/$${l[1]}/$${l[3]}/M (thinking billed as output)`,`官網 API 標價（≤${k}）：${core}；>${k} 檔：$${l[0]}/$${l[1]}/$${l[3]}/M（思考計入輸出）`);
    }
    const tag=p.note==='flat1m'?w('1M 统一价，同档单价·思考计入输出','Flat 1M rate · thinking billed as output','1M 統一價，同檔單價·思考計入輸出'):p.note==='intro'?w('当前优惠价，同档单价·思考计入输出','Active intro rate · thinking billed as output','目前優惠價，同檔單價·思考計入輸出'):w('同档单价·思考计入输出','Uniform effort rate · thinking billed as output','同檔單價·思考計入輸出');
    return w(`官网 API 标价（${tag}）：${core}`,`Official API (${tag}): ${core}`,`官網 API 標價（${tag}）：${core}`);
  }
  const themeSignature=()=>{const s=getComputedStyle(root.host||dialog);return [s.getPropertyValue('--pulse-accent'),s.getPropertyValue('--pulse-background'),s.getPropertyValue('--pulse-font'),root.host?.dataset.pulseTheme].join('|');};
  let paletteKey='',modelColors=new Map();
  const colorCanvas=document.createElement('canvas');colorCanvas.width=colorCanvas.height=1;
  const colorContext=colorCanvas.getContext('2d',{willReadFrequently:true});
  const rgb=css=>{colorContext.clearRect(0,0,1,1);colorContext.fillStyle='#000';colorContext.fillStyle=css;colorContext.fillRect(0,0,1,1);return [...colorContext.getImageData(0,0,1,1).data].slice(0,3);};
  const luminance=a=>a.reduce((sum,v,i)=>{v/=255;return sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i];},0);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  const hsl=a=>{const [r,g,b]=a.map(v=>v/255),hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,l=(hi+lo)/2;return [d?((hi===r?(g-b)/d+(g<b?6:0):hi===g?(b-r)/d+2:(r-g)/d+4)*60):0,d?d/(1-Math.abs(2*l-1)):0,l];};
  const fromHsl=(h,s,l)=>{const a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))));};return [f(0),f(8),f(4)];};
  function syncPalette(){
    const models=[...mergedModelList].sort(),key=themeSignature()+'|'+models.join('|');if(key===paletteKey)return;paletteKey=key;modelColors.clear();
    const style=getComputedStyle(root.host||dialog),base=rgb(style.getPropertyValue('--pulse-accent').trim()||'#85a8ff'),background=rgb(style.getPropertyValue('--pulse-background').trim()||'#1c1d1f'),[h,s]=hsl(base);
    const dark=luminance(background)<.35,offsets=[0,-18,18,-36,36,-9,9,-27,27],tones=dark?[.64,.52,.73,.59,.68]:[.43,.33,.51,.38,.47];
    const end=contrast([255,255,255],background)>contrast([0,0,0],background)?1:0;
    models.forEach((model,i)=>{const hue=(h+offsets[i%offsets.length]+360)%360,saturation=s<.08?.07:Math.max(.28,Math.min(.55,s*.72));let lightness=tones[i%tones.length],c=fromHsl(hue,saturation,lightness);
      for(let step=0;contrast(c,background)<3&&step<100;step++){lightness+=end? .005:-.005;lightness=Math.max(0,Math.min(1,lightness));c=fromHsl(hue,saturation,lightness);}
      modelColors.set(model,'rgb('+c.join(' ')+')');
    });
  }
  const color=model=>modelColors.get(model)||'var(--pulse-accent)';
  function isModelRecent(model){
    if(!value?.today)return false;
    const cutoff=add(value.today,-2);
    for(const day of value?.days||[]){
      if(day.date>=cutoff&&day.date<=value.today){
        for(const [rawModel,r]of Object.entries(day.models||{})){
          if(parseModelTier(rawModel).key===model&&((r?.total||0)>0||(r?.requests||0)>0))return true;
        }
      }
    }
    return false;
  }
  function isModelDormantTrace(model,rangeTotals,totalTokens){
    if(isModelRecent(model))return false;
    const mTokens=rangeTotals.get(model)||0;
    return (totalTokens>0?mTokens/totalTokens:0)<0.001;
  }
  const totals=(from,to,filter=false)=>{
    const models={};
    for(const day of value?.days||[])if(day.date>=from&&day.date<=to)for(const [rawModel,r]of Object.entries(day.models||{})){
      const {key:model,tier}=parseModelTier(rawModel);
      if(filter&&(disabledModels.has(model)||userDismissedModels.has(model)))continue;
      const entry=models[model]||(models[model]={total:0,requests:0,uncached:0,cacheRead:0,cacheWrite:0,output:0,raws:{},tiers:{}});
      for(const field of ['total','requests','uncached','cacheRead','cacheWrite','output'])entry[field]+=r[field]||0;
      const rb=entry.raws[rawModel]||(entry.raws[rawModel]={total:0,requests:0,uncached:0,cacheRead:0,cacheWrite:0,output:0});
      for(const field of ['total','requests','uncached','cacheRead','cacheWrite','output'])rb[field]+=r[field]||0;
      const te=entry.tiers[tier]||(entry.tiers[tier]={total:0,requests:0,uncached:0,cacheRead:0,cacheWrite:0,output:0,raws:{}});
      for(const field of ['total','requests','uncached','cacheRead','cacheWrite','output'])te[field]+=r[field]||0;
      const trb=te.raws[rawModel]||(te.raws[rawModel]={total:0,requests:0,uncached:0,cacheRead:0,cacheWrite:0,output:0});
      for(const field of ['total','requests','uncached','cacheRead','cacheWrite','output'])trb[field]+=r[field]||0;
    }
    return {from,to,models,total:Object.values(models).reduce((n,r)=>n+r.total,0),requests:Object.values(models).reduce((n,r)=>n+r.requests,0)};
  };
  const node=(tag,className,content)=>{const n=document.createElement(tag);if(className)n.className=className;if(content!==undefined)n.textContent=content;return n;};
  function hideTip(){$('tip').hidden=true;tipTarget=null;tipModel=null;}
  function clearHover(){activeHover=null;highlightModel(null);hideTip();}
  function restoreScroll(body,savedTop){
    if(body.scrollTop!==savedTop){suppressScrollTipHide=true;body.scrollTop=savedTop;requestAnimationFrame(()=>{suppressScrollTipHide=false;});}
  }
  function positionTip(rect,clientX=null){
    const tip=$('tip');tip.hidden=false;
    const bounds=dialog.getBoundingClientRect(),r=tip.getBoundingClientRect();
    const anchorX=typeof clientX==='number'&&Number.isFinite(clientX)?clientX:rect.left+rect.width/2;
    tip.style.left=Math.min(bounds.right-r.width-12,Math.max(bounds.left+12,anchorX-r.width/2))+'px';
    const above=rect.top-r.height-10;
    tip.style.top=(above>=bounds.top+12?above:Math.min(bounds.bottom-r.height-12,rect.bottom+8))+'px';
  }
  function tooltip(bucket,target,activeModel=null){
    if(!$('tip').hidden&&tipTarget===target&&tipModel===activeModel)return;tipTarget=target;tipModel=activeModel;
    highlightModel(activeModel);
    const displayTotal=tab==='details'?Object.values(bucket.models).reduce((s,r)=>s+modelActiveTokens(r),0):bucket.total;
    const c=rangeCost(bucket.models,tab==='details',bucket.to);
    const costSuffix=c?' · '+formatCost(c):'';
    const tip=$('tip');tip.replaceChildren(node('div','tip-title',bucket.from===bucket.to?bucket.from:bucket.from+' – '+bucket.to),node('strong','',full(displayTotal)+' Token'),node('div','muted',w(`${bucket.requests} 次请求`,`${bucket.requests} requests`,`${bucket.requests} 次請求`)+costSuffix));
    for(const [model,r]of Object.entries(bucket.models).sort((a,b)=>b[1].total-a[1].total)){
      const mVal=tab==='details'?modelActiveTokens(r):r.total;
      const row=node('div','tip-model'+(activeModel?(activeModel===model?' active':' dimmed'):'')),label=node('span',''),dot=node('i','dot'),amount=node('span','',compact(mVal));dot.style.setProperty('--model-color',color(model));label.append(dot,document.createTextNode(fullModelName(model)));amount.append(node('span','model-share',displayTotal?(mVal/displayTotal*100).toFixed(1)+'%':'0%'));row.append(label,amount);tip.append(row);
    }
    positionTip(target.getBoundingClientRect());
  }
  function tierTooltip(model,r,row,clientX=null,refDate=''){
    const tiers=Object.entries(r.tiers||{}).filter(([,v])=>v.total>0||v.requests>0).sort((a,b)=>b[1].total-a[1].total);
    if(tiers.length<2)return;
    if(!$('tip').hidden&&tipTarget===row&&tipModel===model)return;
    tipTarget=row;tipModel=model;
    const tip=$('tip'),title=node('div','tip-title'),dot=node('i','dot');dot.style.setProperty('--model-color',color(model));
    const hasOrch=tiers.some(([tier])=>tier.includes('Orchestrator'));
    title.append(dot,document.createTextNode(fullModelName(model)+' · '+(hasOrch?w('模式与档位','Modes & tiers','模式與檔位'):w('档位分布','Thinking tiers','檔位分佈'))));
    tip.replaceChildren(title);
    const activeDenom=modelActiveTokens(r)||r.total;
    for(const [tier,stats]of tiers){
      const tVal=modelActiveTokens(stats),tCost=costOf(model,stats,true,refDate);
      const item=node('div','tip-model'),label=node('span','',tier||w('默认','Default','預設')),amount=node('span','',compact(tVal));
      if(tCost)amount.append(node('span','tier-cost',formatCost(tCost)));
      amount.append(node('span','model-share',activeDenom?(tVal/activeDenom*100).toFixed(1)+'%':'0%'));
      item.append(label,amount);tip.append(item);
    }
    const p=modelPrice(model,refDate||value?.today||'');
    if(p)tip.append(node('div','tip-rule'),node('div','tip-foot',priceHint(p)));
    positionTip(row.getBoundingClientRect(),clientX);
  }
  const bindBucket=(button,bucket,onClick,source='heat')=>{
    button.dataset.from=bucket.from;button.dataset.to=bucket.to;
    button.setAttribute('aria-label',(bucket.from===bucket.to?bucket.from:bucket.from+' – '+bucket.to)+': '+full(bucket.total)+' Token');
    button.addEventListener('pointerenter',()=>{activeHover={source,from:bucket.from,to:bucket.to,model:null,viaFocus:false};tooltip(bucket,button);});
    button.addEventListener('pointerleave',()=>{if(restoringDom)return;if(activeHover?.source===source&&activeHover.from===bucket.from&&activeHover.to===bucket.to&&!activeHover.viaFocus){activeHover=null;hideTip();highlightModel(null);}});
    button.addEventListener('focus',()=>{activeHover={source,from:bucket.from,to:bucket.to,model:null,viaFocus:true};tooltip(bucket,button);});
    button.addEventListener('blur',()=>{if(restoringDom)return;if(activeHover?.source===source&&activeHover.from===bucket.from&&activeHover.to===bucket.to){activeHover=null;hideTip();highlightModel(null);}});
    button.addEventListener('pointermove',event=>{const model=event.target.closest?.('.bar-segment')?.dataset.model||null;if(activeHover?.source===source)activeHover.model=model;tooltip(bucket,button,model);});
    button.addEventListener('click',onClick||(()=>{selected=bucket;selectedDay=bucket.from;anchor=bucket.from;showSelection();}));
  };
  function showSelection(){
    const bucket=selected||totals(value.today,value.today);
    const isSingleDay=bucket.from===bucket.to;
    let titleStr=isSingleDay?bucket.from:bucket.from+' – '+bucket.to;
    if(isSingleDay){
      const d=new Date(bucket.from+'T00:00:00Z');
      const dayNames=tw()?['週日','週一','週二','週三','週四','週五','週六']:(zh()?['周日','周一','周二','周三','周四','周五','周六']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
      titleStr+=' · '+dayNames[d.getUTCDay()];
    }
    text('selection-title',titleStr);
    const uncached=Object.values(bucket.models).reduce((n,r)=>n+(r.uncached||0)+(r.cacheWrite||0),0);
    const cacheRead=Object.values(bucket.models).reduce((n,r)=>n+(r.cacheRead||0),0);
    const output=Object.values(bucket.models).reduce((n,r)=>n+(r.output||0),0);
    const c=rangeCost(bucket.models,false,bucket.to);
    const costText=c?' · '+w(`预估成本 ${formatCost(c)}`,`Est. cost ${formatCost(c)}`,`預估成本 ${formatCost(c)}`):'';
    text('selection-value',full(bucket.total)+' Token · '+w(`${bucket.requests} 次请求`,`${bucket.requests} requests`,`${bucket.requests} 次請求`)+costText);
    const compWrap=$('selection-comp-wrap'),compBar=$('selection-comp-bar'),compLegend=$('selection-comp-legend');
    if(compWrap&&compBar&&compLegend){
      compBar.replaceChildren();compLegend.replaceChildren();
      if(bucket.total>0){
        const uPct=(uncached/bucket.total*100).toFixed(1),cPct=(cacheRead/bucket.total*100).toFixed(1),oPct=(output/bucket.total*100).toFixed(1);
        if(uncached>0){const s=node('div','comp-seg uncached');s.style.width=uPct+'%';compBar.append(s);}
        if(cacheRead>0){const s=node('div','comp-seg cached');s.style.width=cPct+'%';compBar.append(s);}
        if(output>0){const s=node('div','comp-seg output');s.style.width=oPct+'%';compBar.append(s);}
        for(const it of [
          {label:w('未缓存输入','Uncached','未快取輸入'),val:compact(uncached),pct:uPct,type:'uncached'},
          {label:w('缓存读取','Cache read','快取讀取'),val:compact(cacheRead),pct:cPct,type:'cached'},
          {label:w('输出','Output','輸出'),val:compact(output),pct:oPct,type:'output'}
        ]){
          const itemNode=node('div','comp-item');
          itemNode.append(node('i','comp-dot '+it.type),node('span','',it.label+':'),node('strong','',it.val),node('span','muted',`(${it.pct}%)`));
          compLegend.append(itemNode);
        }
        compWrap.hidden=false;
      }else compWrap.hidden=true;
    }
  }
  function renderHourly(){
    if(!value)return;
    if(!selectedDay||selectedDay>value.today)selectedDay=selected?.from&&selected.from===selected.to?selected.from:value.today;
    const pills=$('day-pills');pills.replaceChildren();
    const recentDays=[...new Set([value.today,...Array.from({length:6},(_,i)=>add(value.today,-(i+1))),selectedDay])].filter(d=>d&&d<=value.today).sort().reverse().slice(0,8);
    const dayNames=tw()?['週日','週一','週二','週三','週四','週五','週六']:(zh()?['周日','周一','周二','周三','周四','周五','周六']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
    for(const dStr of recentDays){
      const wName=dayNames[new Date(dStr+'T00:00:00Z').getUTCDay()];
      const btn=node('button','day-pill',dStr===value.today?(w('今天','Today','今天')+' '+wName):(dStr.slice(5)+' '+wName));
      btn.type='button';btn.setAttribute('aria-pressed',String(dStr===selectedDay));
      btn.addEventListener('click',()=>{selectedDay=dStr;selected=totals(dStr,dStr);renderHourly();});
      pills.append(btn);
    }
    const dayEntry=(value.days||[]).find(d=>d.date===selectedDay),hoursObj=dayEntry?.hours||{};
    const hourBuckets=[];let peakHour=-1,peakTokens=0;
    for(let h=0;h<24;h++){
      const hd=hoursObj[h]||{uncached:0,cacheRead:0,cacheWrite:0,output:0,total:0,requests:0,models:{}};
      const mergedModels={};
      for(const [rawM,mr]of Object.entries(hd.models||{})){
        const {key:m}=parseModelTier(rawM);
        const me=mergedModels[m]||(mergedModels[m]={total:0,requests:0});
        me.total+=mr.total||0;me.requests+=mr.requests||0;
      }
      if(hd.total>peakTokens){peakTokens=hd.total;peakHour=h;}
      hourBuckets.push({hour:h,...hd,models:mergedModels});
    }
    const activeHours=hourBuckets.filter(b=>b.total>0);
    if(activeHours.length>0){
      const peakStr=`${String(peakHour).padStart(2,'0')}:00–${String(peakHour+1).padStart(2,'0')}:00`;
      text('heat-sub',w(`${selectedDay} · 峰值时段 ${peakStr} · 活跃 ${activeHours.length} 小时`,`${selectedDay} · Peak ${peakStr} · ${activeHours.length} active hrs`,`${selectedDay} · 尖峰時段 ${peakStr} · 活躍 ${activeHours.length} 小時`));
    }else{
      text('heat-sub',value.hoursFrom&&selectedDay<value.hoursFrom?w(`小时明细仅保留 ${value.hoursFrom} 之后`,`Hourly detail kept since ${value.hoursFrom}`,`小時明細僅保留 ${value.hoursFrom} 之後`):w(`${selectedDay} · 暂无小时记录`,`${selectedDay} · No hourly usage`,`${selectedDay} · 尚無小時記錄`));
    }
    const max=Math.max(1,...hourBuckets.map(b=>b.total)),ceiling=max>1?Math.ceil(max/(10**Math.floor(Math.log10(max))))*10**Math.floor(Math.log10(max)):1;
    const plotH=190;
    $('hourly-axis').replaceChildren();$('hourly-plot').replaceChildren();
    for(let i=0;i<=4;i++){
      const label=node('span','',compact(ceiling*i/4));label.style.bottom=(18+plotH*i/4)+'px';$('hourly-axis').append(label);
      const line=node('i','grid-line');line.style.bottom=(18+plotH*i/4)+'px';$('hourly-plot').append(line);
    }
    for(const b of hourBuckets){
      const button=node('button','bar-column');button.type='button';const stack=node('div','stack');
      const uTokens=(b.uncached||0)+(b.cacheWrite||0),cTokens=b.cacheRead||0,oTokens=b.output||0;
      if(b.total>0){
        for(const [tok,col]of [[uTokens,'var(--pulse-accent)'],[cTokens,'#2d8a68'],[oTokens,'#cf7429']]){
          if(tok>0){const bar=node('i','bar-segment');bar.style.height=(tok/ceiling*plotH)+'px';bar.style.setProperty('--model-color',col);stack.append(bar);}
        }
      }else stack.append(node('i','empty-bar'));
      button.append(stack);
      if(b.hour%3===0||b.hour===23)button.append(node('span','x-label',`${String(b.hour).padStart(2,'0')}:00`));
      button.addEventListener('pointerenter',()=>{
        const tip=$('tip');
        tip.replaceChildren(
          node('div','tip-title',`${selectedDay} · ${String(b.hour).padStart(2,'0')}:00 – ${String(b.hour+1).padStart(2,'0')}:00`),
          node('strong','',full(b.total)+' Token'),
          node('div','muted',w(`${b.requests} 次请求`,`${b.requests} requests`,`${b.requests} 次請求`))
        );
        if(b.total>0){
          const compRow=node('div','muted',w(`未缓存 ${compact(uTokens)} · 缓存 ${compact(cTokens)} · 输出 ${compact(oTokens)}`,`Uncached ${compact(uTokens)} · Cache ${compact(cTokens)} · Out ${compact(oTokens)}`,`未快取 ${compact(uTokens)} · 快取 ${compact(cTokens)} · 輸出 ${compact(oTokens)}`));
          compRow.style.marginTop='5px';tip.append(compRow);
          for(const [m,mr]of Object.entries(b.models||{}).sort((x,y)=>y[1].total-x[1].total)){
            const mRow=node('div','tip-model'),mLbl=node('span',''),mDot=node('i','dot');
            mDot.style.setProperty('--model-color',color(m));mLbl.append(mDot,document.createTextNode(fullModelName(m)));
            mRow.append(mLbl,node('span','',compact(mr.total)));tip.append(mRow);
          }
        }
        positionTip(button.getBoundingClientRect());
      });
      button.addEventListener('pointerleave',()=>{hideTip();});
      $('hourly-plot').append(button);
    }
    if(!activeHours.length)$('hourly-plot').append(node('div','chart-empty',w('所选日期暂无小时记录','No hourly usage recorded on this day','所選日期尚無小時記錄')));
    selected=totals(selectedDay,selectedDay);
    showSelection();
  }
  function renderHeat({preserveHover=false}={}){
    if(!value)return;
    const isHour=heatMode==='hour';
    $('heat-view').hidden=isHour;$('hourly-view').hidden=!isHour;$('year-wrap').hidden=isHour;
    if(isHour){closeYear(false);for(const b of view.querySelectorAll('[data-heat]'))b.setAttribute('aria-pressed',String(b.dataset.heat===heatMode));renderHourly();return;}
    const savedHover=preserveHover&&activeHover?.source==='heat'?{...activeHover}:null;
    const start=week(year+'-01-01'),end=year+'-12-31',weeks=Math.floor((Date.parse(end)-Date.parse(start))/604800000)+1;
    $('heat').className='heat'+(heatMode==='week'?' week':'');
    $('heat').style.gridTemplateColumns=`repeat(${weeks},minmax(0,1fr))`;
    if(heatMode==='week')$('heat').style.setProperty('grid-template-columns',`repeat(${Math.ceil(weeks/2)},minmax(0,1fr))`,'important');
    const buckets=[];for(let i=0;i<(heatMode==='day'?weeks*7:weeks);i++){
      const date=add(start,heatMode==='day'?i:i*7),to=heatMode==='day'?date:add(date,6);
      buckets.push(heatMode==='day'?totals(date,date):totals(date<year+'-01-01'?year+'-01-01':date,to>end?end:to));
    }
    const max=Math.max(1,...buckets.map(b=>b.total));
    const heatNodes=[];let restoredTarget=null;
    for(const bucket of buckets){
      const button=node('button','');button.type='button';const future=bucket.from>value.today||bucket.to<year+'-01-01'||bucket.from>year+'-12-31';
      button.dataset.level=bucket.total===0?'0':String(Math.min(4,Math.ceil(bucket.total/max*4)));if(future){button.className='future';button.disabled=true;}
      if(!future){bindBucket(button,bucket,null,'heat');if(savedHover&&bucket.from===savedHover.from&&bucket.to===savedHover.to)restoredTarget={bucket,button};}
      button.tabIndex=-1;heatNodes.push(button);
    }
    const usable=heatNodes.filter(b=>!b.disabled),lastActive=[...heatNodes].reverse().find(b=>!b.disabled&&b.dataset.level!=='0');
    if(usable.length)(lastActive||usable.at(-1)).tabIndex=0;
    const monthNodes=[],weekdayNodes=[];
    if(heatMode==='day'){
      $('months').style.gridTemplateColumns=`repeat(${weeks},minmax(0,1fr))`;
      for(let m=1;m<=12;m++){const date=`${year}-${String(m).padStart(2,'0')}-01`,col=Math.floor((Date.parse(date)-Date.parse(start))/604800000)+1;
        const label=node('span','',zh()?m+'月':['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]);label.style.gridColumn=col;label.style.gridRow=1;monthNodes.push(label);}
      for(let i=0;i<7;i++)weekdayNodes.push(node('span','',i%2===0?(zh()?['一','','三','','五','','日'][i]:['M','','W','','F','','S'][i]):''));
    }
    restoringDom=true;
    try{$('heat').replaceChildren(...heatNodes);$('months').replaceChildren(...monthNodes);$('weekdays').replaceChildren(...weekdayNodes);}finally{restoringDom=false;}
    text('heat-sub',heatMode==='day'?w('每格代表一天','Each square is one day','每格代表一天'):w('每格代表一周 · 周一开始','Each square is one week · starts Monday','每格代表一週 · 週一開始'));
    const annual=totals(year+'-01-01',year+'-12-31');text('heat-summary',w(`${year} 年 · ${full(annual.total)} Token`,`${year} · ${full(annual.total)} tokens`,`${year} 年 · ${full(annual.total)} Token`));
    for(const b of view.querySelectorAll('[data-heat]'))b.setAttribute('aria-pressed',String(b.dataset.heat===heatMode));showSelection();
    if(restoredTarget){
      activeHover=savedHover;tooltip(restoredTarget.bucket,restoredTarget.button);
      if(savedHover.viaFocus){restoringDom=true;try{restoredTarget.button.focus({preventScroll:true});}finally{restoringDom=false;}}
    }else if(savedHover||activeHover?.source==='heat'){activeHover=null;hideTip();}
  }
  function highlightModel(model){
    if(model)$('plot').dataset.highlight=model;else delete $('plot').dataset.highlight;
    for(const bar of $('plot').querySelectorAll('.bar-segment')){if(model&&bar.dataset.model===model)bar.dataset.highlight='true';else delete bar.dataset.highlight;}
  }
  const chartSummary=node('div','chart-summary');$('detail-title').after(chartSummary);
  const chartHeading=node('div','detail-heading');$('detail-title').before(chartHeading);chartHeading.append($('detail-title'),chartSummary);
  function renderChart({preserveHover=false}={}){
    if(!value)return;
    const body=$('page-body'),savedTop=body.scrollTop,savedHover=preserveHover&&activeHover?{...activeHover}:null;
    syncModels();syncPalette();
    if(!savedHover){activeHover=null;hideTip();highlightModel(null);}
    const buckets=[];
    if(period==='day'){const start=month(anchor,0),end=add(month(anchor,1),-1);for(let date=start;date<=end;date=add(date,1))buckets.push(totals(date,date,false));text('range-label',start.slice(0,7));}
    else if(period==='week'){const start=add(week(anchor),-11*7);for(let i=0;i<12;i++){const from=add(start,i*7);buckets.push(totals(from,add(from,6),false));}text('range-label',start.slice(5)+' – '+add(week(anchor),6).slice(5));}
    else{for(let i=-11;i<=0;i++){const from=month(anchor,i);buckets.push(totals(from,add(month(from,1),-1),false));}text('range-label',buckets[0].from.slice(0,7)+' – '+month(anchor,0).slice(0,7));}
    $('next').disabled=period==='week'?week(anchor)>=week(value.today):anchor.slice(0,7)>=value.today.slice(0,7);

    const compFilters=$('comp-filters');compFilters.replaceChildren();
    for(const [key,label,c]of [['uncached',w('未缓存输入','Uncached input','未快取輸入'),'var(--pulse-accent)'],['cacheRead',w('缓存读取','Cache read','快取讀取'),'#2d8a68'],['output',w('输出','Output','輸出'),'#cf7429']]){
      const button=node('button',''),dot=node('i','comp-filter-dot');dot.style.setProperty('--model-color',c);
      button.append(dot,document.createTextNode(label));button.type='button';
      button.setAttribute('aria-pressed',String(!disabledComponents.has(key)));
      button.addEventListener('click',()=>{if(disabledComponents.has(key))disabledComponents.delete(key);else disabledComponents.add(key);renderChart();});
      compFilters.append(button);
    }

    const rangeStart=buckets[0]?.from,rangeEnd=buckets.at(-1)?.to;
    const rangeModelTotals=new Map();
    for(const day of value.days||[]){
      if(day.date>=rangeStart&&day.date<=rangeEnd){
        for(const [rawM,r]of Object.entries(day.models||{})){
          const {key:m}=parseModelTier(rawM);
          rangeModelTotals.set(m,(rangeModelTotals.get(m)||0)+(r.total||0));
        }
      }
    }
    const totalRangeTokens=[...rangeModelTotals.values()].reduce((sum,v)=>sum+v,0);
    const hasAnyRangeUsage=totalRangeTokens>0;
    const candidateModels=hasAnyRangeUsage?mergedModelList.filter(m=>(rangeModelTotals.get(m)||0)>0):[...mergedModelList];
    let dormantTraceCount=0,dormantTraceTokens=0,dismissedCount=0;
    const legendNodes=[];
    for(const model of candidateModels){
      if(userDismissedModels.has(model)){dismissedCount++;continue;}
      const totalInRange=rangeModelTotals.get(model)||0;
      const isDormant=hasAnyRangeUsage&&!focusedBucket&&isModelDormantTrace(model,rangeModelTotals,totalRangeTokens);
      if(isDormant&&!showDormantTrace){dormantTraceCount++;dormantTraceTokens+=totalInRange;continue;}
      const button=node('button',''),dot=node('i','dot'),lblText=fullModelName(model);dot.style.setProperty('--model-color',color(model));
      button.append(dot,node('span','legend-name',lblText));
      if(totalInRange>0)button.append(node('span','legend-badge',compact(totalInRange)));
      const dismissBtn=node('span','legend-dismiss','×');
      dismissBtn.title=w('隐藏此模型','Hide this model','隱藏此模型');
      dismissBtn.addEventListener('click',e=>{e.stopPropagation();userDismissedModels.add(model);disabledModels.add(model);saveDismissed();renderChart();});
      button.append(dismissBtn);
      button.type='button';button.dataset.model=model;button.setAttribute('aria-pressed',String(!disabledModels.has(model)));
      button.title=(isDormant?w('[历史微量] ','[Trace] ','[歷史微量] '):'')+w(`用量: ${full(totalInRange)} Token (Alt+点击独占，右键或×隐藏)`,`Usage: ${full(totalInRange)} tokens (Alt+click to isolate, right-click or × to hide)`,`用量: ${full(totalInRange)} Token (Alt+點擊獨佔，右鍵或×隱藏)`);
      button.addEventListener('contextmenu',e=>{e.preventDefault();userDismissedModels.add(model);disabledModels.add(model);saveDismissed();renderChart();});
      button.addEventListener('click',event=>{
        if(event.altKey||event.metaKey){
          const activePeers=candidateModels.filter(m=>!userDismissedModels.has(m));
          const isolated=activePeers.every(m=>m===model?!disabledModels.has(m):disabledModels.has(m));
          disabledModels.clear();for(const m of userDismissedModels)disabledModels.add(m);
          if(!isolated)for(const m of activePeers)if(m!==model)disabledModels.add(m);
        }else{
          if(disabledModels.has(model))disabledModels.delete(model);else disabledModels.add(model);
        }
        renderChart();
      });
      button.addEventListener('pointerenter',()=>{activeHover={source:'legend',model};highlightModel(disabledModels.has(model)?null:model);});
      button.addEventListener('pointerleave',()=>{if(restoringDom)return;if(activeHover?.source==='legend'&&activeHover.model===model)activeHover=null;highlightModel(null);});
      legendNodes.push(button);
    }
    if(dormantTraceCount>0){
      const traceBtn=node('button','legend-trace-btn',w(`+${dormantTraceCount} 历史微量 (${compact(dormantTraceTokens)})`,`+${dormantTraceCount} trace (${compact(dormantTraceTokens)})`,`+${dormantTraceCount} 歷史微量 (${compact(dormantTraceTokens)})`));
      traceBtn.type='button';traceBtn.addEventListener('click',()=>{showDormantTrace=true;renderChart();});legendNodes.push(traceBtn);
    }else if(showDormantTrace&&hasAnyRangeUsage&&candidateModels.some(m=>!userDismissedModels.has(m)&&isModelDormantTrace(m,rangeModelTotals,totalRangeTokens))){
      const collapseBtn=node('button','legend-trace-btn',w('收起历史微量','Collapse trace','收合歷史微量'));
      collapseBtn.type='button';collapseBtn.addEventListener('click',()=>{showDormantTrace=false;renderChart();});legendNodes.push(collapseBtn);
    }
    if(dismissedCount>0){
      const restoreBtn=node('button','legend-restore-btn',w(`已隐藏 ${dismissedCount} 个 (恢复)`,`${dismissedCount} hidden (restore)`,`已隱藏 ${dismissedCount} 個 (還原)`));
      restoreBtn.type='button';restoreBtn.addEventListener('click',()=>{for(const m of candidateModels){userDismissedModels.delete(m);disabledModels.delete(m);}saveDismissed();renderChart();});
      legendNodes.push(restoreBtn);
    }
    restoringDom=true;try{$('legend').replaceChildren(...legendNodes);}finally{restoringDom=false;}

    for(const b of buckets){
      b.activeTotal=Object.entries(b.models).reduce((sum,[m,r])=>(disabledModels.has(m)||userDismissedModels.has(m))?sum:sum+modelActiveTokens(r),0);
    }
    const max=Math.max(1,...buckets.map(b=>b.activeTotal)),ceiling=max>1?Math.ceil(max/(10**Math.floor(Math.log10(max))))*10**Math.floor(Math.log10(max)):1;
    const axisNodes=[],plotNodes=[];let restoredPlot=null;
    for(let i=0;i<=4;i++){const label=node('span','',compact(ceiling*i/4));label.style.bottom=(18+150*i/4)+'px';axisNodes.push(label);const line=node('i','grid-line');line.style.bottom=(18+150*i/4)+'px';plotNodes.push(line);}
    for(const [i,bucket]of buckets.entries()){
      const button=node('button','bar-column');button.type='button';const stack=node('div','stack');
      const isFocused=focusedBucket&&focusedBucket.from===bucket.from&&focusedBucket.to===bucket.to;
      if(isFocused)button.classList.add('focused-bar');
      const segments=mergedModelList.filter(m=>!disabledModels.has(m)&&!userDismissedModels.has(m)&&modelActiveTokens(bucket.models[m])>0);
      for(const [j,model]of segments.entries()){
        const r=bucket.models[model],activeTok=modelActiveTokens(r),bar=node('i','bar-segment'),height=activeTok/ceiling*150;
        bar.dataset.model=model;bar.setAttribute('aria-hidden','true');bar.style.setProperty('--model-color',color(model));bar.style.height=height+'px';
        if(j&&height>=3)bar.style.boxShadow='inset 0 -1px 0 color-mix(in srgb,var(--pulse-background) 48%,transparent)';
        stack.append(bar);
      }
      if(!bucket.activeTotal)stack.append(node('i','empty-bar'));button.append(stack);
      if(period!=='day'||i%3===0||i===buckets.length-1)button.append(node('span','x-label',period==='day'?String(i+1):period==='week'?bucket.from.slice(5):bucket.from.slice(0,7)));
      const filteredBucket={...bucket,total:bucket.activeTotal,models:Object.fromEntries(Object.entries(bucket.models).filter(([m])=>!disabledModels.has(m)&&!userDismissedModels.has(m)))};
      bindBucket(button,filteredBucket,()=>{
        if(isFocused)focusedBucket=null;
        else{
          const lbl=period==='month'?bucket.from.slice(0,7):(bucket.from===bucket.to?bucket.from:bucket.from+' – '+bucket.to);
          focusedBucket={from:bucket.from,to:bucket.to,label:lbl};
        }
        renderChart();
      },'plot');
      if(savedHover?.source==='plot'&&bucket.from===savedHover.from&&bucket.to===savedHover.to)restoredPlot={bucket:filteredBucket,button};
      plotNodes.push(button);
    }
    if(!buckets.some(b=>b.activeTotal))plotNodes.push(node('div','chart-empty',w('所选时段暂无用量记录','No usage recorded in this period','所選時段尚無用量記錄')));
    restoringDom=true;try{$('axis').replaceChildren(...axisNodes);$('plot').replaceChildren(...plotNodes);}finally{restoringDom=false;}

    const drilldownBanner=$('drilldown-banner');
    if(focusedBucket){
      const fb=totals(focusedBucket.from,focusedBucket.to,true);
      const fbTokens=Object.values(fb.models).reduce((s,r)=>s+modelActiveTokens(r),0);
      const fbCost=rangeCost(fb.models,true,focusedBucket.to);
      text('drilldown-banner-text',w(`筛选：${focusedBucket.label} · ${compact(fbTokens)} Token`+(fbCost?` · 预估成本 ${formatCost(fbCost)}`:''),`Filtered: ${focusedBucket.label} · ${compact(fbTokens)} tokens`+(fbCost?` · Est. cost ${formatCost(fbCost)}`:''),`篩選：${focusedBucket.label} · ${compact(fbTokens)} Token`+(fbCost?` · 預估成本 ${formatCost(fbCost)}`:'')));
      text('clear-drilldown',w('清除筛选','Clear filter','清除篩選'));
      drilldownBanner.hidden=false;
    }else drilldownBanner.hidden=true;
    $('clear-drilldown').onclick=()=>{focusedBucket=null;renderChart();};

    const refDate=focusedBucket?focusedBucket.to:(buckets.at(-1)?.to||value?.today||'');
    const rangeTotals=focusedBucket?totals(focusedBucket.from,focusedBucket.to,true):totals(buckets[0].from,buckets.at(-1).to,true);
    const activeTotalTokens=Object.values(rangeTotals.models).reduce((s,r)=>s+modelActiveTokens(r),0);
    const tableCostObj=rangeCost(rangeTotals.models,true,refDate);
    const costExtra=tableCostObj?' · '+w(`预估成本 ${formatCost(tableCostObj)}`,`Est. cost ${formatCost(tableCostObj)}`,`預估成本 ${formatCost(tableCostObj)}`):'';
    chartSummary.replaceChildren(node('strong','',compact(activeTotalTokens)+' Token'),document.createTextNode(' · '+w(`${full(rangeTotals.requests)} 次请求`,`${full(rangeTotals.requests)} requests`,`${full(rangeTotals.requests)} 次請求`)+costExtra));

    const columns=[
      {key:'model',label:w('模型','Model','模型')},
      {key:'total',label:w('总 Token','Total tokens','總 Token')},
      {key:'uncached',label:w('未缓存输入','Uncached input','未快取輸入')},
      {key:'cacheRead',label:w('缓存读取','Cache read','快取讀取')},
      {key:'cacheWrite',label:w('缓存写入','Cache write','快取寫入')},
      {key:'output',label:w('输出','Output','輸出')},
      {key:'cost',label:w('成本','Cost','成本')}
    ];
    $('table-head').replaceChildren(...columns.map(col=>{
      const th=node('th','sortable');th.append(node('span','',col.label));
      if(sortKey===col.key)th.append(node('span','sort-arrow',sortOrder==='asc'?'▲':'▼'));
      th.addEventListener('click',()=>{if(sortKey===col.key)sortOrder=sortOrder==='asc'?'desc':'asc';else{sortKey=col.key;sortOrder=col.key==='model'?'asc':'desc';}renderChart();});
      return th;
    }));

    const rowsData=Object.entries(rangeTotals.models).map(([model,r])=>{
      const activeTokens=modelActiveTokens(r),costObj=costOf(model,r,true,refDate);
      return {model,r,activeTokens,costUSD:costObj?costObj.usd:-1,costObj};
    }).filter(item=>!focusedBucket||item.activeTokens>0);
    rowsData.sort((a,b)=>{
      let cmp=0;
      if(sortKey==='model')cmp=fullModelName(a.model).localeCompare(fullModelName(b.model));
      else if(sortKey==='total')cmp=a.activeTokens-b.activeTokens;
      else if(sortKey==='cost')cmp=a.costUSD-b.costUSD;
      else cmp=(a.r[sortKey]||0)-(b.r[sortKey]||0);
      return sortOrder==='asc'?cmp:-cmp;
    });
    const makeCell=(compKey,val)=>{
      const td=node('td','');td.title=full(val)+' Token';
      if(compKey&&disabledComponents.has(compKey))td.append(node('span','excluded-val',shortNum(val)));
      else td.textContent=shortNum(val);
      return td;
    };
    let restoredRow=null;
    const rowNodes=rowsData.map(({model,r,activeTokens,costObj})=>{
      const row=node('tr',''),label=node('td',''),dot=node('span','dot');dot.style.setProperty('--model-color',color(model));label.append(dot,document.createTextNode(fullModelName(model)));
      const costCell=node('td','col-cost',formatCost(costObj));
      costCell.title=(costObj?formatCost(costObj)+' ('+usd(costObj.usd)+')\n':'')+priceHint(modelPrice(model,refDate));
      row.append(label,makeCell(null,activeTokens),makeCell('uncached',r.uncached),makeCell('cacheRead',r.cacheRead),makeCell('uncached',r.cacheWrite),makeCell('output',r.output),costCell);
      row.dataset.model=model;
      const multiTier=Object.values(r.tiers||{}).filter(v=>v.total>0||v.requests>0).length>=2;
      if(savedHover?.source==='table'&&savedHover.model===model)restoredRow={row,r,multiTier};
      row.addEventListener('pointerenter',event=>{activeHover={source:'table',model,clientX:event.clientX};highlightModel(model);if(multiTier)tierTooltip(model,r,row,event.clientX,refDate);else hideTip();});
      row.addEventListener('pointerleave',()=>{if(restoringDom)return;if(activeHover?.source==='table'&&activeHover.model===model)activeHover=null;highlightModel(null);if(tipTarget===row)hideTip();});
      return row;
    });
    restoringDom=true;try{$('table-body').replaceChildren(...rowNodes);}finally{restoringDom=false;}
    for(const b of view.querySelectorAll('[data-period]'))b.setAttribute('aria-pressed',String(b.dataset.period===period));
    if(savedHover?.source==='table'){
      if(restoredRow){activeHover=savedHover;highlightModel(savedHover.model);if(restoredRow.multiTier)tierTooltip(savedHover.model,restoredRow.r,restoredRow.row,savedHover.clientX,refDate);else hideTip();}
      else clearHover();
    }else if(savedHover?.source==='legend'){
      if(mergedModelList.includes(savedHover.model)){activeHover=savedHover;highlightModel(disabledModels.has(savedHover.model)?null:savedHover.model);}
      else clearHover();
    }else if(savedHover?.source==='plot'){
      if(restoredPlot){activeHover=savedHover;tooltip(restoredPlot.bucket,restoredPlot.button,savedHover.model||null);if(savedHover.viaFocus){restoringDom=true;try{restoredPlot.button.focus({preventScroll:true});}finally{restoringDom=false;}}}
      else clearHover();
    }
    restoreScroll(body,savedTop);
    lastScrollTop=body.scrollTop;
  }
  function render({preserveHover=false}={}){
    const body=$('page-body'),savedTop=body.scrollTop;
    renderGuide();
    if(!value){
      closeYear(false);clearHover();$('overview').hidden=true;$('details').hidden=true;$('usage-waiting').hidden=false;
      const sc=$('scope-controls');if(sc)sc.hidden=typeof onScope!=='function';
      text('usage-waiting',w('正在重新连接统计…','Reconnecting usage…','正在重新連線統計資料…'));text('subtitle',w('正在重新连接本机统计','Reconnecting local usage','正在重新連線本機統計'));text('coverage','');text('timezone','');$('alert').hidden=true;
      for(const metric of $('totals').children){metric.title='';metric.querySelector('.value')?.replaceChildren(node('span','','—'));const sub=metric.querySelector('.metric-sub');if(sub)sub.textContent='';}
      return;
    }
    $('usage-waiting').hidden=true;
    syncModels();syncPalette();
    const activeScope=pendingScope||(value.scope==='local'?'local':'account');
    text('title',w('用量统计','Token usage','用量統計'));dialog.setAttribute('aria-label',w('用量统计','Token usage','用量統計'));text('subtitle',activeScope==='local'?w(`本机 ${hostLabel} · 全部流经统计`,`Local ${hostLabel} · all local`,`本機 ${hostLabel} · 本機全部`):w(`本机 ${hostLabel} · 当前账号`,`Local ${hostLabel} · current account`,`本機 ${hostLabel} · 目前帳號`));
    const scopeControls=$('scope-controls');if(scopeControls){
      const hideControls=typeof onScope!=='function';
      if(scopeControls.hidden!==hideControls)scopeControls.hidden=hideControls;
      const scopeLabel=w('统计范围','Usage scope','統計範圍');
      if(scopeControls.getAttribute('aria-label')!==scopeLabel)scopeControls.setAttribute('aria-label',scopeLabel);
      if(scopeControls.dataset.activeScope!==activeScope)scopeControls.dataset.activeScope=activeScope;
      for(const b of scopeControls.querySelectorAll('button')){
        const k=b.dataset.usageScope,lbl=k==='local'?language.t('usageScopeLocal'):language.t('usageScopeAccount'),pressed=String(activeScope===k);
        if(b.textContent!==lbl)b.textContent=lbl;
        if(b.getAttribute('aria-pressed')!==pressed)b.setAttribute('aria-pressed',pressed);
      }
    }
    if(value.scope==='account'&&value.accountAvailable===false&&!scopeLoading){
      text('overview-tab',w('概览','Overview','概覽'));text('details-tab',w('详情','Details','詳細資料'));
      closeYear(false);clearHover();$('overview').hidden=true;$('details').hidden=true;$('usage-waiting').hidden=false;
      text('usage-waiting',w('当前未检测到登录账号，可切换到「本机全部」查看统计，或在 Antigravity 登录后重试。','No signed-in account detected. Switch to All local or sign in to view account usage.','目前未偵測到登入帳號，可切換至「本機全部」檢視統計，或於 Antigravity 登入後重試。'));
      languagePicker.update();for(const [id,label]of [['locale',language.t('language')],['refresh',w('刷新用量','Refresh usage','重新整理用量')],['close',w('关闭','Close','關閉')]]){$(id).setAttribute('aria-label',label);$(id).title=label;}
      for(const metric of $('totals').children){metric.title='';metric.querySelector('.value')?.replaceChildren(node('span','','—'));const sub=metric.querySelector('.metric-sub');if(sub)sub.textContent='';}
      text('coverage','');text('timezone','');$('alert').hidden=true;return;
    }
    text('overview-tab',w('活动概览','Activity','活動總覽'));text('details-tab',w('用量详情','Usage details','用量詳細資料'));text('activity-title',heatMode==='hour'?w('单日时段活跃','Daily hourly activity','單日時段活躍'):w('Token 活动','Token activity','Token 活動'));text('detail-title',w('按模型统计','Usage by model','依模型統計'));
    languagePicker.update();for(const [id,label]of [['locale',language.t('language')],['refresh',w('刷新用量','Refresh usage','重新整理用量')],['close',w('关闭','Close','關閉')]]){$(id).setAttribute('aria-label',label);$(id).title=label;}text('less',w('少','Less','少'));text('more',w('多','More','多'));text('selection-details',w('查看明细','View breakdown','檢視明細'));
    for(const b of view.querySelectorAll('[data-heat]'))b.textContent=b.dataset.heat==='day'?w('每天','Daily','每日'):b.dataset.heat==='week'?w('每周','Weekly','每週'):w('24h 时段','24h Hourly','24h 時段');
    for(const b of view.querySelectorAll('[data-period]'))b.textContent=({day:w('天','Day','日'),week:w('周','Week','週'),month:w('月','Month','月')})[b.dataset.period];
    $('overview-tab').setAttribute('aria-selected',String(tab==='overview'));$('details-tab').setAttribute('aria-selected',String(tab==='details'));$('overview').hidden=tab!=='overview';$('details').hidden=tab!=='details';
    const weekFrom=week(value.today),monthFrom=value.today.slice(0,7)+'-01';
    const todayCost=rangeCost(totals(value.today,value.today).models,false,value.today);
    const weekCost=rangeCost(totals(weekFrom,value.today).models,false,value.today);
    const monthCost=rangeCost(totals(monthFrom,value.today).models,false,value.today);
    const allCost=rangeCost(totals('2000-01-01','2099-12-31').models,false,value.today);
    const fin=computeOverviewFinance();
    const metricCards=[
      [w('今日用量','Today','今日用量'),value.todayTokens,todayCost],
      [w('本周用量','This week','本週用量'),value.weekTokens,weekCost],
      [w('本月用量','This month','本月用量'),value.monthTokens,monthCost],
      [w('累计用量','All time','累積用量'),value.totalTokens,allCost]
    ].map(([label,total,costObj])=>{
      const metric=node('div','metric'),n=node('div','value',compact(total));n.append(node('span','unit','Token'));metric.append(node('label','',label),n);
      if(costObj&&total>0)metric.append(node('div','metric-sub',w(`预估 ${formatCost(costObj)}`,`Est. ${formatCost(costObj)}`,`預估 ${formatCost(costObj)}`)));
      metric.title=full(total)+' Token'+(costObj?` · ${formatCost(costObj)}`:'');
      return metric;
    });
    const weeklyCard=node('div','metric metric-est'),weeklyVal=node('div','value');
    let weeklySub=null;
    if(fin.weeklyEst){
      weeklyVal.append(node('span','approx','≈'),document.createTextNode(compactUsd(fin.weeklyEst.totalUsd)),node('span','unit','USD'));
      const cnyEst=fin.weeklyEst.totalUsd*(Number(value?.pricing?.exchangeRate)||7.15);
      const cnyStr=cnyEst>=1000?'¥'+Math.round(cnyEst).toLocaleString('en-US'):'¥'+cnyEst.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      weeklySub=node('div','metric-sub',zh()?`≈${cnyStr}`:w('等效 API 成本','API list equiv.','等效 API 成本'));
      const detail=fin.weeklyEst.pools.map(p=>`${p.label} ${w('约 ','≈ ','約 ')}${usd(p.usd)}`+(p.usedFraction!==null?w(`（已用 ${Math.round(p.usedFraction*100)}%${p.fullTokens?` · 满额约 ${compact(p.fullTokens)} Token`:''}）`,` (${Math.round(p.usedFraction*100)}% used${p.fullTokens?` · full ~${compact(p.fullTokens)} tokens`:''})`,`（已用 ${Math.round(p.usedFraction*100)}%${p.fullTokens?` · 滿額約 ${compact(p.fullTokens)} Token`:''}）`):'')).join(' · ');
      const costDirect=fin.weeklyEst.pools.some(p=>p.costBased);
      weeklyCard.title=(costDirect?w('按等效 API 成本与周额度进度推算：','Estimated weekly full quota from equivalent API cost & quota progress: ','按等效 API 成本與週額度進度推算：'):w('按近 7 天模型/缓存配比与周额度进度推算：','Estimated weekly full quota from recent model/cache mix & quota progress: ','按近 7 天模型/快取配比與週額度進度推算：'))+usd(fin.weeklyEst.totalUsd)+' USD · '+detail;
    }else{
      weeklyVal.textContent='—';
      weeklyCard.title=fin.waitingSamples?w('本周额度样本较少，消耗达到阈值后自动推算','Not enough weekly quota usage yet; estimates appear once usage crosses threshold','本週額度樣本較少，消耗達到門檻後自動推算'):w('需登录账号并同步周额度后推算','Sign in and sync weekly quota to estimate','需登入帳號並同步週額度後推算');
    }
    weeklyCard.append(node('label','',w('预测周额度','Est. weekly','預測週額度')),weeklyVal);
    if(weeklySub)weeklyCard.append(weeklySub);
    metricCards.push(weeklyCard);
    $('totals').replaceChildren(...metricCards);
    const years=[];const first=Number(value.firstDate?.slice(0,4)||value.today.slice(0,4)),currentYear=Number(value.today.slice(0,4)),minimum=Math.max(first,currentYear-10);for(let y=currentYear;y>=minimum;y--)years.push(y);
    if($('year').dataset.years!==years.join(',')){
      $('year-menu').replaceChildren(...years.map(y=>{const option=node('button','year-option');option.type='button';option.dataset.year=String(y);option.setAttribute('role','option');option.tabIndex=-1;
        setMarkup(option,'<span></span><svg class="year-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>');option.firstElementChild.textContent=String(y);
        option.addEventListener('click',()=>{year=String(y);syncYear();closeYear();renderHeat();});return option;}));$('year').dataset.years=years.join(',');
    }
    syncYear();
    text('coverage',w(`已记录 ${full(value.requests)} 次请求${value.firstDate?' · 始于 '+value.firstDate:''}`,`${full(value.requests)} requests recorded${value.firstDate?' · since '+value.firstDate:''}`,`已記錄 ${full(value.requests)} 次請求${value.firstDate?' · 起始於 '+value.firstDate:''}`));
    text('timezone',value.timeZone+' · '+(value.syncing||value.retryingConversations>0?w('正在同步历史…','Syncing history…','正在同步歷程記錄…'):w('本地统计','Local usage','本機統計')));
    const alerts=[];if(value.unknownRequests)alerts.push(w(`${value.unknownRequests} 次请求日期未知，共 ${compact(value.unknownTokens)} Token`,`${value.unknownRequests} undated requests · ${compact(value.unknownTokens)} tokens`,`${value.unknownRequests} 次請求日期未知，共 ${compact(value.unknownTokens)} Token`));
    const confirmedMissing=value.confirmedMissingConversations??(value.syncing?0:value.missingConversations);
    if(value.partialRequests||value.unreadableFiles||confirmedMissing>0&&!value.syncing||value.persistenceError)alerts.push(w('部分记录暂不可读取，用量可能不完整','Some records are unavailable; usage may be incomplete','部分記錄暫無法讀取，用量可能不完整'));
    $('alert').hidden=!alerts.length;text('alert',alerts.join(' · '));
    if(tab==='overview')renderHeat({preserveHover});else renderChart({preserveHover});
    restoreScroll(body,savedTop);
    lastScrollTop=body.scrollTop;
  }
  function changeTab(next){closeYear(false);clearHover();tab=next;lastScrollTop=0;$('page-body').scrollTop=0;render();}
  $('overview-tab').addEventListener('click',()=>changeTab('overview'));$('details-tab').addEventListener('click',()=>changeTab('details'));
  $('table-body').addEventListener('pointerleave',()=>{if(restoringDom)return;if(activeHover?.source==='table'){activeHover=null;highlightModel(null);hideTip();}});
  $('legend').addEventListener('pointerleave',()=>{if(restoringDom)return;if(activeHover?.source==='legend'){activeHover=null;highlightModel(null);}});
  $('heat').addEventListener('pointerleave',()=>{if(restoringDom)return;if(activeHover?.source==='heat'&&!activeHover.viaFocus){activeHover=null;hideTip();highlightModel(null);}});
  $('plot').addEventListener('pointerleave',()=>{if(restoringDom)return;if(activeHover?.source==='plot'&&!activeHover.viaFocus){activeHover=null;hideTip();highlightModel(null);}});
  for(const button of view.querySelectorAll('[data-usage-scope]'))button.addEventListener('click',()=>{
    if(disposed||!onScope)return;
    const next=button.dataset.usageScope,currentScope=pendingScope||(value?.scope==='local'?'local':'account');
    if(!next||next===currentScope)return;
    pendingScope=next;focusedBucket=null;
    const cached=scopeCache.get(next);
    if(cached){
      if(accountKey&&accountKey!==cached.accountKey){selected=null;selectedDay=cached.today;disabledModels.clear();for(const m of userDismissedModels)disabledModels.add(m);year=cached.today.slice(0,4);anchor=cached.today;}
      accountKey=cached.accountKey;value=cached;scopeLoading=false;delete page.dataset.scopeLoading;lastKey=contentKey(cached);render();animateScopeChange();
    }else{
      scopeLoading=true;page.dataset.scopeLoading='true';render();
    }
    void Promise.resolve(onScope(next)).then(()=>{
      if(!disposed&&pendingScope===next){pendingScope=null;scopeLoading=false;delete page.dataset.scopeLoading;if(dialog.open)render();}
    },()=>{
      if(!disposed&&pendingScope===next){pendingScope=null;scopeLoading=false;delete page.dataset.scopeLoading;if(dialog.open)render();}
    });
  });
  for(const b of view.querySelectorAll('[data-heat]'))b.addEventListener('click',()=>{heatMode=b.dataset.heat;text('activity-title',heatMode==='hour'?w('单日时段活跃','Daily hourly activity','單日時段活躍'):w('Token 活动','Token activity','Token 活動'));renderHeat();});
  for(const b of view.querySelectorAll('[data-period]'))b.addEventListener('click',()=>{period=b.dataset.period;focusedBucket=null;renderChart();});
  function syncYear(){
    text('year-label',String(year));$('year').setAttribute('aria-label',w('选择年份','Select year','選取年份')+' · '+year);$('year-menu').setAttribute('aria-label',w('年份','Year','年份'));
    for(const option of $('year-menu').children)option.setAttribute('aria-selected',String(option.dataset.year===String(year)));
  }
  function closeYear(restore=true){if(!$('year-menu').matches(':popover-open'))return;$('year-menu').hidePopover();$('year').setAttribute('aria-expanded','false');if(restore)$('year').focus({preventScroll:true});}
  function positionYear(){
    if(!$('year-menu').matches(':popover-open'))return;const menu=$('year-menu'),r=$('year').getBoundingClientRect(),bounds=dialog.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
    menu.style.left=Math.max(bounds.left+12,Math.min(r.right-width,bounds.right-width-12))+'px';const below=r.bottom+7;
    menu.style.top=(below+height<=bounds.bottom-12?below:Math.max(bounds.top+12,r.top-height-7))+'px';
  }
  function openYear(){
    clearHover();$('year-menu').showPopover();$('year').setAttribute('aria-expanded','true');positionYear();
    ($('year-menu').querySelector('[aria-selected=true]')||$('year-menu').firstElementChild)?.focus({preventScroll:true});
  }
  $('year').addEventListener('click',()=>{$('year-menu').matches(':popover-open')?closeYear():openYear();});
  $('year').addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();openYear();if(event.key==='Home')$('year-menu').firstElementChild?.focus();if(event.key==='End')$('year-menu').lastElementChild?.focus();}});
  $('year-menu').addEventListener('keydown',event=>{
    const options=[...$('year-menu').children],current=options.indexOf(view.activeElement);let next=null;
    if(event.key==='ArrowDown')next=Math.min(options.length-1,current+1);else if(event.key==='ArrowUp')next=Math.max(0,current-1);else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;
    if(next!==null){event.preventDefault();options[next]?.focus({preventScroll:true});}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeYear();}else if(event.key==='Tab')closeYear();
  });
  view.addEventListener('pointerdown',event=>{const path=event.composedPath();if(!path.includes($('year'))&&!path.includes($('year-menu')))closeYear(false);});
  $('page-body').addEventListener('scroll',()=>{const body=$('page-body'),moved=Math.abs(body.scrollTop-lastScrollTop)>=1;if(dialog.open&&dialog.matches(':popover-open')&&body.clientHeight>0&&body.scrollHeight>body.clientHeight)lastScrollTop=body.scrollTop;closeYear(false);if(!suppressScrollTipHide&&moved&&(activeHover||!$('tip').hidden))clearHover();},{passive:true});
  window.addEventListener('resize',positionYear);
  $('heat').addEventListener('keydown',event=>{
    const buttons=[...$('heat').children],index=buttons.indexOf(event.target);if(index<0)return;
    const delta=heatMode==='day'?{ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}:{ArrowLeft:-1,ArrowRight:1,ArrowUp:-Math.ceil(buttons.length/2),ArrowDown:Math.ceil(buttons.length/2)};
    let next=event.key==='Home'?buttons.findIndex(b=>!b.disabled):event.key==='End'?buttons.findLastIndex(b=>!b.disabled):index+(delta[event.key]??NaN);
    if(!Number.isFinite(next)||next<0||next>=buttons.length||buttons[next].disabled)return;event.preventDefault();event.target.tabIndex=-1;buttons[next].tabIndex=0;buttons[next].focus();
  });
  $('selection-details').addEventListener('click',()=>{
    const target=heatMode==='hour'?(selectedDay||value.today):(selected?.from||value.today);
    anchor=target;period=heatMode==='week'?'week':'day';
    focusedBucket=heatMode==='hour'||(selected&&selected.from===selected.to)?{from:target,to:target,label:target}:null;
    changeTab('details');
  });
  for(const [id,step]of [['previous',-1],['next',1]])$(id).addEventListener('click',()=>{focusedBucket=null;anchor=period==='day'?month(anchor,step):period==='week'?add(anchor,step*84):month(anchor,step*12);renderChart();});
  const languagePicker=language.mountLanguagePicker({button:$('locale'),label:$('locale-label'),parent:dialog,choose:onLanguage});
  $('refresh').addEventListener('click',async()=>{
    if(busy||disposed)return;busy=true;const button=$('refresh'),turn=600,started=performance.now();button.disabled=true;button.setAttribute('aria-busy','true');
    refreshMotion=button.querySelector('svg').animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:turn,iterations:Infinity});
    try{await onRefresh();}
    catch{if(!disposed){text('alert',w('暂时无法刷新，请稍后重试','Refresh unavailable. Try again shortly.','暫時無法重新整理，請稍後重試'));$('alert').hidden=false;}}
    finally{
      if(!disposed){const elapsed=performance.now()-started,remaining=Math.max(turn,Math.ceil(elapsed/turn)*turn)-elapsed;
        await new Promise(resolve=>{finishRefresh=resolve;refreshDelay=setTimeout(resolve,Math.max(0,remaining));});}
      clearTimeout(refreshDelay);refreshDelay=null;finishRefresh=null;refreshMotion?.cancel();refreshMotion=null;busy=false;
      if(!disposed){button.disabled=false;button.setAttribute('aria-busy','false');}
    }
  });
  function present(){
    if(dialog.matches(':popover-open'))return;
    dialog.removeAttribute('open');dialog.showPopover();dialog.setAttribute('open','');
    $('locale').focus({preventScroll:true});
  }
  function conceal(){
    if(dialog.matches(':popover-open'))dialog.hidePopover();dialog.removeAttribute('open');
  }
  function close(){languagePicker.close(false);closeYear(false);clearHover();conceal();opener?.focus({preventScroll:true});}
  $('close').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
  const weeklyQuotaSig=data=>{const qw=data?.quotaWindows;if(!qw||typeof qw!=='object')return '';return Object.entries(qw).filter(([k])=>k.endsWith(':weekly')).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`${k}:${Math.round(v?.estimatedFullTokens||0)}:${Math.round((v?.estimatedFullUsd||0)*100)}`).join('|');};
  const contentKey=data=>JSON.stringify([{...data,updatedAt:undefined,quotaWindows:undefined,activeAccountKey:undefined,status:undefined,summaryStale:undefined},weeklyQuotaSig(data),language.language,themeSignature(),typeof onScope==='function',pendingScope,scopeLoading]);
  const within=event=>event.composedPath().includes(dialog);
  function containFocus(event){if(!disposed&&dialog.open&&!within(event)){$('locale').focus({preventScroll:true});}}
  function containKeys(event){
    if(disposed||!dialog.open)return;
    if(event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();
      if($('year-menu').matches(':popover-open'))closeYear();else close();return;
    }
    if(event.key!=='Tab')return;
    if($('year-menu').matches(':popover-open'))closeYear(false);
    const controls=[...view.querySelectorAll('button,input,select,a[href],[tabindex]')].filter(n=>n.tabIndex>=0&&!n.disabled&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
    if(!controls.length){event.preventDefault();return;}
    const index=controls.indexOf(view.activeElement);
    if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===controls.length-1){
      event.preventDefault();event.stopImmediatePropagation();(event.shiftKey?controls.at(-1):controls[0]).focus({preventScroll:true});
    }
  }
  function containScroll(event){if(!disposed&&dialog.open&&!within(event))event.preventDefault();}
  function containPointer(event){
    if(disposed||!dialog.open)return;
    const r=dialog.getBoundingClientRect();
    const backdropHit=event.composedPath()[0]===dialog;
    if(!within(event)||backdropHit&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)){event.preventDefault();event.stopImmediatePropagation();if(event.type==='click')close();}
  }
  document.addEventListener('focusin',containFocus,true);document.addEventListener('keydown',containKeys,true);
  document.addEventListener('wheel',containScroll,{capture:true,passive:false});document.addEventListener('touchmove',containScroll,{capture:true,passive:false});
  for(const type of ['pointerdown','mousedown','click'])document.addEventListener(type,containPointer,true);
  const themeObserver=new MutationObserver(()=>{if(!disposed&&value&&dialog.open){const key=contentKey(value);if(key!==lastKey){lastKey=key;render({preserveHover:true});}}});
  if(root.host)themeObserver.observe(root.host,{attributes:true,attributeFilter:['data-pulse-theme','style']});
  return {
    open(data,trigger){
      if(!data||disposed)return;
      if(data.scope==='local'||data.scope==='account')scopeCache.set(data.scope,data);
      pendingScope=null;scopeLoading=false;delete page.dataset.scopeLoading;
      accountKey=data.accountKey;value=data;opener=trigger;selectedDay||=data.today;year||=data.today.slice(0,4);anchor||=data.today;
      syncModels();
      disabledModels.clear();for(const m of userDismissedModels)disabledModels.add(m);focusedBucket=null;
      lastKey=contentKey(data);clearHover();lastScrollTop=0;$('page-body').scrollTop=0;render();present();
    },
    update(data){
      if(disposed)return;
      if(!data){if(!value)return;value=null;lastKey='';if(dialog.open)render();return;}
      if(data.scope==='local'||data.scope==='account')scopeCache.set(data.scope,data);
      if(pendingScope){
        if(data.scope!==pendingScope)return;
        const wasLoading=scopeLoading;
        pendingScope=null;scopeLoading=false;delete page.dataset.scopeLoading;
        if(accountKey&&accountKey!==data.accountKey){selected=null;selectedDay=data.today;focusedBucket=null;disabledModels.clear();for(const m of userDismissedModels)disabledModels.add(m);year=data.today.slice(0,4);anchor=data.today;}
        accountKey=data.accountKey;value=data;if(!dialog.open)return;lastKey=contentKey(data);render();
        if(wasLoading)animateScopeChange();
        return;
      }
      const accountChanged=Boolean(accountKey&&accountKey!==data.accountKey);
      if(accountChanged){selected=null;selectedDay=data.today;focusedBucket=null;disabledModels.clear();for(const m of userDismissedModels)disabledModels.add(m);year=data.today.slice(0,4);anchor=data.today;}
      accountKey=data.accountKey;value=data;if(!dialog.open)return;const key=contentKey(data);if(key===lastKey)return;lastKey=key;render({preserveHover:!accountChanged});
    },
    restoreModal(){if(!disposed&&dialog.open&&dialog.isConnected&&!dialog.matches(':popover-open')){const top=lastScrollTop;closeYear(false);present();if(top>0)$('page-body').scrollTop=top;}},
    close,syncGuideDismissed(){if(!replayGuide)dismissGuide();},dispose(){disposed=true;languagePicker.dispose();themeObserver.disconnect();clearTimeout(refreshDelay);finishRefresh?.();refreshMotion?.cancel();for(const anim of scopeAnimations)anim.cancel();scopeAnimations=[];closeYear(false);window.removeEventListener('resize',positionYear);document.removeEventListener('focusin',containFocus,true);document.removeEventListener('keydown',containKeys,true);document.removeEventListener('wheel',containScroll,true);document.removeEventListener('touchmove',containScroll,true);for(const type of ['pointerdown','mousedown','click'])document.removeEventListener(type,containPointer,true);conceal();dialog.remove();backdrop.remove();},get isOpen(){return dialog.open;}};
};
