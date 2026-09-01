export class DrawingManager {
  constructor(chart, series) {
    this.chart = chart;
    this.series = series;
    this.svg = document.getElementById('drawings-layer');
    this.container = this.svg.parentElement;
    
    this.drawings = JSON.parse(localStorage.getItem('twr.drawings') || '[]');
    this.activeTool = null;
    
    this.isDrawing = false;
    this.currentDrawing = null;
    
    // Subscribe to chart changes to repaint
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.repaint());
    this.series.subscribeDataChanged?.(() => this.repaint());
    new ResizeObserver(() => this.repaint()).observe(this.svg);

    this.initEvents();
    this.repaint();
  }

  setTool(tool) {
    this.activeTool = tool;
    if (tool === 'cursor') {
      this.svg.style.pointerEvents = 'none';
    } else {
      this.svg.style.pointerEvents = 'auto';
    }
  }

  clearAll() {
    this.drawings = [];
    this.save();
    this.repaint();
  }

  save() {
    localStorage.setItem('twr.drawings', JSON.stringify(this.drawings));
  }

  getLogicalCoords(e) {
    const rect = this.svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const time = this.chart.timeScale().coordinateToTime(x);
    const price = this.series.coordinateToPrice(y);
    return { time, price, x, y };
  }

  initEvents() {
    this.svg.addEventListener('mousedown', (e) => {
      if (this.activeTool === 'cursor') return;
      if (e.button !== 0) return; // Only left click

      const { time, price } = this.getLogicalCoords(e);
      if (!time || !price) return;

      this.isDrawing = true;
      this.currentDrawing = {
        type: this.activeTool,
        p1: { time, price },
        p2: { time, price }
      };
      
      this.drawings.push(this.currentDrawing);
      this.repaint();
    });

    this.svg.addEventListener('mousemove', (e) => {
      if (!this.isDrawing || !this.currentDrawing) return;
      const { time, price } = this.getLogicalCoords(e);
      if (!time || !price) return;

      this.currentDrawing.p2 = { time, price };
      this.repaint();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDrawing) {
        this.isDrawing = false;
        this.save();
      }
    });
  }

  repaint() {
    if (!this.svg) return;
    this.svg.innerHTML = '';
    
    const ts = this.chart.timeScale();
    const w = this.svg.clientWidth;
    
    for (const d of this.drawings) {
      const x1 = ts.timeToCoordinate(d.p1.time);
      const y1 = this.series.priceToCoordinate(d.p1.price);
      let x2 = ts.timeToCoordinate(d.p2.time);
      let y2 = this.series.priceToCoordinate(d.p2.price);

      if (x1 == null || y1 == null) continue;
      // If p2 is out of bounds or missing, default to p1 (e.g. for just a point)
      if (x2 == null) x2 = x1;
      if (y2 == null) y2 = y1;

      if (d.type === 'trendline') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#2962FF');
        line.setAttribute('stroke-width', '2');
        this.svg.appendChild(line);
      } 
      else if (d.type === 'ray') {
        // Horizontal ray from x1, y1 extending to the right
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', w);
        line.setAttribute('y2', y1);
        line.setAttribute('stroke', '#2962FF');
        line.setAttribute('stroke-width', '2');
        this.svg.appendChild(line);
      }
      else if (d.type === 'fib') {
        // Draw Fib retracements (0, 0.236, 0.382, 0.5, 0.618, 1)
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const colors = ['#787b86', '#f44336', '#81c784', '#4caf50', '#009688', '#64b5f6', '#787b86'];
        
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        
        // Draw trendline
        const tline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tline.setAttribute('x1', x1);
        tline.setAttribute('y1', y1);
        tline.setAttribute('x2', x2);
        tline.setAttribute('y2', y2);
        tline.setAttribute('stroke', '#787b86');
        tline.setAttribute('stroke-width', '1');
        tline.setAttribute('stroke-dasharray', '4,4');
        this.svg.appendChild(tline);

        levels.forEach((lvl, i) => {
          const yLvl = y1 + (y2 - y1) * lvl;
          const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          l.setAttribute('x1', minX);
          l.setAttribute('y1', yLvl);
          l.setAttribute('x2', maxX + 100); // extend slightly right
          l.setAttribute('y2', yLvl);
          l.setAttribute('stroke', colors[i]);
          l.setAttribute('stroke-width', '1');
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', maxX + 100);
          text.setAttribute('y', yLvl - 4);
          text.setAttribute('fill', colors[i]);
          text.setAttribute('font-size', '10px');
          text.setAttribute('font-family', 'monospace');
          text.textContent = lvl.toFixed(3);

          this.svg.appendChild(l);
          this.svg.appendChild(text);
        });
      }
    }
  }
}
