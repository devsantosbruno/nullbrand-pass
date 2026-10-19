// Every icon of the page. Drawn as DOM nodes (createElementNS), never from an SVG string (S1).
// A part is a path (`M...`), `circle:cx,cy,r` or `rect:x,y,width,height,rx`. Two families live here on purpose: the "content" icons
// (viewer, editor buttons: 18px, stroke 1.5) and the "chrome" icons of the sidebar/list/dialogs (16px or 14px, stroke 2). Where the same
// idea exists in both (star, shield, eye...) the geometry is not the same, and every place keeps the one it has always shown.
import { DomValueError, data } from '../dom.js';

const ICONS = {
  // content
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'circle:12,12,3'],
  'eye-off': ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'circle:12,12,3', 'M4 4l16 16'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'circle:12,7,4'],
  id: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'circle:9,11,2.5', 'M5 17c.6-2 2-3 4-3s3.4 1 4 3', 'M15 9h4', 'M15 13h4'],
  card: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M2 10h20', 'M6 15h4'],
  pencil: ['M7 3a2.85 2.85 0 1 0-4 4L16.5 20.5L22 22l-1.5-5.5z', 'M9 5l-4 4'],
  'key-down': ['circle:7.5,8.5,4.5', 'M10.7 11.7l9.8 9.8', 'M17 18l-3 3', 'M14.5 15.5L12 18'],
  pin: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z', 'circle:12,10,3'],
  key: ['circle:7.5,15.5,4.5', 'M10.7 12.3l9.8-9.8', 'M16 7l3 3', 'M14 9l2 2'],
  shield: ['M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z', 'M9 12l2 2 4-4'],
  server: ['M4 4h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 13h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z', 'M7 7.5h.01', 'M7 16.5h.01'],
  file: ['M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  // chrome
  list: ['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
  'star-line': ['M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'],
  'key-line': ['M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'],
  'credit-card': ['rect:2,5,20,14,2', 'M2 10h20'],
  'id-card': ['rect:2,4,20,16,2', 'circle:9,11,2.5', 'M5 17c.6-2 2-3 4-3s3.4 1 4 3M15 9h4M15 13h4'],
  'file-text': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  plus: ['M12 5v14M5 12h14'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5'],
  archive: ['M3 4h18v4H3zM5 8v12h14V8M10 12h4'],
  'shield-line': ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  lock: ['M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4'],
  sidebar: ['rect:3,4,18,16,2', 'M9 4v16'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'eye-off-wide': ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'circle:12,12,3', 'M3 3l18 18'],
  pen: ['M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
} as const;
export type IconName = keyof typeof ICONS;
const isIconName = (name: string): name is IconName => Object.hasOwn(ICONS, name);

export interface IconOptions {
  size?: number;
  strokeWidth?: number;
  filled?: boolean;
  className?: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// The attribute names of the non-path parts, in the order their values are written after the colon.
const SHAPES = { 'circle:': ['circle', ['cx', 'cy', 'r']], 'rect:': ['rect', ['x', 'y', 'width', 'height', 'rx']] } as const;
function part(spec: string): SVGElement {
  for (const [prefix, [tag, names]] of Object.entries(SHAPES)) {
    if (!spec.startsWith(prefix)) continue;
    const values = spec.slice(prefix.length).split(',');
    const shape = document.createElementNS(SVG_NS, tag);
    names.forEach((name, k) => shape.setAttribute(name, values[k] ?? ''));
    return shape;
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', spec);
  return path;
}

export function icon(name: IconName, { size = 18, strokeWidth = 1.5, filled = false, className }: IconOptions = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: filled ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  if (className) svg.setAttribute('class', className);
  for (const spec of ICONS[name]) svg.append(part(spec));
  return svg;
}

// The icon named by a data-icon attribute.
export function iconNameOf(node: HTMLElement): IconName {
  const name = data(node, 'icon');
  if (!isIconName(name)) throw new DomValueError('data-icon is not a known icon');
  return name;
}

// A number in a data-* attribute of the HTML.
function numberOf(node: HTMLElement, name: string, fallback: number): number {
  const raw = node.dataset[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new DomValueError(`data-${name} is not a positive number`);
  return n;
}

// Replaces every `<i data-icon-slot="name" data-icon-size data-icon-stroke data-icon-class>` of the static HTML with the icon (the
// <svg> takes the slot's place, so the DOM ends up as if the markup had been written inline). An unknown name throws.
export function applyIcons(root: ParentNode): void {
  for (const slot of root.querySelectorAll('[data-icon-slot]')) {
    if (!(slot instanceof HTMLElement)) throw new DomValueError('[data-icon-slot] on an element that is not HTML');
    const name = data(slot, 'iconSlot');
    if (!isIconName(name)) throw new DomValueError('data-icon-slot is not a known icon');
    const className = slot.dataset['iconClass'];
    slot.replaceWith(icon(name, { size: numberOf(slot, 'iconSize', 18), strokeWidth: numberOf(slot, 'iconStroke', 1.5), ...(className ? { className } : {}) }));
  }
}
