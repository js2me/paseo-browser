import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { createBrowserPanelAutoOpen } from '../../client/workspace/auto-open';
import { createBrowserHeaderIcon } from '../../client/workspace/browser-header';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SharedBrowserPanel } from '../../client/workspace/browser';
const compact = innerWidth < 600;
const dark = new URLSearchParams(location.search).get('theme') !== 'light';
const colors = dark ? { surface0:'#111827',surface1:'#1f2937',surface2:'#374151',foreground:'#f9fafb',foregroundMuted:'#9ca3af',accent:'#60a5fa',accentForeground:'#111827',border:'#374151' } : { surface0:'#ffffff',surface1:'#f3f4f6',surface2:'#e5e7eb',foreground:'#111827',foregroundMuted:'#4b5563',accent:'#2563eb',accentForeground:'#ffffff',border:'#d1d5db' };
Object.assign(colors, {statusDanger:'#ef4444',statusWarning:'#f59e0b',statusSuccess:'#22c55e'});
const query = new QueryClient({ defaultOptions: { queries: { retry:false, refetchOnWindowFocus:false } } });
function App() {
  const automatic = new URLSearchParams(location.search).get('auto') === '1';
  const [visible, setVisible] = useState(!automatic);
  const HeaderIcon = useMemo(() => createBrowserHeaderIcon(createBrowserPanelAutoOpen((workspaceId) => {
    if (workspaceId !== 'ui-workspace') throw new Error('Unexpected background workspace');
    setVisible(true);
  })), []);
  const props = { theme: {colors}, host: {id:'test-host',label:'Test host'}, layout: {compact,platform:'web'}, workspaceId:'ui-workspace' };
  return <View style={{flex:1, flexDirection:'row', backgroundColor:colors.surface0}}>
    {automatic && <View style={{flex:1,padding:24,gap:16,...(compact && visible ? {position:'absolute',width:0,height:0,overflow:'hidden',padding:0} : {})}}>
      <Text style={{color:colors.foreground,fontSize:20}}>Agent conversation</Text>
      <Text style={{color:colors.foregroundMuted}}>Open the site in the shared browser.</Text>
      <HeaderIcon {...props} context={compact ? "agent" : "workspace"} agentId={compact ? "test-agent" : undefined} size={20} color={colors.foreground} />
    </View>}
    {visible && <View style={{flex:1,minWidth:0}}><SharedBrowserPanel {...props} tab={{}} /></View>}
  </View>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={query}><App /></QueryClientProvider>);
