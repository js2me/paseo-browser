import type { PluginButtonIconProps } from '@getpaseo/plugin/client';
import { Icon } from '@getpaseo/plugin/client/ui';

/** Rendering a header or composer icon must not open panels or request a browser. */
export function createBrowserHeaderIcon() {
  return function BrowserHeaderIcon({ size, color }: PluginButtonIconProps) {
    return <Icon name="PanelsTopLeft" size={size} color={color} />;
  };
}
