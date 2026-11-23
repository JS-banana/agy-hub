// @ts-check
import { createInterface } from 'node:readline';

/** @typedef {import('./config-schema.js').HudConfig} HudConfig */
/**
 * @typedef {{
 *   lineLayout?: HudConfig['lineLayout'],
 *   display?: Partial<Pick<HudConfig['display'], 'showTools' | 'showAgents'>>,
 *   gitStatus?: Partial<Pick<HudConfig['gitStatus'], 'enabled' | 'showFileStats'>>
 * }} SetupPatch
 */
/**
 * @typedef {{
 *   config: HudConfig,
 *   configureOnly?: boolean,
 *   customStatusline?: boolean,
 *   preview: (patch: SetupPatch) => string | Promise<string>,
 *   input?: NodeJS.ReadableStream,
 *   output?: NodeJS.WritableStream
 * }} SetupOptions
 */

const copy = {
  en: {
    title: 'AGY Hub setup',
    layout: { expanded: 'Expanded', compact: 'Compact' },
    layoutPrompt: 'Layout [Enter to keep]: ',
    features: ['Tool activity', 'Subagents', 'Git file stats'],
    featuresPrompt: 'Toggle features by number (e.g. 1,3). Enter keeps the current choices: ',
    current: 'current',
    cancelHint: 'Type q at any prompt to cancel.',
    invalid: 'Choose one of the displayed options.',
    previewTitle: 'Sample preview',
    saveOnly: 'Save these settings? [y/N] ',
    saveInstall: 'Save these settings and enable AGY Hub? [y/N] ',
    replace: 'Setup will replace your custom agy statusline and save it for agy-hub uninstall.',
    cancelled: 'Setup canceled.',
  },
  'zh-Hans': {
    title: 'AGY Hub 设置',
    layout: { expanded: '展开', compact: '紧凑' },
    layoutPrompt: '选择布局，直接 Enter 保留：',
    features: ['工具活动', '子代理', 'Git 变更统计'],
    featuresPrompt: '输入编号切换功能，例如 1,3。直接 Enter 保留当前选项：',
    current: '当前',
    cancelHint: '随时输入 q 取消。',
    invalid: '请输入列表中的选项。',
    previewTitle: '示例预览',
    saveOnly: '保存这些设置？[y/N] ',
    saveInstall: '保存这些设置并启用 AGY Hub？[y/N] ',
    replace: '这会替换你当前的自定义 agy 状态栏并保存备份，可用 agy-hub uninstall 恢复。',
    cancelled: '设置已取消。',
  },
  'zh-Hant': {
    title: 'AGY Hub 設定',
    layout: { expanded: '展開', compact: '緊湊' },
    layoutPrompt: '選擇版面，直接 Enter 保留：',
    features: ['工具活動', '子代理', 'Git 變更統計'],
    featuresPrompt: '輸入編號切換功能，例如 1,3。直接 Enter 保留目前選項：',
    current: '目前',
    cancelHint: '隨時輸入 q 取消。',
    invalid: '請輸入清單中的選項。',
    previewTitle: '範例預覽',
    saveOnly: '儲存這些設定？[y/N] ',
    saveInstall: '儲存這些設定並啟用 AGY Hub？[y/N] ',
    replace: '這會替換你目前的自訂 agy 狀態列並儲存備份，可用 agy-hub uninstall 恢復。',
    cancelled: '設定已取消。',
  },
};

/** @param {string} value */
function confirmation(value) {
  if (['y', 'yes', '是'].includes(value)) return true;
  if (['', 'n', 'no', '否'].includes(value)) return false;
  return undefined;
}

/** @param {string} value @returns {Set<string> | undefined} */
function featureNumbers(value) {
  if (!value) return new Set();
  const numbers = value.split(/[\s,，、]+/);
  return numbers.every((number) => /^[1-3]$/.test(number)) ? new Set(numbers) : undefined;
}

/**
 * Collect an opt-in configuration patch. The caller applies it after the
 * readline interface is closed and its input has returned to normal mode.
 * @param {SetupOptions} options
 * @returns {Promise<SetupPatch | null>}
 */
export async function setupWizard({
  config, configureOnly = false, customStatusline = false, preview, input = process.stdin, output = process.stdout,
}) {
  const text = copy[config.language] ?? copy.en;
  const terminal = 'isTTY' in input && Boolean(input.isTTY) && 'isTTY' in output && Boolean(output.isTTY);
  const reader = createInterface({ input, output, terminal, crlfDelay: Infinity, historySize: 0 });
  const lines = reader[Symbol.asyncIterator]();
  let interrupted = false;
  let closed = false;
  reader.on('close', () => { closed = true; });
  reader.on('SIGINT', () => {
    interrupted = true;
    reader.close();
  });

  /**
   * @template T
   * @param {string} prompt
   * @param {(answer: string) => T | undefined} parse
   * @returns {Promise<T | null>}
   */
  async function choose(prompt, parse) {
    while (!interrupted) {
      if (terminal && !closed) {
        reader.setPrompt(prompt);
        reader.prompt();
      } else if (!terminal) output.write(prompt);
      const next = await lines.next();
      if (interrupted || next.done) break;
      const answer = next.value.trim().toLowerCase();
      if (['q', 'quit', '取消'].includes(answer)) break;
      const value = parse(answer);
      if (value !== undefined) return value;
      output.write(text.invalid + '\n');
    }
    output.write(text.cancelled + '\n');
    return null;
  }

  try {
    output.write(text.title + '\n' + text.cancelHint + '\n\n');
    const layouts = /** @type {const} */ (['expanded', 'compact']);
    for (const [index, layout] of layouts.entries()) {
      const marker = config.lineLayout === layout ? ' (' + text.current + ')' : '';
      output.write('  ' + (index + 1) + '. ' + text.layout[layout] + marker + '\n');
    }
    const layout = await choose(text.layoutPrompt, (answer) => {
      if (answer === '') return config.lineLayout;
      if (answer === '1') return 'expanded';
      if (answer === '2') return 'compact';
      return undefined;
    });
    if (layout === null) return null;

    const visible = (/** @type {'tools' | 'agents'} */ row) => layout === 'compact' || config.elementOrder.includes(row);
    const enabled = [
      config.display.showTools && visible('tools'),
      config.display.showAgents && visible('agents'),
      config.gitStatus.enabled && config.gitStatus.showFileStats,
    ];
    output.write('\n');
    for (const [index, feature] of text.features.entries()) {
      output.write('  ' + (index + 1) + (enabled[index] ? '. [x] ' : '. [ ] ') + feature + '\n');
    }
    const toggles = await choose(text.featuresPrompt, featureNumbers);
    if (toggles === null) return null;

    /** @type {SetupPatch} */
    const patch = layout === config.lineLayout ? {} : { lineLayout: layout };
    if (toggles.has('1') || toggles.has('2')) {
      patch.display = {
        ...(toggles.has('1') ? { showTools: !enabled[0] } : {}),
        ...(toggles.has('2') ? { showAgents: !enabled[1] } : {}),
      };
    }
    if (toggles.has('3')) {
      const showFileStats = !enabled[2];
      patch.gitStatus = {
        showFileStats, ...(showFileStats && !config.gitStatus.enabled ? { enabled: true } : {}),
      };
    }

    const frame = await preview(patch);
    output.write('\n' + text.previewTitle + '\n' + frame + (frame.endsWith('\n') ? '\n' : '\n\n'));
    if (customStatusline && !configureOnly) output.write(text.replace + '\n');
    const accepted = await choose(configureOnly ? text.saveOnly : text.saveInstall, confirmation);
    if (accepted === false) output.write(text.cancelled + '\n');
    return accepted ? patch : null;
  } finally {
    reader.close();
  }
}
