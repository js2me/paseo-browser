import React from 'react';
import { Text, View, TextInput as NativeTextInput } from 'react-native';
export const TextInput = NativeTextInput;
const glyphs = { ArrowLeft: '←', ArrowRight: '→', RotateCw: '↻', Plus: '+', X: '×', Smartphone: '▯', EllipsisVertical: '⋮', Monitor: '▣', MoreVertical: '⋮', ChevronDown: '⌄', MousePointer2: '↗', Lock: '▣', Star: '☆' };
export function Icon({ name, size = 16, color }) { return <Text aria-hidden style={{ width: size, height: size + 2, fontSize: size, color }}>{glyphs[name] ?? '·'}</Text>; }
export function Modal({ open, children }) { return open ? <View style={{ position: 'absolute', inset: 15, zIndex: 1000, padding: 20, backgroundColor: '#333' }}>{children}</View> : null; }
Modal.Content = ({ children }) => <View>{children}</View>;
