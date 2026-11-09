import {expect,it,vi} from 'vitest';
vi.mock('react-native',()=>({Platform:{OS:'web'}}));
import {nativeTouchPoint} from './web';
it('maps real web Pressable mouse coordinates without assuming native locationX/Y',()=>{
 expect(nativeTouchPoint({nativeEvent:{clientX:75,clientY:140}},{getBoundingClientRect:()=>({left:10,top:50})})).toEqual({x:65,y:90});
 expect(nativeTouchPoint({nativeEvent:{}},null)).toBeNull();
});
