import { useState } from 'react';
import { Text, TextInput, View, Pressable } from 'react-native';
import { useSettings, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { SettingsCard, SettingsSection, SettingsSwitch, SettingsSelect } from '@getpaseo/plugin/client/ui';
import { browserSettings, type BrowserSettings } from '../shared/settings';

export function BrowserSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(browserSettings);
  const [draft, setDraft] = useState<{ values: BrowserSettings; revision: string } | null>(null);
  const [providersText, setProvidersText] = useState<string | null>(null);
  const [chromeArgsText, setChromeArgsText] = useState<string | null>(null);
  const foreground = { color: theme.colors.foreground };
  if (settings.status !== 'ready') return <View style={{ gap: 12 }}>
    <Text style={foreground}>{settings.status === 'loading' ? 'Loading Chrome settings…' : `Cannot read Chrome settings: ${String(settings.error)}`}</Text>
    {settings.status !== 'loading' && <>
      <Pressable accessibilityRole="button" onPress={() => { void settings.reload(); }}><Text style={foreground}>Retry</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { void settings.reset(); }}><Text style={foreground}>Reset Chrome settings</Text></Pressable>
    </>}
  </View>;
  const values = draft?.values ?? settings.values;
  const update = (patch: Partial<BrowserSettings>) => setDraft({ values: { ...values, ...patch }, revision: draft?.revision ?? settings.revision });
  const field = (label: string, value: string, onChangeText: (value: string) => void, multiline = false) => (
    <View style={{ gap: 6 }}>
      <Text style={foreground}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline} autoCapitalize="none" style={{ ...foreground, borderWidth: 1, borderColor: theme.colors.foregroundMuted, borderRadius: 6, padding: 10 }} />
    </View>
  );
  return <View style={{ gap: 16 }}>
    <Text style={foreground}>Chrome tools for agents: pages, clicks, forms, screenshots, JavaScript, network, console and performance.</Text>
    <SettingsSection title="Connection"><SettingsCard>
      <SettingsSwitch label="Enable Chrome tools" value={values.enabled} onValueChange={(enabled) => update({ enabled })} />
      <SettingsSelect label="Browser mode" value={values.mode} options={[
        { label: 'Shared workspace browser', value: 'workspace' },
        { label: 'Separate Chrome per agent', value: 'isolated' },
        { label: 'My running Chrome (144+)', value: 'autoConnect' },
        { label: 'Chrome debugging endpoint', value: 'endpoint' },
      ]} onValueChange={(mode) => update({ mode: mode as BrowserSettings['mode'] })} />
      {values.mode === 'isolated' && <SettingsSwitch label="Headless" value={values.headless} onValueChange={(headless) => update({ headless })} />}
    </SettingsCard></SettingsSection>
    {values.mode === 'isolated' && field('Chrome executable (empty = automatic)', values.executablePath, (executablePath) => update({ executablePath }))}
    {values.mode === 'workspace' && <Text style={foreground}>One browser per workspace, visible in the Workspace Browser panel on desktop and mobile. Logins persist. Take and release control to hand the browser between humans and agents.</Text>}
    {values.mode === 'endpoint' && field('Chrome debugging URL', values.browserUrl, (browserUrl) => update({ browserUrl }))}
    {values.mode === 'autoConnect' && <Text style={foreground}>Enable remote debugging at chrome://inspect/#remote-debugging in Chrome 144 or newer, then approve Chrome’s connection prompt. Agents can access your existing tabs and signed-in sites.</Text>}
    {values.mode === 'endpoint' && <Text style={foreground}>Connects to a Chrome started with remote debugging. Agents share its tabs and signed-in sites.</Text>}
    {field('Providers (comma separated)', providersText ?? values.providers.join(', '), (text) => { setProvidersText(text); update({ providers: text.split(',').map((part) => part.trim()).filter(Boolean) }); })}
    {values.mode === 'isolated' && field('Additional Chrome arguments (one per line)', chromeArgsText ?? values.chromeArgs.join('\n'), (text) => { setChromeArgsText(text); update({ chromeArgs: text.split('\n').filter(Boolean) }); }, true)}
    <Text style={{ color: theme.colors.foregroundMuted }}>Save, then reload the plugin to apply changes to existing agent sessions on their next idle prompt. Running turns continue. Google MCP usage statistics and CrUX URL reporting are disabled.</Text>
    {settings.saveError && <Text style={foreground}>{String(settings.saveError)}</Text>}
    <Pressable accessibilityRole="button" disabled={settings.saving} onPress={async () => {
      if (await settings.save(values, draft?.revision ?? settings.revision)) {
        setDraft(null); setProvidersText(null); setChromeArgsText(null);
      }
    }} style={{ backgroundColor: theme.colors.accent, borderRadius: 8, padding: 12 }}>
      <Text style={{ color: theme.colors.accentForeground }}>{settings.saving ? 'Saving…' : 'Save settings'}</Text>
    </Pressable>
  </View>;
}
