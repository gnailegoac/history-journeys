// 一个很小的假 DOM，只够 React、题签层和沙盘的替身用。有了它，沙盘栏和整个版面可以在 Node 里跑，不用开浏览器
// （这台开发机没有显卡，浏览器测试很慢）。它不排版：位置、大小都是假的，版面和样式仍然要靠浏览器测试（tests/e2e）。
// 只给 tests/unit/page/ 里的测试用；这里图省事用了 any。
type Listener = (event: any) => void;

export class MiniNode {
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  ownerDocument!: MiniDocument;
  nodeType = 1;
  nodeName = '';
  listeners = new Map<string, Set<Listener>>();

  appendChild(child: MiniNode) {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child: MiniNode, ref: MiniNode | null) {
    if (!ref) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    const at = this.childNodes.indexOf(ref);
    if (at < 0) throw new Error('insertBefore: ref not found');
    this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: MiniNode) {
    const at = this.childNodes.indexOf(child);
    if (at < 0) throw new Error('removeChild: not a child');
    this.childNodes.splice(at, 1);
    child.parentNode = null;
    // 和浏览器一样：带着焦点的东西从页面上拿走了，焦点就没有了。
    const doc = this.ownerDocument as MiniDocument | undefined;
    if (doc?.activeElement && child.contains(doc.activeElement)) doc.activeElement = null;
    return child;
  }
  append(...nodes: MiniNode[]) {
    nodes.forEach((n) => this.appendChild(n));
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  replaceChildren(...nodes: MiniNode[]) {
    [...this.childNodes].forEach((c) => this.removeChild(c));
    this.append(...nodes);
  }
  /** 上一层的元素（上一层是整个文档的时候没有）。 */
  get parentElement(): MiniElement | null {
    return this.parentNode instanceof MiniElement && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling() {
    const s = this.parentNode?.childNodes ?? [];
    return s[s.indexOf(this) + 1] ?? null;
  }
  get previousSibling() {
    const s = this.parentNode?.childNodes ?? [];
    return s[s.indexOf(this) - 1] ?? null;
  }
  contains(other: MiniNode | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    [...this.childNodes].forEach((c) => this.removeChild(c));
    if (value !== '' && value != null) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatchEvent(event: any) {
    event.target = this;
    for (let n: MiniNode | null = this; n; n = n.parentNode) {
      event.currentTarget = n;
      [...(n.listeners.get(event.type) ?? [])].forEach((l) => l(event));
    }
    return true;
  }
}

export class MiniText extends MiniNode {
  nodeType = 3;
  nodeName = '#text';
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(v: string) {
    this.data = v;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v: string) {
    this.data = v;
  }
}

function makeStyle(): any {
  const store: Record<string, string> = {};
  return new Proxy(store, {
    get(target, key: string) {
      if (key === 'setProperty') return (name: string, value: string) => void (target[name] = value);
      if (key === 'removeProperty') return (name: string) => void delete target[name];
      if (key === 'getPropertyValue') return (name: string) => target[name] ?? '';
      return target[key] ?? '';
    },
    set(target, key: string, value: string) {
      if (key === 'cssText') {
        Object.keys(target).forEach((k) => delete target[k]);
        String(value)
          .split(';')
          .forEach((part) => {
            const at = part.indexOf(':');
            if (at > 0) {
              const name = part
                .slice(0, at)
                .trim()
                .replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
              target[name] = part.slice(at + 1).trim();
            }
          });
      } else if (value === '' || value == null) delete target[key];
      else target[key] = String(value);
      return true;
    },
  });
}

export class MiniElement extends MiniNode {
  tagName: string;
  namespaceURI: string;
  attributes = new Map<string, string>();
  style = makeStyle();
  box = { width: 800, height: 600 };
  constructor(tag: string, ns = 'http://www.w3.org/1999/xhtml') {
    super();
    this.namespaceURI = ns;
    this.tagName = ns.endsWith('xhtml') ? tag.toUpperCase() : tag;
    this.nodeName = this.tagName;
  }
  get localName() {
    return this.tagName.toLowerCase();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string) {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  /** 只有页面用到的两样：有没有这个类名；挂上或者拿掉一个类名。 */
  get classList() {
    const names = () => this.className.split(' ').filter((name) => name !== '');
    return {
      contains: (name: string) => names().includes(name),
      toggle: (name: string, on: boolean) => {
        const rest = names().filter((item) => item !== name);
        this.className = (on ? [...rest, name] : rest).join(' ');
        return on;
      },
    };
  }
  get type() {
    return this.getAttribute('type') ?? '';
  }
  set type(v: string) {
    this.setAttribute('type', v);
  }
  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }
  get dataset(): Record<string, string> {
    const toAttr = (key: string) => 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    return new Proxy(
      {},
      {
        get: (_t, key: string) => this.getAttribute(toAttr(key)) ?? undefined,
        set: (_t, key: string, value: string) => {
          this.setAttribute(toAttr(key), value);
          return true;
        },
      },
    ) as Record<string, string>;
  }
  get offsetWidth() {
    return this.className === 'strip' ? 30 : this.box.width;
  }
  get offsetHeight() {
    return this.className === 'strip' ? 20 * this.textContent.length + 16 : this.box.height;
  }
  get clientWidth() {
    return this.box.width;
  }
  get clientHeight() {
    return this.box.height;
  }
  getBoundingClientRect() {
    const cls = this.className;
    const section = this.getAttribute('data-section');
    if (section !== null && cls.includes('text-section')) return rect(0, (globalThis as any).__sectionTops?.[section] ?? 9999, 400, 300);
    if (cls.includes('stage-pane')) return rect(480, 0, 800, 600);
    if (cls.includes('stop-page')) return rect(0, 0, 440, 5000);
    if (cls.includes('stage-controls')) return rect(8, 8, 784, 44);
    // 按钮下面的那一行话：紧贴在按钮下面，30 像素高。
    if (cls.includes('stage-notice') && !cls.includes('stage-notice-button')) return rect(0, 52, 800, 30);
    if (cls.includes('stage-foot')) return rect(0, 500, 800, 100);
    return rect(0, 0, this.box.width, this.box.height);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  /** 自己或者往上最近的一个对得上 selector 的元素（selector 只能是一段，不带空格）。 */
  closest(selector: string): MiniElement | null {
    for (let n: MiniNode | null = this; n; n = n.parentNode) {
      if (n instanceof MiniElement && n.nodeType === 1 && matchCompound(n, selector)) return n;
    }
    return null;
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', bubbles: true, button: 0, preventDefault() {}, stopPropagation() {} });
  }
  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    const parts = selector.trim().split(/\s+/);
    const walk = (node: MiniNode) => {
      for (const child of node.childNodes) {
        if (child instanceof MiniElement) {
          if (matchChain(child, parts, this)) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

function matchCompound(el: MiniElement, compound: string): boolean {
  const tokens = compound.match(/(\.[\w-]+|\[[^\]]+\]|^[\w-]+)/g) ?? [];
  return tokens.every((token) => {
    if (token.startsWith('.')) return el.className.split(/\s+/).includes(token.slice(1));
    if (token.startsWith('[')) {
      const m = token.slice(1, -1).match(/^([\w-]+)(?:="?([^"]*)"?)?$/)!;
      return m[2] === undefined ? el.hasAttribute(m[1]) : el.getAttribute(m[1]) === m[2];
    }
    return el.localName === token.toLowerCase();
  });
}

function matchChain(el: MiniElement, parts: string[], root: MiniNode): boolean {
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let n = el.parentNode; n && n !== root && i >= 0; n = n.parentNode) {
    if (n instanceof MiniElement && matchCompound(n, parts[i])) i -= 1;
  }
  return i < 0;
}

export class MiniDocument extends MiniElement {
  nodeType = 9;
  body: MiniElement;
  documentElement: MiniElement;
  activeElement: MiniElement | null = null;
  defaultView: any;
  constructor() {
    super('#document');
    this.nodeName = '#document';
    this.ownerDocument = this;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    (this.documentElement as any).scrollHeight = 100000;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) {
    const el = new MiniElement(tag);
    el.ownerDocument = this;
    return el;
  }
  createElementNS(ns: string, tag: string) {
    const el = new MiniElement(tag, ns);
    el.ownerDocument = this;
    return el;
  }
  createTextNode(data: string) {
    const t = new MiniText(data);
    t.ownerDocument = this;
    return t;
  }
  createComment(data: string) {
    const t = new MiniText(data);
    t.nodeType = 8;
    t.nodeName = '#comment';
    t.ownerDocument = this;
    return t;
  }
}

/** 装上假的 window 和 document。search 是地址里的参数。 */
export function installMiniDom(search: string): MiniDocument {
  const doc = new MiniDocument();
  const g = globalThis as any;
  const win: any = {
    document: doc,
    location: { search, hash: '' },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms),
    clearInterval: (id: any) => clearInterval(id),
    // 测试要“系统设置了减少动态效果”“窗口是宽屏”时，把这个函数换掉。
    // 页面听着“这一句从真变假、从假变真”的（版面换了排法）记在 mediaListeners 里；测试用 fireMedia() 发这一下。
    mediaListeners: new Set<() => void>(),
    matchMedia: (_query: string) => ({
      matches: false,
      addEventListener: (_type: string, listener: () => void) => void win.mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => void win.mediaListeners.delete(listener),
    }),
    fireMedia() {
      [...win.mediaListeners].forEach((listener: () => void) => listener());
    },
    listeners: new Map<string, Set<() => void>>(),
    addEventListener(type: string, listener: () => void) {
      if (!win.listeners.has(type)) win.listeners.set(type, new Set());
      win.listeners.get(type).add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      win.listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      [...(win.listeners.get(type) ?? [])].forEach((listener: () => void) => listener());
    },
    HTMLIFrameElement: class {},
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 0,
  };
  win.window = win;
  doc.defaultView = win;
  g.window = win;
  g.document = doc;
  g.HTMLIFrameElement = win.HTMLIFrameElement;
  g.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0);
  g.cancelAnimationFrame = (id: any) => clearTimeout(id);
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return doc;
}
