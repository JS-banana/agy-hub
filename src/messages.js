// @ts-check

const en = {
  context: 'Context', usage: 'Usage', weekly: 'Weekly', memory: 'Approx RAM', cache: 'Cache',
  cacheHit: 'Cache hit', rules: 'rules', hooks: 'hooks', cost: 'Cost', today: 'Today', week: 'Week',
  tokens: 'Tokens', start: 'Started', reply: 'Last reply', limit: 'Limit reached',
  input: 'in', cacheTokens: 'cache', output: 'out', resets: 'resets', resetsIn: 'resets in', left: 'left',
  elapsed: '% elapsed', tools: 'Tool use', tasks: 'Background tasks', artifacts: 'Artifacts',
};

const hans = {
  context: '上下文', usage: '用量', weekly: '本周', memory: '内存', cache: '缓存',
  cacheHit: '缓存命中', rules: '规则', hooks: '钩子', cost: '费用', today: '今日', week: '本周',
  tokens: '词元', start: '开始', reply: '上次回复', limit: '已达上限',
  input: '输入', cacheTokens: '缓存', output: '输出', resets: '重置于', resetsIn: '重置剩余', left: '剩余',
  elapsed: '% 已过', tools: '调用工具', tasks: '后台任务', artifacts: '产物',
};

const hant = {
  ...hans, weekly: '本週', memory: '記憶體', cache: '快取', cacheHit: '快取命中', rules: '規則', hooks: 'Hook',
  cost: '費用', week: '本週', tokens: 'Token', start: '開始', reply: '上次回覆', limit: '已達上限',
  input: '輸入', cacheTokens: '快取', output: '輸出', resets: '重置於', resetsIn: '重置剩餘',
  left: '剩餘', elapsed: '% 已過', tasks: '背景任務', artifacts: '產物',
};

/** @param {import('./config-schema.js').HudConfig['language']} language */
export const messages = (language) => language === 'en' ? en : { 'zh-Hans': hans, 'zh-Hant': hant }[language];
