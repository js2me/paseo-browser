import type { BrowserSettings } from '../shared/settings';
import runtime from './runtime.json';

export function chromeEntry(): string {
  return runtime.entry;
}

export function browserServer(settings: BrowserSettings, nodePath: string, workspaceRoot?: string) {
  if (settings.mode === 'workspace') throw new Error('Workspace mode uses the shared supervisor MCP adapters');
  const args = [chromeEntry(), '--no-usage-statistics', '--no-performance-crux'];
  if (workspaceRoot) args.push(`--filesystemRoot=${workspaceRoot}`);
  if (settings.mode === 'isolated') {
    args.push('--isolated');
    if (settings.headless) args.push('--headless');
    if (settings.executablePath) args.push(`--executablePath=${settings.executablePath}`);
    for (const arg of settings.chromeArgs) args.push(`--chromeArg=${arg}`);
  } else if (settings.mode === 'autoConnect') {
    args.push('--autoConnect');
  } else {
    args.push(`--browserUrl=${settings.browserUrl}`);
  }
  return {
    type: 'stdio' as const,
    command: nodePath,
    args,
    env: { CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1', CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1' },
  };
}

export function shouldAttach(settings: BrowserSettings, request: {
  provider: string; purpose: string; labels: Record<string, string>;
}) {
  return settings.enabled && request.purpose !== 'history' &&
    settings.providers.includes(request.provider) && request.labels['paseo-browser/enabled'] !== 'false';
}
