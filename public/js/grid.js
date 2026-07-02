// Availability grid: drag-to-paint editor + group heatmap, sharing geometry.
import { el, clear, minutesToLabel, slotsPerDay, columnLabel, encodeSlot } from './util.js';

export class AvailabilityGrid {
  // opts: { mode:'edit'|'heat', mySlots:Set, counts:Map, total:number,
  //         onChange(set), onHover(slot|null), bestSlots:Set }
  constructor(ev, opts) {
    this.ev = ev;
    this.opts = opts;
    this.mySlots = new Set(opts.mySlots || []);
    this.painting = false;
    this.paintValue = true;
    this.el = el('div', { class: 'avail-grid-wrap' });
    this.render();
    if (opts.mode === 'edit') this._bindPaint();
  }

  render() {
    const ev = this.ev;
    const spd = slotsPerDay(ev);
    const nCols = ev.dates.length;
    const grid = el('div', {
      class: `avail-grid mode-${this.opts.mode}`,
      style: { gridTemplateColumns: `var(--timecol) repeat(${nCols}, minmax(28px, 1fr))` },
    });

    // corner + header row
    grid.append(el('div', { class: 'ag-corner' }));
    for (let c = 0; c < nCols; c++) {
      const lbl = columnLabel(ev, c);
      grid.append(el('div', { class: 'ag-colhead' },
        el('span', { class: 'ag-col-top', text: lbl.top }),
        lbl.bottom ? el('span', { class: 'ag-col-bottom', text: lbl.bottom }) : null,
      ));
    }

    // body rows
    for (let r = 0; r < spd; r++) {
      const minute = ev.timeStart + r * ev.slotMinutes;
      const showLabel = minute % 60 === 0 || ev.slotMinutes >= 60;
      grid.append(el('div', { class: 'ag-timelabel' + (showLabel ? '' : ' faint'), text: showLabel ? minutesToLabel(minute) : '' }));
      for (let c = 0; c < nCols; c++) {
        const slot = encodeSlot(ev, c, r);
        const cell = el('div', { class: 'ag-cell', dataset: { slot } });
        if (minute % 60 === 0) cell.classList.add('hour-top');
        this._paintCell(cell, slot);
        grid.append(cell);
      }
    }
    clear(this.el).append(grid);
    this.grid = grid;
  }

  _paintCell(cell, slot) {
    const { mode } = this.opts;
    if (mode === 'edit') {
      cell.classList.toggle('on', this.mySlots.has(slot));
    } else {
      const count = this.opts.counts.get(slot) || 0;
      const total = Math.max(1, this.opts.total);
      const ratio = count / total;
      cell.style.background = count === 0 ? '' : heatColor(ratio);
      cell.classList.toggle('has', count > 0);
      cell.classList.toggle('full', count === total && total > 0);
      cell.classList.toggle('best', this.opts.bestSlots?.has(slot));
      cell.dataset.count = count;
    }
  }

  refresh(opts) {
    Object.assign(this.opts, opts);
    if (opts.mySlots) this.mySlots = new Set(opts.mySlots);
    for (const cell of this.grid.querySelectorAll('.ag-cell')) {
      this._paintCell(cell, Number(cell.dataset.slot));
    }
  }

  _cellFromPoint(x, y) {
    const node = document.elementFromPoint(x, y);
    if (node && node.classList.contains('ag-cell')) return node;
    return null;
  }

  _apply(cell) {
    const slot = Number(cell.dataset.slot);
    if (this.paintValue) this.mySlots.add(slot); else this.mySlots.delete(slot);
    cell.classList.toggle('on', this.paintValue);
  }

  _bindPaint() {
    const start = (e) => {
      const cell = e.target.closest?.('.ag-cell');
      if (!cell) return;
      e.preventDefault();
      this.painting = true;
      this.paintValue = !this.mySlots.has(Number(cell.dataset.slot));
      this._apply(cell);
      this.grid.classList.add('painting');
    };
    const move = (e) => {
      if (!this.painting) return;
      const pt = e.touches ? e.touches[0] : e;
      const cell = this._cellFromPoint(pt.clientX, pt.clientY);
      if (cell) this._apply(cell);
    };
    const end = () => {
      if (!this.painting) return;
      this.painting = false;
      this.grid.classList.remove('painting');
      this.opts.onChange?.([...this.mySlots].sort((a, b) => a - b));
    };
    this.grid.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    this.grid.addEventListener('touchmove', (e) => { if (this.painting) e.preventDefault(); }, { passive: false });
    this._cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }

  bindHeatHover(onHover) {
    const set = (e) => {
      const cell = e.target.closest?.('.ag-cell');
      onHover(cell ? Number(cell.dataset.slot) : null, cell);
    };
    this.grid.addEventListener('pointermove', set);
    this.grid.addEventListener('pointerleave', () => onHover(null, null));
    this.grid.addEventListener('click', (e) => {
      const cell = e.target.closest?.('.ag-cell');
      if (cell) this.opts.onClickSlot?.(Number(cell.dataset.slot));
    });
  }

  destroy() { this._cleanup?.(); }
}

function heatColor(ratio) {
  // green scale that deepens with consensus
  const light = 92 - ratio * 46;   // 92% -> 46%
  const sat = 55 + ratio * 20;
  return `hsl(145 ${sat}% ${light}%)`;
}
