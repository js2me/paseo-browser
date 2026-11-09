import { expect, it, vi } from 'vitest';
import { createBrowserPanelAutoOpen } from './auto-open';

it('opens once for a visible browser, respects dismissal, and rearms when that browser closes', () => {
  const open = vi.fn();
  const auto = createBrowserPanelAutoOpen(open);
  auto.presence(['background', 'visible']);
  expect(open).not.toHaveBeenCalled();
  auto.reveal('visible', true);
  auto.reveal('visible', true);
  expect(open.mock.calls).toEqual([['visible']]);
  auto.presence(['background', 'visible']);
  auto.reveal('visible', true);
  expect(open).toHaveBeenCalledTimes(1);
  auto.presence(['background']);
  auto.presence(['background', 'visible']);
  auto.reveal('visible', true);
  expect(open).toHaveBeenCalledTimes(2);
  auto.dispose();
  auto.reveal('background', true);
  expect(open).toHaveBeenCalledTimes(2);
});

it('allows a later attempt after the host refuses an opening and preserves independent workspace state', () => {
  const open = vi.fn().mockImplementationOnce(() => { throw new Error('Host unavailable'); });
  const auto = createBrowserPanelAutoOpen(open);
  expect(() => auto.reveal('first', true)).toThrow('Host unavailable');
  auto.reveal('first', true);
  auto.reveal('second', false);
  auto.reveal('second', true);
  auto.reveal('first', true);
  expect(open.mock.calls).toEqual([['first'], ['first'], ['second']]);
});
