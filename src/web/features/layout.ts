// The page's layout controls: the collapsible sidebar and the draggable divider between the list and the detail pane.
// The only things kept in localStorage are the two layout choices (`sidebar-collapsed`, `listWidth`); nothing sensitive, ever (S8).
import { $, $button, expectInstance } from '../dom.js';

// Ctrl/Cmd+B and the button next to the search box.
function initSidebarToggle(): void {
  const app = $('#screen-vault');
  const btn = $button('#btn-sidebar');
  const apply = (collapsed: boolean): void => {
    app.classList.toggle('sidebar-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
  };
  try { apply(localStorage.getItem('sidebar-collapsed') === '1'); } catch {}
  const toggle = (): void => {
    const c = !app.classList.contains('sidebar-collapsed');
    apply(c);
    try { localStorage.setItem('sidebar-collapsed', c ? '1' : '0'); } catch {}
  };
  btn.addEventListener('click', toggle);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b' && !app.hidden) {
      e.preventDefault();
      toggle();
    }
  });
}

// Resize list | detail
function initListResize(): void {
  const MAX = 640, KEY = 'listWidth';
  const app = $('#screen-vault');
  const handle = $('#resize-handle');
  const handleParent = (): HTMLElement => expectInstance(handle.parentElement, HTMLElement, '#resize-handle parent');
  // Minimum = natural width of the floating selection box (+ 12px margin on each side),
  // measured on the spot: it depends on font, zoom and device language.
  const bar = $('#sel-bar');
  const minW = (): number => {
    const wasHidden = bar.hidden, prevMax = bar.style.maxWidth;
    bar.hidden = false;
    bar.style.maxWidth = 'none';
    const w = bar.offsetWidth;
    bar.style.maxWidth = prevMax;
    bar.hidden = wasHidden;
    return Math.ceil(w) + 24 || 260;
  };
  // The app uses CSS zoom: clientX/rect are in visual px, the variable in local px.
  const zoom = (): number => handleParent().getBoundingClientRect().width / handleParent().offsetWidth || 1;
  const clamp = (w: number): number => Math.max(minW(), Math.min(MAX, Math.min(w, (window.innerWidth / zoom()) * 0.6)));
  const apply = (w: number): void => app.style.setProperty('--list-w', clamp(w) + 'px');
  const save = (w: number): void => { try { localStorage.setItem(KEY, String(Math.round(clamp(w)))); } catch {} };
  try { const stored = localStorage.getItem(KEY); const w = stored === null ? NaN : parseInt(stored, 10); if (w) apply(w); } catch {}
  const current = (): number => handleParent().offsetWidth;
  let stop: (() => void) | null = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (stop) stop();
    const startX = e.clientX, startW = current(), z = zoom();
    try { handle.setPointerCapture(e.pointerId); } catch {}
    app.classList.add('resizing');
    const move = (ev: PointerEvent): void => {
      if (ev.buttons === 0) return finish(); // released outside and the pointerup was lost
      apply(startW + (ev.clientX - startX) / z);
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      handle.removeEventListener('lostpointercapture', finish);
      app.classList.remove('resizing');
      save(current());
      stop = null;
    };
    stop = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    handle.addEventListener('lostpointercapture', finish);
  });
  handle.addEventListener('dragstart', (e) => e.preventDefault());
  handle.addEventListener('dblclick', () => { app.style.removeProperty('--list-w'); try { localStorage.removeItem(KEY); } catch {} });
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = current() + (e.key === 'ArrowRight' ? 16 : -16);
    apply(w); save(w);
  });
}

export function initLayout(): void {
  initSidebarToggle();
  initListResize();
}
