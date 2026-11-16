"use strict";

(function startPlanner() {
  const { lines, stations, stationByCode, searchStations, nearestStation, findRoute } = window.BangkokRail;
  const byId = id => document.getElementById(id);
  const escapeText = value => String(value).replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const icon = type => `<svg class="icon" aria-hidden="true"><use href="#i-${type}"/></svg>`;
  const lineName = line => line.id === "airport" ? line.name : `${line.system} ${line.name}`;
  const dot = line => `<i class="station-dot" style="--route-color:${line.color}" aria-hidden="true"></i>`;
  const badge = (line, name = lineName(line)) => `<span class="line-badge">${dot(line)}${escapeText(name)}</span>`;
  const pluralRules = new Intl.PluralRules("ru");
  const plural = (count, one, few, many) => ({ one, few, many }[pluralRules.select(count)] ?? many);
  const compact = matchMedia("(max-width: 780px)");
  const form = byId("route-form");
  const itinerary = byId("itinerary");
  const examples = byId("examples");
  const stationCard = byId("station-card");
  const layers = byId("layers-panel");
  const layersToggle = byId("layers-toggle");
  const locationButton = byId("locate");
  const locationHint = byId("location-hint");
  const error = byId("form-error");
  const notification = byId("notification");
  const about = byId("about");
  const endpoints = { from: null, to: null };
  const visibleLines = new Set(lines.map(line => line.id));
  const fields = ["from", "to"].map(key => {
    const input = byId(key);
    return {
      key, input, field: input.closest(".field"), list: byId(`${key}-options`),
      clear: input.parentElement.querySelector(".field-clear"), matches: [], active: -1
    };
  });

  let selectedStation = null;
  let route = null;
  let criterion = "fastest";
  let closest = null;
  let notificationTimer;
  let locationPending = false;

  const map = new window.RailMap({
    canvas: byId("map-canvas"),
    scale: byId("scale"),
    onClick: station => {
      if (!layers.hidden) toggleLayers(false);
      if (selectedStation === station) closeStation();
      else showStation(station);
    },
    onView: placeStationCard
  });

  function scrollToSection(element) {
    if (!compact.matches) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    element.scrollIntoView({ block: "start", behavior });
  }

  function setError(message = "", key = null) {
    error.textContent = message;
    error.hidden = !message;
    for (const field of fields) field.input.setAttribute("aria-invalid", String(field.key === key));
  }

  function notify(message) {
    clearTimeout(notificationTimer);
    notification.hidden = false;
    notification.textContent = message;
    notificationTimer = setTimeout(() => { notification.hidden = true; }, 4400);
  }

  function updateMap() {
    map.setState({ visibleLines, endpoints, route, activeStation: selectedStation?.code ?? null });
    byId("fit-route").hidden = !route;
  }

  function hideOptions(field) {
    field.list.hidden = true;
    field.input.setAttribute("aria-expanded", "false");
    field.input.removeAttribute("aria-activedescendant");
    field.active = -1;
  }

  function renderOptions(field) {
    for (const other of fields) if (other !== field) hideOptions(other);
    const query = endpoints[field.key] ? "" : field.input.value;
    field.matches = searchStations(query);
    field.active = -1;
    field.input.removeAttribute("aria-activedescendant");
    field.list.innerHTML = field.matches.map((station, index) => {
      const displayLines = station.lines.map(lineName).join(" / ");
      return `<li class="option" role="option" aria-selected="false" id="${field.key}-choice-${index}" data-code="${station.code}">
        ${dot(station.lines[0])}
        <span class="option-copy"><strong>${escapeText(station.name)}</strong><small>${escapeText(displayLines)} · <span lang="th">${escapeText(station.thai)}</span></small></span>
        <span class="option-code">${station.code}</span>
      </li>`;
    }).join("") || '<li class="option-empty" role="presentation">Станция не найдена. Попробуйте название на английском, тайском или код.</li>';
    field.list.hidden = false;
    field.input.setAttribute("aria-expanded", "true");
  }

  function markOption(field, next) {
    const elements = [...field.list.querySelectorAll('[role="option"]')];
    if (!elements.length) return;
    const index = (next + elements.length) % elements.length;
    field.active = index;
    for (const [i, option] of elements.entries()) option.setAttribute("aria-selected", String(i === index));
    const current = elements[index];
    field.input.setAttribute("aria-activedescendant", current.id);
    current.scrollIntoView({ block: "nearest" });
  }

  function setEndpoint(key, code, focusMap = false) {
    endpoints[key] = code;
    const field = fields.find(field => field.key === key);
    const station = stationByCode.get(code);
    field.input.value = station?.name ?? "";
    field.clear.hidden = !field.input.value;
    hideOptions(field);
    setError();
    resetItinerary();
    if (route) {
      fitRoute();
    } else if (station) {
      closeStation();
      if (focusMap) map.focus(station, 14.65);
    }
  }

  for (const field of fields) {
    field.input.addEventListener("focus", () => renderOptions(field));
    field.input.addEventListener("click", () => {
      if (field.list.hidden) renderOptions(field);
    });
    field.input.addEventListener("input", () => {
      endpoints[field.key] = null;
      field.clear.hidden = !field.input.value;
      setError();
      resetItinerary();
      renderOptions(field);
    });
    field.input.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Escape" && !field.list.hidden) {
        event.stopPropagation();
        hideOptions(field);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (field.list.hidden) renderOptions(field);
        const step = event.key === "ArrowDown" ? 1 : -1;
        markOption(field, field.active === -1 && step < 0 ? field.matches.length - 1 : field.active + step);
      } else if (event.key === "Enter" && !field.list.hidden && field.matches.length > 0 &&
                 (field.active !== -1 || (!endpoints[field.key] && field.input.value.trim()))) {
        event.preventDefault();
        const station = field.matches[Math.max(0, field.active)];
        setEndpoint(field.key, station.code, true);
      }
    });
    field.field.addEventListener("focusout", event => {
      if (field.field.contains(event.relatedTarget)) return;
      window.setTimeout(() => {
        if (!field.field.contains(document.activeElement)) hideOptions(field);
      }, 120);
    });
    field.list.addEventListener("mousedown", event => event.preventDefault());
    field.list.addEventListener("click", event => {
      const option = event.target.closest("[data-code]");
      if (!option) return;
      setEndpoint(field.key, option.dataset.code, true);
      if (compact.matches) field.input.blur();
    });
    field.clear.addEventListener("click", () => {
      setEndpoint(field.key, null);
      field.input.focus();
      renderOptions(field);
    });
  }

  function closeStation() {
    selectedStation = null;
    stationCard.hidden = true;
    map.setState({ activeStation: null });
  }

  function showStation(station) {
    if (!station) {
      closeStation();
      return;
    }
    selectedStation = station;
    map.setState({ activeStation: station.code });
    const connections = station.connections.map(other => `<button class="transfer-link" type="button" data-station="${other.code}" title="${escapeText(other.lines.map(lineName).join(", "))}">${escapeText(other.name)} · ${other.code}</button>`).join("");
    const mainBadges = station.lines.map(line => badge(line)).join("");
    stationCard.innerHTML = `
      <button class="button-icon" type="button" data-action="close" aria-label="Закрыть карточку станции">${icon("clear")}</button>
      <div class="line-badges">${mainBadges}</div>
      <h2>${escapeText(station.name)}</h2>
      <p><b>${station.code}</b> · <span lang="th">${escapeText(station.thai)}</span></p>
      ${connections ? `<div class="station-connections">${icon("transfer")}${connections}</div>` : ""}
      <div class="station-actions">
        <button type="button" data-action="from">Отсюда</button>
        <button type="button" data-action="to">Сюда</button>
        <button class="station-detail" type="button" data-action="detail" aria-label="Приблизить улицы рядом со станцией" title="Улицы рядом">${icon("plus")}</button>
      </div>`;
    stationCard.hidden = false;
    placeStationCard();
  }

  stationCard.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !selectedStation) return;
    const action = button.dataset.action;
    if (button.dataset.station) {
      const station = stationByCode.get(button.dataset.station);
      map.focus(station, Math.max(map.zoom, 14.25));
      showStation(station);
    } else if (action === "close") closeStation();
    else if (action === "detail") map.focus(selectedStation, Math.max(16.1, map.zoom));
    else if (action === "from" || action === "to") {
      const station = selectedStation;
      setEndpoint(action, station.code);
      notify(`${action === "from" ? "Откуда" : "Куда"} — ${station.name}`);
    }
  });

  function placeStationCard() {
    if (!selectedStation || stationCard.hidden) return;
    const { x, y } = map.stationScreen(selectedStation);
    const visible = x >= -10 && y >= -10 && x <= map.width + 10 && y <= map.height + 10;
    stationCard.style.visibility = visible ? "visible" : "hidden";
    if (!visible) return;
    const margin = 10;
    const width = stationCard.offsetWidth;
    const height = stationCard.offsetHeight;
    const left = Math.min(Math.max(margin, x - width / 2), map.width - width - margin);
    const top = y - height - 16 >= 63 ? y - height - 16 : y + 16;
    stationCard.style.left = `${left}px`;
    stationCard.style.top = `${Math.min(Math.max(62, top), map.height - height - 25)}px`;
  }

  function refreshRoute() {
    const { from, to } = endpoints;
    route = from && to && from !== to ? findRoute(from, to, { criterion }) : null;
    updateMap();
  }

  function resetItinerary() {
    itinerary.hidden = true;
    itinerary.replaceChildren();
    examples.hidden = false;
    refreshRoute();
  }

  function resolveEndpoint(field) {
    if (endpoints[field.key]) return endpoints[field.key];
    const query = field.input.value.trim().toLowerCase();
    if (!query) return null;
    const matches = searchStations(query).filter(station =>
      station.code.toLowerCase() === query || station.name.toLowerCase() === query || station.thai === query);
    return matches.length === 1 ? matches[0].code : null;
  }

  function fitRoute() {
    if (!route) return;
    closeStation();
    map.fit([...route.stopCodes].map(code => stationByCode.get(code)));
  }

  function buildRoute({ scroll = true } = {}) {
    for (const field of fields) {
      const code = resolveEndpoint(field);
      if (!code) {
        const end = field.key === "from" ? "отправления" : "назначения";
        setError(`Выберите станцию ${end} из списка или на карте.`, field.key);
        field.input.focus();
        renderOptions(field);
        return false;
      }
      endpoints[field.key] = code;
      field.input.value = stationByCode.get(code).name;
      field.clear.hidden = false;
      hideOptions(field);
    }
    if (endpoints.from === endpoints.to) {
      setError("Выберите разные станции отправления и назначения.", "to");
      return false;
    }
    refreshRoute();
    if (!route) {
      setError("Для этой пары станций маршрут не найден.");
      return false;
    }
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    notification.hidden = true;
    setError();
    renderItinerary();
    examples.hidden = true;
    itinerary.hidden = false;
    fitRoute();
    if (scroll) requestAnimationFrame(() => scrollToSection(itinerary));
    return true;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    buildRoute();
  });

  byId("swap").addEventListener("click", () => {
    [endpoints.from, endpoints.to] = [endpoints.to, endpoints.from];
    const [from, to] = fields;
    [from.input.value, to.input.value] = [to.input.value, from.input.value];
    for (const field of fields) {
      field.clear.hidden = !field.input.value;
      hideOptions(field);
    }
    setError();
    if (itinerary.hidden) {
      refreshRoute();
      fitRoute();
    } else {
      buildRoute({ scroll: false });
    }
  });

  examples.addEventListener("click", event => {
    const button = event.target.closest(".example");
    if (!button) return;
    setEndpoint("from", button.dataset.from);
    setEndpoint("to", button.dataset.to);
    buildRoute();
  });

  function renderRide(leg) {
    const last = leg.stations.length - 1;
    const stops = leg.stations.map((station, index) => `
      <li class="trip-stop${index === 0 || index === last ? " is-endpoint" : ""}" style="--route-color:${leg.line.color}">
        <span class="stop-rail" aria-hidden="true"></span>
        <button type="button" data-stop="${station.code}" aria-label="${escapeText(station.name)} на карте">
          <span>${escapeText(station.name)}</span><code>${station.code}</code>
        </button>
      </li>`).join("");
    const line = leg.run === "pink-impact" ? "MRT Pink · IMPACT" : lineName(leg.line);
    return `<li class="ride-step">
      <div class="ride-head">${badge(leg.line, line)}<span class="ride-direction">в сторону ${escapeText(leg.direction.name)}</span></div>
      <ol class="stop-list">${stops}</ol>
    </li>`;
  }

  function renderTransfer(leg) {
    let name = leg.from.name;
    if (leg.from.code !== leg.to.code) {
      name = leg.from.name === leg.to.name
        ? `${name} (${leg.from.code} → ${leg.to.code})`
        : `${name} → ${leg.to.name}`;
    }
    return `<li class="transfer-step">
      <div>${icon("transfer")}<strong>${route.stops ? "Пересадка" : "Пеший переход"}</strong><span>· около ${leg.walking} мин пешком</span></div>
      <p>${escapeText(name)}</p>
    </li>`;
  }

  function renderItinerary() {
    const times = `≈ ${Math.round(route.minutes)} мин`;
    const stops = `${route.stops} ${plural(route.stops, "остановка", "остановки", "остановок")}`;
    const transfers = `${route.transfers} ${plural(route.transfers, "пересадка", "пересадки", "пересадок")}`;
    itinerary.innerHTML = `
      <div class="itinerary-heading"><h2>Маршрут</h2><button class="text-button" type="button" data-action="map">${icon("fit")} На карте</button></div>
      <div class="trip-summary" aria-live="polite">
        <span>${icon("clock")}<b>${times}</b></span>
        ${route.stops ? `<span>${icon("train")}${stops}</span><span>${icon("transfer")}${transfers}</span>` : "<span>Пешком</span>"}
      </div>
      ${route.stops ? `<p class="trip-note">Примерное время с ожиданием и переходами</p>
      <div class="criterion" role="group" aria-label="Как подобрать маршрут">
        <button aria-pressed="${criterion === "fastest"}" data-criterion="fastest" type="button">Быстрее</button>
        <button aria-pressed="${criterion === "fewest-transfers"}" data-criterion="fewest-transfers" type="button">Меньше пересадок</button>
      </div>` : ""}
      <ol class="trip-steps">${route.legs.map(leg => leg.type === "ride" ? renderRide(leg) : renderTransfer(leg)).join("")}</ol>`;
  }

  itinerary.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.criterion && criterion !== button.dataset.criterion) {
      criterion = button.dataset.criterion;
      if (buildRoute({ scroll: false })) itinerary.querySelector(`[data-criterion="${criterion}"]`)?.focus({ preventScroll: true });
    } else if (button.dataset.stop) {
      const station = stationByCode.get(button.dataset.stop);
      map.focus(station);
      showStation(station);
      scrollToSection(byId("map"));
    } else if (button.dataset.action === "map") {
      fitRoute();
      scrollToSection(byId("map"));
    }
  });

  function updateLayers() {
    const count = visibleLines.size;
    layersToggle.querySelector("span").textContent = count === lines.length
      ? "Все линии"
      : `${count} ${plural(count, "линия", "линии", "линий")}`;
    for (const box of layers.querySelectorAll("input")) box.checked = visibleLines.has(box.value);
    updateMap();
  }

  function toggleLayers(open) {
    layers.hidden = !open;
    layersToggle.setAttribute("aria-expanded", String(open));
  }

  layers.innerHTML = '<button class="show-all" type="button">Показать все линии</button>' + lines.map(line =>
    `<label class="layer-option">${dot(line)}${escapeText(lineName(line))}<input type="checkbox" value="${line.id}" checked></label>`).join("");
  layers.querySelector(".show-all").addEventListener("click", () => {
    for (const line of lines) visibleLines.add(line.id);
    updateLayers();
  });
  layers.addEventListener("change", event => {
    const box = event.target;
    if (box.checked) visibleLines.add(box.value);
    else visibleLines.delete(box.value);
    updateLayers();
  });
  layersToggle.addEventListener("click", () => toggleLayers(layers.hidden));
  document.addEventListener("pointerdown", event => {
    if (!layersToggle.parentElement.contains(event.target)) toggleLayers(false);
    for (const field of fields) if (!field.field.contains(event.target)) hideOptions(field);
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || about.open) return;
    if (!layers.hidden) {
      toggleLayers(false);
      layersToggle.focus();
    } else if (selectedStation) closeStation();
  });

  byId("zoom-in").addEventListener("click", () => map.zoomBy(0.85));
  byId("zoom-out").addEventListener("click", () => map.zoomBy(-0.85));
  byId("fit-network").addEventListener("click", () => {
    closeStation();
    const showing = stations.filter(station => station.lines.some(line => visibleLines.has(line.id)));
    map.fit(showing.length ? showing : stations, 13);
  });
  byId("fit-route").addEventListener("click", fitRoute);

  function showLocation(position) {
    const { latitude, longitude, accuracy } = position.coords;
    const point = { lat: latitude, lng: longitude, accuracy };
    closest = nearestStation(point);
    if (closest.distance > 12000) {
      map.setState({ location: null });
      locationHint.hidden = true;
      notify("Ваше местоположение за пределами сети Бангкока.");
      return;
    }
    map.setState({ location: point });
    closeStation();
    const meters = closest.distance;
    const distance = meters >= 1000 ? `${(meters / 1000).toFixed(1).replace(".", ",")} км` : `${Math.max(10, Math.round(meters / 10) * 10)} м`;
    locationHint.innerHTML = `<button type="button" title="Выбрать ближайшую станцию как отправление">${icon("locate")}<span>Ближайшая — <b>${escapeText(closest.station.name)}</b><br>${distance} по прямой · выбрать</span></button>`;
    locationHint.hidden = false;
    const station = closest.station;
    if (meters > 900) map.fit([point, station], 14.25);
    else map.focus(point, 15.1);
    scrollToSection(byId("map"));
    notify(`Позиция найдена. Ближайшая станция — ${station.name}.`);
  }

  locationHint.addEventListener("click", () => {
    if (closest) setEndpoint("from", closest.station.code, true);
  });

  function finishLocating() {
    locationPending = false;
    locationButton.removeAttribute("aria-busy");
  }

  locationButton.addEventListener("click", () => {
    if (locationPending) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      notify("Для геолокации откройте страницу по HTTPS в Safari.");
      return;
    }
    locationPending = true;
    locationButton.setAttribute("aria-busy", "true");
    notify("Определяем местоположение…");
    navigator.geolocation.getCurrentPosition(position => {
      finishLocating();
      showLocation(position);
    }, failure => {
      finishLocating();
      notify(failure.code === 1
        ? "Разрешите доступ к геопозиции в настройках сайта Safari и попробуйте снова."
        : "Не удалось определить местоположение. Попробуйте ещё раз.");
    }, { enableHighAccuracy: true, timeout: 12000 });
  });

  byId("about-open").addEventListener("click", () => {
    if (typeof about.showModal === "function") about.showModal();
    else about.setAttribute("open", "");
  });
  byId("about-close").addEventListener("click", () => {
    if (typeof about.close === "function") about.close();
    else about.removeAttribute("open");
  });

  byId("network-count").textContent = `${lines.length} линий · ${stations.length} ${plural(stations.length, "станция", "станции", "станций")}`;
  document.querySelector(".network-lines").innerHTML = ["#6c9e31", "#2259b3", "#cf527f"]
    .map((color, index) => `<i style="--route-color:${color};--sample-width:${21 - index * 3}px"></i>`).join("");
  updateMap();
})();
