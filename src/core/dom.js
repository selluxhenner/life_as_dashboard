// Tiny hyperscript: h('div.panel#id', {onclick, style:{}, dataset:{}, ...attrs}, ...children)
export function h(sel, props, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props); props = {};
  }
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const tag = (m && m[1]) || 'div';
  const isSvg = SVG_TAGS.has(tag);
  const node = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') node.classList.add(part.slice(1)); else node.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) {
      if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv;
    }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'class') node.setAttribute('class', [node.getAttribute('class'), v].filter(Boolean).join(' '));
    else if (k === 'html') node.innerHTML = v;
    else if (k in node && !isSvg && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_TAGS = new Set(['svg', 'path', 'circle', 'line', 'rect', 'g', 'text', 'polyline', 'polygon', 'defs',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'ellipse', 'tspan', 'filter', 'feGaussianBlur']);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function mount(node, ...children) { clear(node); append(node, children); return node; }
