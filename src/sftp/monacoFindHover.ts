/** Monaco 0.56 standalone hover defaults to the clipped editor container.
 * Keep this version-specific bridge scoped to find/replace control tooltips. */
const layered = Symbol("find-hover-layer");
interface HoverOptions {
  [layered]?: boolean;
  target: HTMLElement | { targetElements: HTMLElement[] };
  container?: HTMLElement;
  onDidShow?(): void;
  onDidHide?(): void;
  [key: string]: unknown;
}
interface HoverService {
  showDelayedHover(options: HoverOptions, ...args: unknown[]): unknown;
  showInstantHover(options: HoverOptions, ...args: unknown[]): unknown;
  hideHover(force?: boolean): void;
}
let installed = false;
export async function installMonacoFindHoverLayer() {
  if (installed) return;
  const [services, hover] = await Promise.all([
    import('monaco-editor/editor/standalone/browser/standaloneServices.js'),
    // @ts-expect-error Version-specific service identifier, pinned to the bundled Monaco.
    import('monaco-editor/platform/hover/browser/hover.js'),
  ]);
  if (installed) return;
  const service = services.StandaloneServices.get(hover.IHoverService) as unknown as HoverService;
  if (typeof service.showDelayedHover !== "function" || typeof service.showInstantHover !== "function" || typeof service.hideHover !== "function") return;
  function optionsForLayer(options: HoverOptions): HoverOptions {
    if (options[layered]) return options;
    const target = options.target instanceof HTMLElement ? options.target : options.target?.targetElements?.[0];
    if (!target?.closest('.find-widget')) return options;
    const doc = target.ownerDocument, win = doc.defaultView;
    if (!win) return options;
    let timer: ReturnType<typeof setInterval> | undefined;
    const hide = () => service.hideHover(true);
    const cleanup = () => {
      if (timer) clearInterval(timer); timer = undefined;
      win.removeEventListener('scroll', hide, true); win.removeEventListener('resize', hide); win.removeEventListener('blur', hide);
      doc.removeEventListener('keydown', hide, true);
    };
    return { ...options, [layered]: true, container: doc.body,
      onDidShow() {
        cleanup();
        const check = () => { if (!target.isConnected || !target.getClientRects().length || target.closest('[inert],[aria-hidden="true"]') || doc.querySelector('[aria-modal="true"]')) hide(); };
        timer = setInterval(check, 100);
        win.addEventListener('scroll', hide, true); win.addEventListener('resize', hide); win.addEventListener('blur', hide); doc.addEventListener('keydown', hide, true);
        check(); options.onDidShow?.();
      },
      onDidHide() { cleanup(); options.onDidHide?.(); },
    };
  }
  for (const method of ['showDelayedHover', 'showInstantHover'] as const) {
    const original = service[method];
    service[method] = function (options, ...args) { return original.call(this, optionsForLayer(options), ...args); };
  }
  installed = true;
}
