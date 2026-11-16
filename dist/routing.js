"use strict";

(function loadRailNetwork() {
  const data = window.BangkokData;
  const lines = data.lines.map(([id, system, name, color]) => ({ id, system, name, color }));
  const lineById = new Map(lines.map(line => [line.id, line]));
  const stationByCode = new Map(data.stations.map(([code, name, thai, lat, lng, aliases]) => [
    code, { code, name, thai, lat, lng, aliases, lines: [], connections: [] }
  ]));
  const runs = data.runs.map(run => ({
    ...run,
    line: lineById.get(run.line),
    stations: run.stops.map(code => stationByCode.get(code)),
    segments: run.segments.map(([minutes, path]) => ({ minutes, path }))
  }));

  const nodes = [];
  const nodesByStation = new Map(data.stations.map(([code]) => [code, []]));
  const walkLinks = [];
  const internalWalk = { CEN: 2, BL10: 3, BL01: 3, RN01: 4, PK10: 3 };

  for (const run of runs) {
    let previous;
    for (const [stopIndex, station] of run.stations.entries()) {
      const node = { id: nodes.length, station, run, stopIndex, edges: [] };
      nodes.push(node);
      nodesByStation.get(station.code).push(node);
      if (!station.lines.includes(run.line)) station.lines.push(run.line);
      if (previous) {
        const segment = run.segments[stopIndex - 1];
        previous.edges.push({ type: "ride", to: node, segment, minutes: segment.minutes });
        node.edges.push({ type: "ride", to: previous, segment, minutes: segment.minutes });
      }
      previous = node;
    }
  }

  function addTransfer(a, b, walking) {
    a.edges.push({ type: "transfer", to: b, walking, minutes: walking + b.run.wait });
    b.edges.push({ type: "transfer", to: a, walking, minutes: walking + a.run.wait });
  }

  for (const [code, platforms] of nodesByStation) {
    for (let i = 0; i < platforms.length; i += 1) {
      for (let j = i + 1; j < platforms.length; j += 1) {
        addTransfer(platforms[i], platforms[j], internalWalk[code] ?? 3);
      }
    }
    stationByCode.get(code).interchange = platforms.length > 1;
  }
  for (const [from, to, walking] of data.transfers) {
    const a = stationByCode.get(from);
    const b = stationByCode.get(to);
    a.connections.push(b);
    b.connections.push(a);
    a.interchange = true;
    b.interchange = true;
    walkLinks.push({ from: a, to: b });
    for (const first of nodesByStation.get(from)) {
      for (const second of nodesByStation.get(to)) addTransfer(first, second, walking);
    }
  }

  const stations = [...stationByCode.values()];
  const radians = Math.PI / 180;

  function distanceMeters(a, b) {
    const dy = Math.sin((b.lat - a.lat) * radians / 2);
    const dx = Math.sin((b.lng - a.lng) * radians / 2);
    const h = dy ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * dx ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function nearestStation(point) {
    let nearest = { station: null, distance: Infinity };
    for (const station of stations) {
      const distance = distanceMeters(point, station);
      if (distance < nearest.distance) nearest = { station, distance };
    }
    return nearest;
  }

  function searchKey(value) {
    // Keep Thai combining marks when normalizing English and station codes.
    return value.toLowerCase().normalize("NFC").replace(/[-_.,'/()]/g, " ").replace(/\s+/g, " ").trim();
  }

  const suggested = ["CEN", "E4", "BL31", "A1", "N8", "RN08", "BL29"];
  const searchIndex = stations.map(station => ({
    station,
    name: searchKey(station.name),
    code: station.code.toLowerCase(),
    thai: station.thai,
    aliases: ` ${searchKey(station.aliases)} `,
    terms: searchKey([station.code, station.name, station.thai, station.aliases,
      ...station.lines.map(line => `${line.system} ${line.name}`)].join(" "))
  }));

  function searchStations(query, limit = 9) {
    const key = searchKey(query);
    if (!key) return suggested.slice(0, limit).map(code => stationByCode.get(code));
    const terms = key.split(" ");
    return searchIndex.map(entry => {
      let rank = Infinity;
      if (entry.code === key || entry.name === key || entry.thai === key) rank = 0;
      else if (entry.name.startsWith(key) || entry.code.startsWith(key) || entry.thai.startsWith(key) ||
               entry.aliases.includes(` ${key} `)) rank = 1;
      else if (entry.terms.includes(key)) rank = 2;
      else if (terms.every(term => entry.terms.includes(term))) rank = 3;
      return { station: entry.station, rank };
    }).filter(item => Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank || a.station.name.localeCompare(b.station.name))
      .slice(0, limit)
      .map(item => item.station);
  }

  function isBetter(a, b, criterion) {
    if (criterion === "fewest-transfers" && a.transfers !== b.transfers) return a.transfers < b.transfers;
    if (a.minutes !== b.minutes) return a.minutes < b.minutes;
    return a.transfers < b.transfers;
  }

  function summarize(from, to, edges, minutes, transfers) {
    const legs = [];
    const stopCodes = new Set([from, to]);
    let stops = 0;
    for (const { node, edge } of edges) {
      const start = node.station;
      const finish = edge.to.station;
      stopCodes.add(finish.code);
      if (edge.type === "transfer") {
        legs.push({
          type: "transfer",
          from: start,
          to: finish,
          fromLine: node.run.line,
          toLine: edge.to.run.line,
          toRun: edge.to.run.id,
          walking: edge.walking
        });
        continue;
      }
      const forward = edge.to.stopIndex > node.stopIndex;
      let leg = legs.at(-1);
      if (leg?.type !== "ride" || leg.run !== node.run.id || leg.forward !== forward) {
        leg = {
          type: "ride",
          line: node.run.line,
          run: node.run.id,
          forward,
          direction: forward ? node.run.stations.at(-1) : node.run.stations[0],
          stations: [start],
          segments: []
        };
        legs.push(leg);
      }
      leg.stations.push(finish);
      leg.segments.push(edge.segment);
      stops += 1;
    }
    if (stops === 0) minutes = edges.reduce((sum, step) => sum + step.edge.walking, 0);
    return { from, to, minutes, transfers, stops, stopCodes, legs };
  }

  // Station codes are the interface to the planner. Platform nodes keep the
  // direction change at Tha Phra and the Pink Line shuttle explicit.
  function findRoute(from, to, { criterion = "fastest" } = {}) {
    const starts = nodesByStation.get(from);
    if (!starts || !nodesByStation.has(to)) return null;
    if (from === to) return summarize(from, to, [], 0, 0);
    const costs = Array(nodes.length).fill(null);
    const parents = Array(nodes.length).fill(null);
    const settled = new Uint8Array(nodes.length);
    for (const node of starts) costs[node.id] = { minutes: node.run.wait, transfers: 0 };

    for (let count = 0; count < nodes.length; count += 1) {
      let best = -1;
      for (let id = 0; id < nodes.length; id += 1) {
        if (!settled[id] && costs[id] && (best < 0 || isBetter(costs[id], costs[best], criterion))) best = id;
      }
      if (best < 0) break;
      const node = nodes[best];
      const cost = costs[best];
      if (node.station.code === to) {
        const path = [];
        for (let id = best; parents[id]; id = parents[id].node.id) path.push(parents[id]);
        return summarize(from, to, path.reverse(), cost.minutes, cost.transfers);
      }
      settled[best] = 1;
      for (const edge of node.edges) {
        const id = edge.to.id;
        if (settled[id]) continue;
        const next = {
          minutes: cost.minutes + edge.minutes,
          transfers: cost.transfers + Number(edge.type === "transfer")
        };
        if (!costs[id] || isBetter(next, costs[id], criterion)) {
          costs[id] = next;
          parents[id] = { node, edge };
        }
      }
    }
    return null;
  }

  window.BangkokRail = {
    lines, runs, stations, stationByCode, walkLinks,
    distanceMeters, nearestStation, searchStations, findRoute
  };
})();
