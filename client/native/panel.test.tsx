import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  slots: [] as any[], index: 0, effects: [] as (() => void)[],
  controller: null as string | null,
  watch: vi.fn(), control: vi.fn(), action: vi.fn(),
  reset: vi.fn(), receive: vi.fn(), discard: vi.fn(),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const changed = (a: unknown[] | undefined, b: unknown[]) =>
    !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const i = fixture.index++;
    if (!fixture.slots[i] || changed(fixture.slots[i].deps, deps))
      fixture.slots[i] = { value: fn(), deps };
    return fixture.slots[i].value;
  };
  return { ...actual,
    useMemo: memo, useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
    useRef: (initial: unknown) => {
      const i = fixture.index++;
      fixture.slots[i] ??= { current: initial };
      return fixture.slots[i];
    },
    useState: (initial: unknown) => {
      const i = fixture.index++;
      if (!fixture.slots[i]) fixture.slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [fixture.slots[i].value, (value: unknown) => {
        fixture.slots[i].value = typeof value === "function" ? value(fixture.slots[i].value) : value;
      }];
    },
    useEffect: (effect: () => void, deps: unknown[]) => {
      const i = fixture.index++;
      if (!fixture.slots[i] || changed(fixture.slots[i].deps, deps)) {
        fixture.slots[i] = { deps };
        fixture.effects.push(effect);
      }
    },
  };
});
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", ScrollView: "ScrollView",
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useTabState: () => [{ url: "about:blank" }, () => {}],
  useRpc: (contract: {name: string}) => ({
    "native.watch": fixture.watch, "native.control": fixture.control, "native.action": fixture.action,
  })[contract.name],
}));
vi.mock("../workspace/web", () => ({ nativeDesktopBrowserApi: () => null, nativeTouchPoint: () => null }));
vi.mock("../workspace/browser-frame-image", () => ({ BrowserFrameImage: () => null }));
vi.mock("../workspace/use-browser-frame-buffer", () => ({
  useBrowserFrameBuffer: () => ({
    buffer: {layers:[],front:null}, frame:null, receive:fixture.receive, reset:fixture.reset,
    settled:() => {}, discardObsoletePending:fixture.discard,
  }),
}));
import { NativeBrowserPanel } from "./panel";

let tree: any;
const props = { workspaceId:"workspace", tab:{}, theme:{colors:{}}, layout:{compact:true} } as any;
function render() {
  fixture.index = 0; fixture.effects = [];
  tree = NativeBrowserPanel(props);
  for (const effect of fixture.effects) effect();
}
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node?.props ? [node, ...nodes(node.props.children)] : [];
}
const find = (test: (props: any) => boolean) => nodes(tree).find(node => test(node.props))?.props;
const address = () => find(p => p.accessibilityLabel === "Native browser address");
const go = () => find(p => p.accessibilityLabel === "Open website");
const alert = () => find(p => p.accessibilityRole === "alert")?.children;
async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  render();
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); fixture.slots = []; fixture.controller = null;
  fixture.watch.mockImplementation(async () => ({
    connected:true, controller:fixture.controller, frame:null, error:null,
    state:{ browserId:"browser",url:"about:blank",title:"about:blank",generation:1 },
  }));
  fixture.control.mockImplementation(async ({viewerId,action}) => {
    fixture.controller = action === "acquire" ? viewerId : null;
    return {controller:fixture.controller};
  });
  fixture.action.mockResolvedValue({});
  render(); await tick();
});
afterEach(() => vi.useRealTimers());

it("shows a truly empty tab and explains why navigation is disabled", () => {
  expect(address().value).toBe("");
  expect(address().placeholder).toBe("Enter website address");
  expect(go().disabled).toBe(true);
  expect(find(p => p.children === "No website open")).toBeDefined();
  expect(find(p => p.children === "Take control to open a website or interact with this tab.")).toBeDefined();
});

it("blocks keyboard submission without control and retains the explanation across polls", async () => {
  address().onChangeText("https://example.com"); render();
  address().onSubmitEditing(); render();
  expect(alert()).toContain("Take control");
  await tick(200);
  expect(alert()).toContain("Take control");
  expect(fixture.action).not.toHaveBeenCalled();
});

it("enables Go after taking control and keeps navigation errors visible during healthy polling", async () => {
  find(p => p.children?.props?.children === "Take control").onPress(); await tick();
  expect(go().disabled).toBe(true);
  address().onChangeText("https://example.com"); render();
  expect(go().disabled).toBe(false);
  fixture.action.mockRejectedValueOnce(new Error("Navigation failed"));
  go().onPress(); await tick();
  expect(alert()).toContain("Navigation failed");
  await tick(200);
  expect(alert()).toContain("Navigation failed");
  expect(fixture.action).toHaveBeenCalledTimes(1);
});
