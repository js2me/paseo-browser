import React, {useState} from 'react';
import {NativeDesktopService} from '../../client/native/desktop-service';
import { createRoot } from 'react-dom/client';
import { NativeBrowserPanel } from '../../client/native/panel';
const colors={surface0:'#111827',surface1:'#1f2937',surface2:'#374151',foreground:'#f9fafb',foregroundMuted:'#9ca3af',accent:'#60a5fa',accentForeground:'#111827',border:'#374151',statusDanger:'#ef4444'};
const service=new NativeDesktopService({rpc:async(contract,input)=>{const response=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:contract.name,input:contract.input.parse(input)})});const result=await response.json();if(!response.ok)throw Error(result.error);return contract.output.parse(result);}});
function App(){const[visible,setVisible]=useState(true);globalThis.nativeTestHide=()=>setVisible(false);return visible?<NativeBrowserPanel service={service} workspaceId="native-test" host={{id:'test',label:'Test'}} theme={{colors}} layout={{compact:innerWidth<600,platform:'web'}} tab={{}}/>:<div>Desktop pane parked</div>;}
createRoot(document.getElementById('root')).render(<App/>);
