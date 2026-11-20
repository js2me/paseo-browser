import React from 'react';
import { View } from 'react-native';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SharedBrowserPanel } from '../../client/workspace/browser';
const compact = innerWidth < 600;
const dark = new URLSearchParams(location.search).get('theme') !== 'light';
const colors = dark ? { surface0:'#111827',surface1:'#1f2937',surface2:'#374151',foreground:'#f9fafb',foregroundMuted:'#9ca3af',accent:'#60a5fa',accentForeground:'#111827',border:'#374151' } : { surface0:'#ffffff',surface1:'#f3f4f6',surface2:'#e5e7eb',foreground:'#111827',foregroundMuted:'#4b5563',accent:'#2563eb',accentForeground:'#ffffff',border:'#d1d5db' };
Object.assign(colors, {statusDanger:'#ef4444',statusWarning:'#f59e0b',statusSuccess:'#22c55e'});
const query = new QueryClient({ defaultOptions: { queries: { retry:false, refetchOnWindowFocus:false } } });
function App() {
  const props = { theme: {colors}, host: {id:'test-host',label:'Test host'}, layout: {compact,platform:'web'}, workspaceId:'ui-workspace' };
  return <View style={{flex:1, flexDirection:'row', backgroundColor:colors.surface0}}>
    <View style={{flex:1,minWidth:0}}><SharedBrowserPanel {...props} tab={{}} /></View>
  </View>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={query}><App /></QueryClientProvider>);
