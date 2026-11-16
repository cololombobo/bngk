"use strict";

(function loadMap() {
  const { stations, runs, walkLinks } = window.BangkokRail;
  const baseTiles = window.BangkokTiles;
  const tileIndex = new Map(Object.entries(window.BangkokTileIndex).map(([zoom, keys]) => [Number(zoom), new Set(keys)]));
  const tileExtent = 1024;
  const minZoom = 9.25;
  const maxZoom = 18;
  const radians = Math.PI / 180;
  const worldWidth = 40075016.686;
  const typeface = 'Inter, system-ui, -apple-system, sans-serif';
  const downtown = new Set(["BL29", "BL31", "S6", "CEN", "E4", "N2", "A6", "N8", "G2", "BL20", "BL25", "E9"]);
  const keyLabels = new Map([
    ["A1", "Suvarnabhumi"], ["RN01", "Krung Thep Aphiwat"], ["PK01", "Nonthaburi Civic Ctr."],
    ["PP11", "Nonthaburi Civic Ctr."], ["N17", "Wat Phra Sri Mahathat"], ["BL23", "Queen Sirikit Centre"]
  ]);

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function project(lat, lng) {
    const safeLatitude = clamp(lat, -85.0511, 85.0511);
    return { x: (lng + 180) / 360, y: (1 - Math.asinh(Math.tan(safeLatitude * radians)) / Math.PI) / 2 };
  }

  function polyline(path) {
    const points = [];
    for (let i = 0; i < path.length; i += 2) points.push(project(path[i], path[i + 1]));
    return points;
  }

  const stationPoints = new Map(stations.map(station => [station.code, project(station.lat, station.lng)]));
  const segmentPoints = new Map(runs.flatMap(run => run.segments.map(segment => [segment, polyline(segment.path)])));
  const terminals = new Set(runs.flatMap(run => [run.stations[0].code, run.stations.at(-1).code]));
  const bounds = { nw: project(14.085, 100.235), se: project(13.455, 100.97) };

  const paint = [
    ["green", "#e1e9dc"],
    ["parks", "#d9e7d5"],
    ["water", "#c3dce3"],
    ["stream", "#bad6df", 0.85],
    ["runway", "#d6d8cf", 3.5],
    ["rail", "#c9ccc2", 0.85],
    ["lane", "#fbfaf6", 0.72],
    ["street", "#fcfbf7", 1.45],
    ["secondary", "#e1dfd4", 2.65],
    ["secondary", "#fffdf6", 1.75],
    ["primary", "#dedacb", 3.65],
    ["primary", "#fffcf1", 2.55],
    ["highway", "#ddd7c6", 4.5],
    ["highway", "#f9edce", 3.35]
  ];

  function tilePaths(data) {
    const groups = {};
    for (const [layer, paths] of Object.entries(data[0])) {
      const shape = new Path2D();
      for (const points of paths) {
        shape.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) shape.lineTo(points[i], points[i + 1]);
        if (layer === "water" || layer === "green" || layer === "parks") shape.closePath();
      }
      groups[layer] = shape;
    }
    return groups;
  }

  class RailMap {
    constructor({ canvas, scale, onClick, onView }) {
      this.canvas = canvas;
      this.container = canvas.parentElement;
      this.context = canvas.getContext("2d", { alpha: false });
      this.scale = scale;
      this.onClick = onClick;
      this.onView = onView;
      this.tileCache = new WeakMap();
      this.pendingTiles = new Set();
      this.detailTiles = new Map();
      this.pointers = new Map();
      this.visibleLines = new Set(runs.map(run => run.line.id));
      this.frame = null;
      this.pickedMarkers = [];
      this.stationLabels = [];
      this.route = null;
      this.endpoints = {};
      this.resize();
      this.bindGestures();
      new ResizeObserver(() => this.resize()).observe(this.container);
    }

    resize() {
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      if (!width || !height || (width === this.width && height === this.height && pixelRatio === this.pixelRatio)) return;
      if (!this.center) {
        const compact = width < 540;
        this.center = compact ? project(13.775, 100.533) : project(13.785, 100.548);
        this.zoom = compact ? 11.82 : 11.68;
      }
      Object.assign(this, { width, height, pixelRatio });
      this.canvas.width = Math.round(width * pixelRatio);
      this.canvas.height = Math.round(height * pixelRatio);
      this.container.style.setProperty("--map-height", `${height}px`);
      this.requestDraw();
    }

    get size() {
      return 256 * 2 ** this.zoom;
    }

    screen(point) {
      return {
        x: (point.x - this.center.x) * this.size + this.width / 2,
        y: (point.y - this.center.y) * this.size + this.height / 2
      };
    }

    stationScreen(station) {
      return this.screen(stationPoints.get(station.code));
    }

    fromScreen(x, y) {
      return {
        x: this.center.x + (x - this.width / 2) / this.size,
        y: this.center.y + (y - this.height / 2) / this.size
      };
    }

    moveTo(center, zoom = this.zoom) {
      this.center = {
        x: clamp(center.x, bounds.nw.x, bounds.se.x),
        y: clamp(center.y, bounds.nw.y, bounds.se.y)
      };
      this.zoom = clamp(zoom, minZoom, maxZoom);
      this.requestDraw();
    }

    focus(point, zoom = 15.25) {
      this.moveTo(project(point.lat, point.lng), zoom);
    }

    pan(dx, dy) {
      this.moveTo({ x: this.center.x - dx / this.size, y: this.center.y - dy / this.size });
    }

    zoomBy(delta, anchor = { x: this.width / 2, y: this.height / 2 }) {
      const point = this.fromScreen(anchor.x, anchor.y);
      this.zoom = clamp(this.zoom + delta, minZoom, maxZoom);
      this.moveTo({
        x: point.x - (anchor.x - this.width / 2) / this.size,
        y: point.y - (anchor.y - this.height / 2) / this.size
      });
    }

    fit(stationList, max = 14.25) {
      if (stationList.length === 0) return;
      const points = stationList.map(station => project(station.lat, station.lng));
      const xs = points.map(point => point.x);
      const ys = points.map(point => point.y);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const span = Math.min(
        (this.width - (this.width < 540 ? 92 : 150)) / Math.max(right - left, 1e-7),
        (this.height - (this.height < 420 ? 105 : 154)) / Math.max(bottom - top, 1e-7)
      );
      this.moveTo({ x: (left + right) / 2, y: (top + bottom) / 2 }, Math.min(max, Math.log2(span / 256)));
    }

    setState(state) {
      Object.assign(this, state);
      this.requestDraw();
    }

    requestDraw() {
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.draw();
      });
    }

    fetchTile(zoom, x, y) {
      const file = `${x}-${y}`;
      const key = `${zoom}/${file}`;
      const index = tileIndex.get(zoom);
      if (!index?.has(file) || this.pendingTiles.has(key)) return;
      this.pendingTiles.add(key);
      const script = document.createElement("script");
      script.src = `map/${key}.js`;
      script.onload = () => {
        this.pendingTiles.delete(key);
        this.detailTiles.set(key, true);
        const cacheLimit = Math.max(66, Math.ceil(this.width / 205 + 2) * Math.ceil(this.height / 205 + 2) + 34);
        if (this.detailTiles.size > cacheLimit) {
          const oldest = this.detailTiles.keys().next().value;
          delete baseTiles[oldest];
          this.detailTiles.delete(oldest);
        }
        script.remove();
        this.requestDraw();
      };
      script.onerror = () => {
        this.pendingTiles.delete(key);
        index.delete(file);
        script.remove();
      };
      document.head.append(script);
    }

    drawTile(data, zoom, x, y) {
      const ctx = this.context;
      const count = 2 ** zoom;
      const size = this.size / count;
      const origin = this.screen({ x: x / count, y: y / count });
      let geometry = this.tileCache.get(data);
      if (!geometry) {
        geometry = tilePaths(data);
        this.tileCache.set(data, geometry);
      }
      ctx.save();
      ctx.translate(origin.x, origin.y);
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.clip();
      ctx.fillStyle = "#eeeee5";
      ctx.fillRect(0, 0, size, size);
      const factor = size / tileExtent;
      ctx.scale(factor, factor);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const density = clamp(2 ** ((this.zoom - 12) / 4), 0.65, 2.45);
      for (const [layer, color, width] of paint) {
        const path = geometry[layer];
        if (!path) continue;
        if (width) {
          if (layer === "lane" && this.zoom < 14.5) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth = width * density / factor;
          ctx.stroke(path);
        } else {
          ctx.fillStyle = color;
          ctx.fill(path);
        }
      }
      ctx.restore();
      return { data, zoom, x, y, size, origin };
    }

    drawBase() {
      const ctx = this.context;
      ctx.fillStyle = "#eeeee5";
      ctx.fillRect(0, 0, this.width, this.height);
      const start = this.fromScreen(0, 0);
      const end = this.fromScreen(this.width, this.height);
      const available = [];
      const topZoom = this.zoom >= 14.05 ? 14 : this.zoom >= 12.75 ? 13 : 12;
      for (let zoom = 12; zoom <= topZoom; zoom += 1) {
        const n = 2 ** zoom;
        for (let x = Math.floor(start.x * n); x <= Math.floor(end.x * n); x += 1) {
          for (let y = Math.floor(start.y * n); y <= Math.floor(end.y * n); y += 1) {
            const key = `${zoom}/${x}-${y}`;
            const data = baseTiles[key];
            if (data) {
              if (this.detailTiles.delete(key)) this.detailTiles.set(key, true);
              available.push(this.drawTile(data, zoom, x, y));
            } else if (zoom > 12) {
              this.fetchTile(zoom, x, y);
            }
          }
        }
      }
      return available.reverse();
    }

    drawMapLabels(tiles) {
      const hiddenByDetail = (tile, x, y) => {
        const worldX = (tile.x + x / tileExtent) / 2 ** tile.zoom;
        const worldY = (tile.y + y / tileExtent) / 2 ** tile.zoom;
        return tiles.some(other => other.zoom > tile.zoom && Math.floor(worldX * (2 ** other.zoom)) === other.x && Math.floor(worldY * (2 ** other.zoom)) === other.y);
      };
      const cityWords = new Set(this.stationLabels.map(label => label.dot.station.name));
      for (const tile of tiles) {
        const [, roads, places] = tile.data;
        const px = tile.size / tileExtent;
        for (const [name, x, y, kind] of places) {
          const major = kind === "city" || kind === "town" || kind === "airport" || kind === "water";
          if (!major && this.zoom < 11.6) continue;
          if (kind === "quarter" && this.zoom < 12.95) continue;
          if (kind === "park" && this.zoom < 13.6) continue;
          if (kind === "water" && this.zoom > 13.6) continue;
          if ((kind === "city" || kind === "town") && this.zoom > 14.2) continue;
          if (cityWords.has(name) || hiddenByDetail(tile, x, y)) continue;
          let text = name;
          let font = `600 11px ${typeface}`;
          let color = "#697a70";
          if (kind === "city" || kind === "town") {
            text = name.toUpperCase();
            font = `740 ${kind === "city" ? 15 : 11}px ${typeface}`;
            color = "#687b70";
          }
          if (kind === "airport") color = "#6e5265";
          if (kind === "water") {
            color = "#608394";
            font = `italic 11px ${typeface}`;
          }
          const sx = tile.origin.x + x * px;
          const sy = tile.origin.y + y * px;
          const c = this.context;
          c.font = font;
          const width = c.measureText(text).width;
          if (this.reserveLabel(sx - width / 2 - 6, sy - 10, width + 12, 20)) {
            c.textAlign = "center";
            this.text(text, sx, sy, color, 3);
            cityWords.add(name);
          }
        }
        if (this.zoom < 13.25) continue;
        for (const [name, x, y, angle, length, minor] of roads) {
          if ((minor && this.zoom < 15) || (length * px < 45) || hiddenByDetail(tile, x, y)) continue;
          const c = this.context;
          c.font = `500 ${minor ? 10 : 11}px ${typeface}`;
          const width = c.measureText(name).width;
          if (length * px < width * 0.65) continue;
          const sx = tile.origin.x + x * px;
          const sy = tile.origin.y + y * px;
          const rotation = angle * radians;
          const boxWidth = Math.abs(Math.cos(rotation)) * width + 16;
          const boxHeight = Math.abs(Math.sin(rotation)) * width + 13;
          if (this.reserveLabel(sx - boxWidth / 2, sy - boxHeight / 2, boxWidth, boxHeight)) {
            c.save();
            c.translate(sx, sy);
            c.rotate(rotation);
            c.textAlign = "center";
            this.text(name, 0, 0, "#687369", 2.6);
            c.restore();
          }
        }
      }
    }

    reserveLabel(x, y, width, height) {
      if (x < 4 || y < 4 || x + width > this.width - 4 || y + height > this.height - 6) return false;
      if (this.labelBoxes.some(box => x < box.x + box.w && x + width > box.x && y < box.y + box.h && y + height > box.y)) return false;
      this.labelBoxes.push({ x, y, w: width, h: height });
      return true;
    }

    text(text, x, y, color, outline) {
      const ctx = this.context;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#f8faf4f0";
      ctx.fillStyle = color;
      ctx.lineWidth = outline;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }

    track(segments, color, width) {
      if (segments.length === 0) return;
      const ctx = this.context;
      ctx.beginPath();
      for (const segment of segments) {
        const path = segmentPoints.get(segment);
        const origin = this.screen(path[0]);
        ctx.moveTo(origin.x, origin.y);
        for (let i = 1; i < path.length; i += 1) {
          const point = this.screen(path[i]);
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    transfer(from, to, emphasized) {
      const a = this.stationScreen(from);
      const b = this.stationScreen(to);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 5) return;
      const ctx = this.context;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = emphasized ? 5 : 3.5;
      ctx.stroke();
      ctx.setLineDash(emphasized ? [4, 5] : [2.5, 3]);
      ctx.strokeStyle = emphasized ? "#536559" : "#7b8a80";
      ctx.lineWidth = emphasized ? 2.2 : 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    routeLines() {
      const ctx = this.context;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const width = this.zoom >= 14.5 ? 4.6 : this.zoom >= 11.35 ? 3.75 : 2.85;
      const visibleRuns = runs.filter(run => this.visibleLines.has(run.line.id));
      ctx.globalAlpha = this.route ? 0.33 : 0.97;
      for (const run of visibleRuns) this.track(run.segments, "#fffffc", width + 2.4);
      for (const run of visibleRuns) this.track(run.segments, run.line.color, width);
      for (const { from, to } of walkLinks) {
        if (this.stationVisible(from) && this.stationVisible(to)) this.transfer(from, to, false);
      }
      ctx.globalAlpha = 1;
      for (const leg of this.route?.legs ?? []) {
        if (leg.type === "ride") {
          this.track(leg.segments, "#fffefa", width + 5);
          this.track(leg.segments, leg.line.color, width + 2.6);
        } else {
          this.transfer(leg.from, leg.to, true);
        }
      }
    }

    stationVisible(station) {
      return station.lines.some(line => this.visibleLines.has(line.id));
    }

    circle(x, y, radius, fill, stroke, strokeWidth = 1) {
      const c = this.context;
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.fillStyle = fill;
      c.fill();
      if (stroke) {
        c.strokeStyle = stroke;
        c.lineWidth = strokeWidth;
        c.stroke();
      }
    }

    drawStations() {
      const ctx = this.context;
      const candidates = [];
      this.pickedMarkers = [];
      this.stationLabels = [];
      for (const station of stations) {
        const from = this.endpoints.from === station.code;
        const to = this.endpoints.to === station.code;
        const inRoute = this.route?.stopCodes.has(station.code);
        const selected = this.activeStation === station.code;
        if (!this.stationVisible(station) && !inRoute && !from && !to && !selected) continue;
        const displayPoint = this.stationScreen(station);
        const { x, y } = displayPoint;
        if (x < -25 || x > this.width + 25 || y < -25 || y > this.height + 25) continue;
        const endpoint = from || to;
        const weight = endpoint ? 9 : selected ? 8 : inRoute ? 7 : downtown.has(station.code) ? 5 : station.interchange ? 4 : terminals.has(station.code) ? 3 : 1;
        candidates.push({ station, x, y, selected, from, to, endpoint, weight, inRoute });
      }
      candidates.sort((a, b) => a.weight - b.weight);
      for (const dot of candidates) {
        const { station, x, y, selected, inRoute, endpoint, from } = dot;
        const colors = station.lines.filter(line => this.visibleLines.has(line.id)).map(line => line.color);
        const color = colors[0] ?? station.lines[0].color;
        const muted = this.route && !inRoute && !endpoint && !selected;
        const radius = selected ? 6 : station.interchange ? 4.4 : this.zoom >= 14 ? 3.9 : this.zoom >= 11.4 ? 2.7 : 2.25;
        ctx.globalAlpha = muted ? 0.46 : 1;
        if (endpoint) {
          this.circle(x, y, 11, from ? "#28463b" : "#ffd45c", "#fffefa", 2.8);
          ctx.font = `800 11px ${typeface}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = from ? "#fff" : "#26362e";
          ctx.fillText(from ? "A" : "B", x, y + 0.3);
        } else {
          if (selected || station.interchange) this.circle(x, y, radius + 1.6, "#fffffa");
          this.circle(x, y, radius, "#fffef9", station.interchange ? "#385347" : color, station.interchange ? 1.7 : 1.45);
          if (station.interchange) this.circle(x, y, 1.35, color);
        }
        ctx.globalAlpha = 1;
        this.pickedMarkers.push(dot);
      }

      const drawnNames = new Set();
      for (const dot of [...candidates].reverse()) {
        const { station, x, y, weight, endpoint } = dot;
        const zoom = this.zoom;
        if (weight < 3 && zoom < 12.85) continue;
        if (weight < 5 && zoom < 11.25) continue;
        if (this.route && weight < 7 && zoom < 13.1) continue;
        const name = zoom < 14 ? keyLabels.get(station.code) ?? station.name : station.name;
        if (zoom < 13.5 && drawnNames.has(name) && !endpoint) continue;
        ctx.font = `${weight >= 4 ? 700 : 610} ${zoom >= 13.4 ? 12 : 10.7}px ${typeface}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        const w = ctx.measureText(name).width;
        const gap = endpoint ? 16 : 9;
        const layouts = [
          [x + gap, y],
          [x - w - gap, y],
          [x - w / 2, y - gap - 3],
          [x - w / 2, y + gap + 3]
        ];
        for (const [left, baseline] of layouts) {
          if (!this.reserveLabel(left - 3, baseline - 7, w + 6, 14)) continue;
          this.text(name, left, baseline, weight >= 4 ? "#263d33" : "#3e5046", endpoint ? 4.5 : 3.6);
          this.stationLabels.push({ dot, x: left - 3, y: baseline - 8, w: w + 6, h: 16 });
          drawnNames.add(name);
          break;
        }
      }
    }

    drawLocation() {
      if (!this.location) return;
      const { lat, lng, accuracy } = this.location;
      const { x, y } = this.screen(project(lat, lng));
      const metersPerPixel = Math.cos(lat * radians) * worldWidth / this.size;
      this.circle(x, y, clamp(accuracy / metersPerPixel, 12, 280), "#408ce22a", "#4d92d34f", 1);
      this.circle(x, y, 7.5, "#2878d0", "#fff", 3);
    }

    draw() {
      if (!this.width || !this.height) return;
      const ctx = this.context;
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      ctx.textBaseline = "middle";
      const tiles = this.drawBase();
      const routeToolbar = this.route ? 235 : 145;
      this.labelBoxes = [
        { x: 0, y: 0, w: routeToolbar, h: 65 },
        { x: this.width - 55, y: 0, w: 55, h: 56 },
        { x: this.width - 62, y: this.height - 180, w: 62, h: 180 },
        { x: 0, y: this.height - 26, w: this.width, h: 26 }
      ];
      this.routeLines();
      this.drawStations();
      this.drawMapLabels(tiles);
      this.drawLocation();
      const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * this.center.y)));
      const metersPerPixel = Math.cos(latitude) * worldWidth / this.size;
      const power = 10 ** Math.floor(Math.log10(84 * metersPerPixel));
      const units = [5, 2, 1].find(step => step * power <= 84 * metersPerPixel);
      const amount = units * power;
      this.scale.style.width = `${Math.round(amount / metersPerPixel)}px`;
      this.scale.textContent = amount >= 1000 ? `${amount / 1000} км` : `${amount} м`;
      this.onView?.();
    }

    hit(point, radius) {
      let closest = null;
      let best = radius;
      for (const dot of this.pickedMarkers) {
        const delta = Math.hypot(dot.x - point.x, dot.y - point.y);
        if (delta <= best) {
          best = delta;
          closest = dot.station;
        }
      }
      if (closest) return closest;
      return this.stationLabels.find(item => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h)?.dot.station ?? null;
    }

    bindGestures() {
      const canvas = this.canvas;
      const local = event => {
        const box = canvas.getBoundingClientRect();
        return { x: event.clientX - box.left, y: event.clientY - box.top };
      };
      const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      canvas.addEventListener("pointerdown", event => {
        if (event.button !== 0 || this.pointers.size >= 2) return;
        const point = local(event);
        if (this.pointers.size === 0) {
          this.hasDragged = false;
          this.pointerStart = point;
        } else this.hasDragged = true;
        this.pointers.set(event.pointerId, point);
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener("pointermove", event => {
        const point = local(event);
        const previous = this.pointers.get(event.pointerId);
        if (!previous) {
          if (event.pointerType === "mouse") canvas.classList.toggle("is-over-station", Boolean(this.hit(point, 11)));
          return;
        }
        if (this.pointers.size === 2) {
          const other = [...this.pointers].find(([id]) => id !== event.pointerId)[1];
          const oldRadius = Math.hypot(previous.x - other.x, previous.y - other.y);
          const newRadius = Math.hypot(point.x - other.x, point.y - other.y);
          const previousCenter = midpoint(previous, other);
          const nextCenter = midpoint(point, other);
          if (oldRadius > 1 && newRadius > 1) {
            this.zoomBy(Math.log2(newRadius / oldRadius), previousCenter);
            this.pan(nextCenter.x - previousCenter.x, nextCenter.y - previousCenter.y);
          }
        } else {
          const origin = this.hasDragged ? previous : this.pointerStart;
          if (this.hasDragged || Math.hypot(point.x - origin.x, point.y - origin.y) > 5) {
            this.hasDragged = true;
            canvas.classList.add("is-dragging");
            this.pan(point.x - origin.x, point.y - origin.y);
          }
        }
        this.pointers.set(event.pointerId, point);
      });
      const end = event => {
        if (!this.pointers.delete(event.pointerId)) return;
        if (this.pointers.size) return;
        canvas.classList.remove("is-dragging");
        if (event.type !== "pointerup" || this.hasDragged) return;
        this.onClick(this.hit(local(event), event.pointerType === "mouse" ? 12 : 20));
      };
      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointercancel", end);
      canvas.addEventListener("lostpointercapture", end);
      canvas.addEventListener("dblclick", event => this.zoomBy(1, local(event)));
      canvas.addEventListener("wheel", event => {
        event.preventDefault();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
        this.zoomBy(clamp(-delta * 0.0035, -0.95, 0.95), local(event));
      }, { passive: false });
      canvas.addEventListener("keydown", event => {
        switch (event.key) {
          case "+": case "=": this.zoomBy(0.85); break;
          case "-": this.zoomBy(-0.85); break;
          case "ArrowUp": this.pan(0, 65); break;
          case "ArrowDown": this.pan(0, -65); break;
          case "ArrowLeft": this.pan(65, 0); break;
          case "ArrowRight": this.pan(-65, 0); break;
          default: return;
        }
        event.preventDefault();
      });
    }
  }

  window.RailMap = RailMap;
})();
