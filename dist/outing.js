"use strict";

(function loadOutings() {
  const { stations, distanceMeters, findRoute, estimateRoute } = window.BangkokRail;
  const { places, canVisit, matchesTag, onMap, today } = window.BangkokPlaces;
  const accessCache = new WeakMap();
  const pointId = point => point.code ?? point.id;

  function walkBetween(from, to) {
    const distance = distanceMeters(from, to);
    return { from, to, type: "walk", minutes: distance < 25 ? 0 : Math.max(1, distance * 1.25 / 75) };
  }

  function stationAccess(point) {
    if (point.code) return [{ station: point, minutes: 0 }];
    if (!accessCache.has(point)) {
      const nearby = stations
        .map(station => ({ station, minutes: walkBetween(point, station).minutes }))
        .sort((a, b) => a.minutes - b.minutes);
      accessCache.set(point, nearby.filter(access => access.minutes <= 34).slice(0, 3));
    }
    return accessCache.get(point);
  }

  function chooseTravel(from, to, criterion) {
    if (pointId(from) === pointId(to)) return { minutes: 0 };
    if (from.code && to.code) {
      return { ...estimateRoute(from.code, to.code, criterion), board: from, leave: to };
    }
    let best = walkBetween(from, to);
    for (const entry of stationAccess(from)) {
      for (const exit of stationAccess(to)) {
        if (entry.station.code === exit.station.code) continue;
        const rail = estimateRoute(entry.station.code, exit.station.code, criterion);
        if (!rail) continue;
        const minutes = entry.minutes + rail.minutes + exit.minutes;
        if (minutes < best.minutes) {
          best = { minutes, board: entry.station, leave: exit.station };
        }
      }
    }
    return best;
  }

  function bestInsertion(order, point, travel) {
    let position = 1;
    let extra = Infinity;
    for (let i = 1; i < order.length; i += 1) {
      const before = order[i - 1];
      const after = order[i];
      const detour = travel(before, point).minutes + travel(point, after).minutes - travel(before, after).minutes;
      if (detour < extra) {
        extra = detour;
        position = i;
      }
    }
    return { position, extra: extra + point.minutes };
  }

  function withPlace(order, place, position) {
    return [...order.slice(0, position), place, ...order.slice(position)];
  }

  // Favors covering the chosen interests, then more visits and saved favorites.
  // Keep several feasible orders at each step so one cheap stop cannot dictate the trip.
  function chooseVisits(initial, candidates, tags, travel, maxMinutes, day) {
    if (initial.minutes >= maxMinutes || !tags.length) return initial;
    const shortlistLimit = 36;
    const scored = candidates.map(place => {
      let interests = 0;
      tags.forEach((tag, index) => {
        if (matchesTag(place, tag, day)) interests |= 1 << index;
      });
      if (!interests) return null;
      const extra = bestInsertion(initial.order, place, travel).extra;
      const value = 2 + Number(Boolean(place.personal)) + (place.stars ?? 0);
      return { place, interests, value, rank: Math.max(1, extra) / value };
    }).filter(Boolean).sort((a, b) => a.rank - b.rank);
    const shortlist = new Set();
    tags.forEach((_, index) => {
      scored.filter(entry => entry.interests & (1 << index)).slice(0, 3).forEach(entry => shortlist.add(entry));
    });
    for (const entry of scored) {
      if (shortlist.size >= shortlistLimit) break;
      shortlist.add(entry);
    }
    const interestCount = mask => {
      let n = 0;
      for (; mask; mask &= mask - 1) n += 1;
      return n;
    };
    const compare = (a, b) =>
      interestCount(b.interests) - interestCount(a.interests) || b.value - a.value || a.minutes - b.minutes;
    let best = initial;
    let active = [initial];
    while (active.length > 0) {
      const next = new Map();
      for (const state of active) {
        for (const entry of shortlist) {
          if (state.order.includes(entry.place)) continue;
          const { extra, position } = bestInsertion(state.order, entry.place, travel);
          const minutes = state.minutes + extra;
          if (minutes > maxMinutes + 1e-7) continue;
          const order = withPlace(state.order, entry.place, position);
          const candidate = { order, minutes, interests: state.interests | entry.interests, value: state.value + entry.value };
          const key = order.slice(1, -1).map(place => place.id).sort().join("|");
          if (!next.has(key) || minutes < next.get(key).minutes) next.set(key, candidate);
        }
      }
      active = [...next.values()].sort(compare).slice(0, 14);
      if (active.length && compare(active[0], best) < 0) best = active[0];
    }
    return best;
  }

  function arrangeRequired(from, to, places, travel, directMinutes) {
    let state = { order: [from, to], minutes: directMinutes };
    const remaining = [...places];
    while (remaining.length) {
      const choices = remaining.map(place => ({ place, ...bestInsertion(state.order, place, travel) }));
      const best = choices.reduce((a, b) => a.extra <= b.extra ? a : b);
      state = { order: withPlace(state.order, best.place, best.position), minutes: state.minutes + best.extra };
      remaining.splice(remaining.indexOf(best.place), 1);
    }
    return state;
  }

  function planTrip(from, to, { criterion = "fastest", tags = [], required = [], extraMinutes = 60, day = today() } = {}) {
    if (!from || !to || pointId(from) === pointId(to)) return null;
    const travelCache = new Map();
    const travel = (a, b) => {
      const key = `${pointId(a)}|${pointId(b)}`;
      if (!travelCache.has(key)) travelCache.set(key, chooseTravel(a, b, criterion));
      return travelCache.get(key);
    };
    const direct = travel(from, to);
    const pins = [...new Set(required)].filter(place =>
      onMap(place) && canVisit(place, day) && place !== from && place !== to);
    const initial = arrangeRequired(from, to, pins, travel, direct.minutes);
    initial.interests = 0;
    initial.value = 0;
    tags.forEach((tag, index) => {
      if (pins.some(place => matchesTag(place, tag, day))) initial.interests |= 1 << index;
    });
    const maxMinutes = direct.minutes + extraMinutes;
    const candidates = tags.length
      ? places.filter(place => place !== from && place !== to && onMap(place) && canVisit(place, day) && !pins.includes(place))
      : [];
    const { order, minutes } = chooseVisits(initial, candidates, tags, travel, maxMinutes, day);
    const visits = order.slice(1, -1);
    const legs = [];
    const stationCodes = new Set();
    let stops = 0;
    let transfers = 0;

    function addWalk(a, b) {
      const leg = walkBetween(a, b);
      if (leg.minutes > 0) legs.push(leg);
    }

    for (let i = 1; i < order.length; i += 1) {
      const a = order[i - 1];
      const b = order[i];
      if (a.code) stationCodes.add(a.code);
      if (b.code) stationCodes.add(b.code);
      const choice = travel(a, b);
      if (choice.board) {
        addWalk(a, choice.board);
        const rail = findRoute(choice.board.code, choice.leave.code, { criterion });
        legs.push(...rail.legs);
        rail.stopCodes.forEach(code => stationCodes.add(code));
        stops += rail.stops;
        transfers += rail.transfers;
        addWalk(choice.leave, b);
      } else {
        addWalk(a, b);
      }
      if (i < order.length - 1) legs.push({ type: "visit", place: b, index: i });
    }

    return {
      from: pointId(from), to: pointId(to), legs, minutes, stops, transfers,
      stopCodes: stationCodes, visits,
      points: [...order, ...[...stationCodes].map(code => window.BangkokRail.stationByCode.get(code))],
      extraMinutes: Math.max(0, minutes - direct.minutes),
      overBudget: initial.minutes > maxMinutes + 1e-7,
      missingTags: tags.filter(tag => !visits.some(place => matchesTag(place, tag, day)))
    };
  }

  window.BangkokOutings = { planTrip, pointId };
})();
