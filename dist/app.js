"use strict";

(function startPlanner() {
  const { lines, stations, stationByCode, searchStations, nearestStation } = window.BangkokRail;
  const { tags, tagById, placeById, searchPlaces, onMap, canVisit, today, mapsLink, saveAnnotation } = window.BangkokPlaces;
  const { planTrip, pointId } = window.BangkokOutings;
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
  const railToggle = byId("rail-toggle");
  const fitNetwork = byId("fit-network");
  const locationButton = byId("locate");
  const locationHint = byId("location-hint");
  const error = byId("form-error");
  const notification = byId("notification");
  const about = byId("about");
  const viaSettings = byId("via-settings");
  const viaTags = byId("via-tags");
  const viaLimit = byId("via-limit");
  const catalogSearch = byId("place-search");
  const catalogList = byId("catalog-list");
  const editor = byId("place-editor");
  const endpoints = { from: null, to: null };
  const visibleLines = new Set(lines.map(line => line.id));
  const selectedTags = new Set();
  const pinned = new Set();
  let railVisible = true;
  const fields = ["from", "to"].map(key => {
    const input = byId(key);
    return {
      key, input, field: input.closest(".field"), list: byId(`${key}-options`),
      clear: input.parentElement.querySelector(".field-clear"), matches: [], active: -1
    };
  });

  let selectedPoint = null;
  let route = null;
  let criterion = "fastest";
  let closest = null;
  let userLocation = null;
  let notificationTimer;
  let locationPending = false;
  let catalogOpen = false;
  let catalogTag = null;
  let catalogMatches = [];
  let catalogLimit = 30;
  let editing = null;
  let draft = null;

  function pointById(id) {
    return id === "here" ? userLocation : stationByCode.get(id) ?? placeById.get(id);
  }

  function placeColor(place) {
    return place.color || tagById.get(place.biennale ? "biennale" : place.category).color;
  }

  const map = new window.RailMap({
    canvas: byId("map-canvas"),
    scale: byId("scale"),
    onClick: point => {
      if (!layers.hidden) toggleLayers(false);
      if (point?.cluster) {
        if (map.zoom < 16.8) {
          closePoint();
          const first = point.cluster[0];
          map.focus(first, Math.min(17.25, map.zoom + 1.65));
        } else {
          showCluster(point.cluster);
        }
      } else if (selectedPoint === point) closePoint();
      else showPoint(point);
    },
    onView: positionPointCard
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
    const visiblePlaces = catalogOpen ? catalogMatches.filter(onMap) : [...pinned];
    map.setState({
      visibleLines, railVisible, endpoints, route,
      endpointPoints: [pointById(endpoints.from), pointById(endpoints.to)],
      activeStation: selectedPoint?.code ?? null,
      activePlace: selectedPoint?.id && selectedPoint.id !== "here" ? selectedPoint : null,
      placeMarkers: visiblePlaces
    });
    const focusButton = byId("fit-route");
    focusButton.hidden = catalogOpen ? !visiblePlaces.length : !route;
    focusButton.querySelector("span").textContent = catalogOpen ? "К местам" : "К маршруту";
  }

  function hideOptions(field) {
    field.list.hidden = true;
    field.input.setAttribute("aria-expanded", "false");
    field.input.removeAttribute("aria-activedescendant");
    field.active = -1;
  }

  function searchPoints(query) {
    const key = query.trim().toLowerCase();
    const metro = searchStations(query);
    const places = key ? searchPlaces(query).filter(onMap).slice(0, 5) : [];
    const matches = [...metro, ...places];
    if (userLocation && (!key || userLocation.name.toLowerCase().includes(key))) matches.unshift(userLocation);
    const score = point => {
      if (!key) return 0;
      const name = point.name.toLowerCase();
      if (name === key || point.code?.toLowerCase() === key) return 0;
      return name.startsWith(key) ? 1 : 2;
    };
    return matches.sort((a, b) => score(a) - score(b)).slice(0, 10);
  }

  function renderOptions(field) {
    for (const other of fields) if (other !== field) hideOptions(other);
    const query = endpoints[field.key] ? "" : field.input.value;
    field.matches = searchPoints(query);
    field.active = -1;
    field.input.removeAttribute("aria-activedescendant");
    field.list.innerHTML = field.matches.map((point, index) => {
      const color = point.lines?.[0].color ?? (point.id === "here" ? "#2878d0" : placeColor(point));
      const description = point.code
        ? `${escapeText(point.lines.map(lineName).join(" / "))} · <span lang="th">${escapeText(point.thai)}</span>`
        : point.id === "here" ? "Геолокация" : escapeText(tagById.get(point.category).label);
      return `<li class="option" role="option" aria-selected="false" id="${field.key}-choice-${index}" data-code="${pointId(point)}">
        ${dot({ color })}
        <span class="option-copy"><strong>${escapeText(point.name)}</strong><small>${description}</small></span>
        ${point.code ? `<span class="option-code">${point.code}</span>` : ""}
      </li>`;
    }).join("") || '<li class="option-empty" role="presentation">Ничего не найдено. Попробуйте другое название или код станции.</li>';
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
    const point = pointById(code);
    field.input.value = point?.name ?? "";
    field.clear.hidden = !field.input.value;
    hideOptions(field);
    setError();
    if (pinned.delete(point)) renderVia();
    resetItinerary();
    if (route) {
      fitRoute();
    } else if (point) {
      closePoint();
      if (focusMap) map.focus(point, 14.65);
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
        const point = field.matches[Math.max(0, field.active)];
        setEndpoint(field.key, pointId(point), true);
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

  function closePoint() {
    selectedPoint = null;
    stationCard.hidden = true;
    map.setState({ activeStation: null, activePlace: null });
  }

  function showPoint(point) {
    if (!point) {
      closePoint();
      return;
    }
    selectedPoint = point;
    map.setState({ activeStation: point.code ?? null, activePlace: point.code ? null : point });
    stationCard.classList.toggle("place-card", !point.code);
    stationCard.innerHTML = point.code ? stationDetails(point) : placeDetails(point);
    stationCard.hidden = false;
    positionPointCard();
  }

  function stationDetails(station) {
    const connections = station.connections.map(other => `<button class="transfer-link" type="button" data-station="${other.code}" title="${escapeText(other.lines.map(lineName).join(", "))}">${escapeText(other.name)} · ${other.code}</button>`).join("");
    const mainBadges = station.lines.map(line => badge(line)).join("");
    return `
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
  }

  const dateLabel = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", timeZone: "UTC" });

  function placeDetails(place) {
    const category = tagById.get(place.category);
    const badges = badge(category, category.label) +
      (place.biennale ? badge(tagById.get("biennale"), "Биеннале") : "");
    const date = today();
    const event = place.event ?? place.biennale;
    let timing = "";
    if (event?.pending) timing = "Выставка на этой площадке готовится";
    else if (event && date > event.end) timing = "Событие завершилось";
    else if (event && date < event.start) timing = `С ${dateLabel.format(new Date(event.start))}`;
    else if (event) timing = `До ${dateLabel.format(new Date(event.end))}`;
    const stars = place.stars ? `<span class="place-stars" aria-label="${place.stars} из 5">${"★".repeat(place.stars)}</span>` : "";
    return `
      <button class="button-icon" type="button" data-action="close" aria-label="Закрыть карточку места">${icon("clear")}</button>
      <div class="line-badges">${badges}${stars}</div>
      <h2>${escapeText(place.name)}</h2>
      ${place.address || timing ? `<p>${[place.address, timing].filter(Boolean).map(escapeText).join(" · ")}</p>` : ""}
      ${place.note ? `<p class="place-note">${escapeText(place.note)}</p>` : ""}
      ${place.personalNote ? `<p class="personal-note">${escapeText(place.personalNote)}</p>` : ""}
      <div class="place-links">
        <a href="${mapsLink(place)}" target="_blank" rel="noopener">Google Maps</a>
        ${place.url ? `<a href="${escapeText(place.url)}" target="_blank" rel="noopener">О месте</a>` : ""}
        <button class="text-button" type="button" data-action="edit">${icon("edit")} Мои отметки</button>
      </div>
      <div class="station-actions">
        <button type="button" data-action="from">Отсюда</button>
        <button type="button" data-action="to">Сюда</button>
        ${canVisit(place) ? `<button type="button" data-action="pin" aria-pressed="${pinned.has(place)}">${pinned.has(place) ? "Убрать остановку" : "Заехать по пути"}</button>` : ""}
      </div>`;
  }

  function showCluster(places) {
    showPoint(places[0]);
    stationCard.innerHTML = `
      <button class="button-icon" type="button" data-action="close" aria-label="Закрыть список мест">${icon("clear")}</button>
      <h2>Места рядом</h2>
      <div class="station-connections">${places.map(place =>
        `<button class="transfer-link" type="button" data-nearby="${place.id}">${escapeText(place.name)}</button>`).join("")}</div>`;
    positionPointCard();
  }

  stationCard.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !selectedPoint) return;
    const action = button.dataset.action;
    if (button.dataset.nearby) showPoint(placeById.get(button.dataset.nearby));
    else if (button.dataset.station) {
      const station = stationByCode.get(button.dataset.station);
      map.focus(station, Math.max(map.zoom, 14.25));
      showPoint(station);
    } else if (action === "close") closePoint();
    else if (action === "detail") map.focus(selectedPoint, Math.max(16.1, map.zoom));
    else if (action === "edit") editPlace(selectedPoint);
    else if (action === "pin") {
      togglePin(selectedPoint);
      showPoint(selectedPoint);
    } else if (action === "from" || action === "to") {
      const point = selectedPoint;
      setEndpoint(action, pointId(point));
      if (catalogOpen) switchPanel(false);
      notify(`${action === "from" ? "Откуда" : "Куда"} — ${point.name}`);
    }
  });

  function positionPointCard() {
    if (!selectedPoint || stationCard.hidden) return;
    const { x, y } = map.pointScreen(selectedPoint);
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
    route = planTrip(pointById(from), pointById(to), {
      criterion, tags: [...selectedTags], required: [...pinned], extraMinutes: Number(viaLimit.value)
    });
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
    const matches = searchPoints(query).filter(point =>
      point.code?.toLowerCase() === query || point.name.toLowerCase() === query || point.thai === query);
    return matches.length === 1 ? pointId(matches[0]) : null;
  }

  function fitRoute() {
    if (!route) return;
    closePoint();
    map.fit(route.points);
  }

  function buildRoute({ scroll = true } = {}) {
    for (const field of fields) {
      const code = resolveEndpoint(field);
      if (!code) {
        const end = field.key === "from" ? "отправления" : "назначения";
        setError(`Выберите точку ${end} из списка или на карте.`, field.key);
        field.input.focus();
        renderOptions(field);
        return false;
      }
      endpoints[field.key] = code;
      field.input.value = pointById(code).name;
      field.clear.hidden = false;
      hideOptions(field);
    }
    if (endpoints.from === endpoints.to) {
      setError("Выберите разные точки начала и конца маршрута.", "to");
      return false;
    }
    refreshRoute();
    if (!route) {
      setError("Между выбранными точками маршрут не найден.");
      return false;
    }
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    notification.hidden = true;
    setError();
    renderItinerary();
    examples.hidden = true;
    itinerary.hidden = false;
    if (scroll) viaSettings.open = false;
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

  function timeText(minutes) {
    const rounded = Math.round(minutes);
    return rounded >= 60
      ? `${Math.floor(rounded / 60)} ч${rounded % 60 ? ` ${rounded % 60} мин` : ""}`
      : `${rounded} мин`;
  }

  function renderVisitCard(place, index) {
    return `<button type="button" class="visit-card" data-visit="${place.id}">
      <span class="visit-number" style="background:${placeColor(place)}">${index}</span>
      <span class="visit-name">${escapeText(place.name)}</span><small>≈ ${timeText(place.minutes)}</small>
    </button>`;
  }

  function renderLeg(leg) {
    if (leg.type === "ride") return renderRide(leg);
    if (leg.type === "transfer") return renderTransfer(leg);
    if (leg.type === "visit") return `<li>${renderVisitCard(leg.place, leg.index)}</li>`;
    const origin = encodeURIComponent(leg.from.lat + "," + leg.from.lng);
    const destination = encodeURIComponent(leg.to.lat + "," + leg.to.lng);
    const directions = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
    return `<li class="walk-step"><strong>Пешком · ≈ ${timeText(leg.minutes)}</strong>
      <span>${escapeText(leg.from.name)} → ${escapeText(leg.to.name)}</span>
      <a href="${directions}" target="_blank" rel="noopener" class="text-button">Путь пешком</a>
    </li>`;
  }

  function renderItinerary() {
    const times = `≈ ${timeText(route.minutes)}`;
    const stops = `${route.stops} ${plural(route.stops, "остановка", "остановки", "остановок")}`;
    const transfers = `${route.transfers} ${plural(route.transfers, "пересадка", "пересадки", "пересадок")}`;
    const count = route.visits.length;
    const tour = count ? `<span>${icon("pin")}${count} ${plural(count, "место", "места", "мест")}</span>` : "";
    const details = `<ol class="trip-steps">${route.legs.map(renderLeg).join("")}</ol>`;
    const missing = route.missingTags.map(tag => `«${tagById.get(tag).label}»`).join(", ");
    const note = route.overBudget
      ? `Закреплённые места требуют ≈ ${timeText(route.extraMinutes)} сверх прямой поездки.`
      : missing ? `Пропущены категории ${missing}.` : "";
    itinerary.innerHTML = `
      <div class="itinerary-heading"><h2>Маршрут</h2><button class="text-button" type="button" data-action="map">${icon("fit")} На карте</button></div>
      <div class="trip-summary" aria-live="polite">
        <span>${icon("clock")}<b>${times}</b></span>
        ${count ? `${tour}<span>+ ${timeText(route.extraMinutes)} к поездке</span>`
          : route.stops ? `<span>${icon("train")}${stops}</span><span>${icon("transfer")}${transfers}</span>` : "<span>Пешком</span>"}
      </div>
      <p class="trip-note">${count ? "Время включает ожидание поездов, пешие участки и посещения." : "Примерное время с ожиданием и переходами"}</p>
      ${note ? `<p class="trip-via-note">${escapeText(note)}</p>` : ""}
      ${count ? `<ol class="visit-list">${route.visits.map((place, index) => `<li>${renderVisitCard(place, index + 1)}</li>`).join("")}</ol>` : ""}
      ${route.stops ? `
      <div class="criterion" role="group" aria-label="Как подобрать маршрут">
        <button aria-pressed="${criterion === "fastest"}" data-criterion="fastest" type="button">Быстрее</button>
        <button aria-pressed="${criterion === "fewest-transfers"}" data-criterion="fewest-transfers" type="button">Меньше пересадок</button>
      </div>` : ""}
      ${count ? `<details class="trip-details"><summary>Поезда и пешие участки</summary>${details}</details>` : details}`;
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
      showPoint(station);
      scrollToSection(byId("map"));
    } else if (button.dataset.visit) {
      revealPlace(placeById.get(button.dataset.visit));
    } else if (button.dataset.action === "map") {
      fitRoute();
      scrollToSection(byId("map"));
    }
  });

  function tagButton(tag, pressed) {
    return `<button type="button" class="tag-button" data-tag="${tag.id}" aria-pressed="${pressed}">${tag.color ? dot(tag) : ""}${escapeText(tag.label)}</button>`;
  }

  function renderVia() {
    for (const button of viaTags.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(selectedTags.has(button.dataset.tag)));
    }
    const parts = [];
    if (selectedTags.size) parts.push(`${selectedTags.size} ${plural(selectedTags.size, "категория", "категории", "категорий")}`);
    if (pinned.size) parts.push(`${pinned.size} ${plural(pinned.size, "остановка", "остановки", "остановок")}`);
    byId("via-summary").textContent = parts.join(" · ");
    const list = byId("pinned-places");
    list.hidden = !pinned.size;
    list.innerHTML = [...pinned].map(place => `<button type="button" data-remove="${place.id}" aria-label="Убрать ${escapeText(place.name)} из маршрута">
      <span>${escapeText(place.name)}</span>${icon("clear")}</button>`).join("");
  }

  function updateTrip(fit = false) {
    refreshRoute();
    if (route && !itinerary.hidden) renderItinerary();
    if (route && fit) fitRoute();
  }

  function togglePin(place) {
    if (!onMap(place) || !canVisit(place)) return;
    if (Object.values(endpoints).includes(place.id)) {
      notify("Это место уже выбрано как начало или конец.");
      return;
    }
    if (pinned.has(place)) pinned.delete(place);
    else {
      pinned.add(place);
      viaSettings.open = true;
      notify("Остановка добавлена в маршрут.");
    }
    renderVia();
    updateTrip();
    if (catalogOpen) renderCatalog();
  }

  viaTags.innerHTML = tags.map(tag => tagButton(tag, false)).join("");
  viaTags.addEventListener("click", event => {
    const tag = event.target.closest("[data-tag]")?.dataset.tag;
    if (!tag) return;
    if (selectedTags.has(tag)) selectedTags.delete(tag);
    else selectedTags.add(tag);
    renderVia();
    updateTrip(true);
  });
  viaLimit.addEventListener("change", () => updateTrip(true));
  byId("pinned-places").addEventListener("click", event => {
    const id = event.target.closest("[data-remove]")?.dataset.remove;
    if (id) togglePin(placeById.get(id));
  });

  function renderCatalog() {
    const day = today();
    catalogMatches = searchPlaces(catalogSearch.value, catalogTag);
    byId("catalog-count").textContent = catalogMatches.length
      ? `${catalogMatches.length} ${plural(catalogMatches.length, "место", "места", "мест")}` : "Места не найдены";
    byId("catalog-tags").innerHTML = [{ id: "", label: "Все" }, ...tags]
      .map(tag => tagButton(tag, tag.id === (catalogTag ?? ""))).join("");
    catalogList.innerHTML = catalogMatches.slice(0, catalogLimit).map(place => {
      const available = onMap(place) && canVisit(place, day);
      const selected = pinned.has(place);
      const stars = place.stars ? ` · <span class="place-stars" aria-label="${place.stars} из 5">${"★".repeat(place.stars)}</span>` : "";
      const meta = !onMap(place) ? "Вне карты Бангкока" : [
        tagById.get(place.category).label,
        place.biennale ? "Биеннале" : "",
        !canVisit(place, day) ? "Событие вне дат" : ""
      ].filter(Boolean).join(" · ");
      const label = selected ? "Убрать остановку" : "Заехать по пути";
      return `<li class="catalog-item">
        <button class="catalog-show" type="button" data-place="${place.id}">
          ${dot({ color: placeColor(place) })}
          <span><strong>${escapeText(place.name)}</strong><small>${escapeText(meta)}${stars}</small></span>
        </button>
        <button class="catalog-pin" type="button" data-pin="${place.id}" aria-label="${label} · ${escapeText(place.name)}" title="${label}" aria-pressed="${selected}" ${available ? "" : "disabled"}>
          ${icon(selected ? "minus" : "plus")}
        </button>
      </li>`;
    }).join("");
    byId("catalog-more").hidden = catalogLimit >= catalogMatches.length;
    updateMap();
  }

  function switchPanel(open) {
    catalogOpen = open;
    byId("route-tab").setAttribute("aria-pressed", String(!open));
    byId("places-tab").setAttribute("aria-pressed", String(open));
    byId("route-panel").hidden = open;
    byId("places-panel").hidden = !open;
    byId("planner").scrollTop = 0;
    closePoint();
    if (open) renderCatalog();
    else {
      updateMap();
      if (route) fitRoute();
    }
  }

  function revealPlace(place) {
    if (!onMap(place)) {
      editPlace(place);
      return;
    }
    map.focus(place, 15.4);
    showPoint(place);
    scrollToSection(byId("map"));
  }

  function fitPlaces() {
    closePoint();
    map.fit(catalogMatches.filter(onMap), 15.2);
  }

  byId("route-tab").addEventListener("click", () => switchPanel(false));
  byId("places-tab").addEventListener("click", () => switchPanel(true));
  catalogSearch.addEventListener("input", () => {
    catalogLimit = 30;
    renderCatalog();
  });
  byId("catalog-tags").addEventListener("click", event => {
    const button = event.target.closest("[data-tag]");
    if (!button) return;
    catalogTag = button.dataset.tag || null;
    catalogLimit = 30;
    closePoint();
    renderCatalog();
    if (catalogTag) fitPlaces();
    document.querySelector(`#catalog-tags [data-tag="${catalogTag ?? ""}"]`)?.focus({ preventScroll: true });
  });
  catalogList.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (button?.dataset.place) revealPlace(placeById.get(button.dataset.place));
    else if (button?.dataset.pin) {
      const id = button.dataset.pin;
      togglePin(placeById.get(id));
      catalogList.querySelector(`[data-pin="${id}"]`)?.focus({ preventScroll: true });
    }
  });
  byId("catalog-more").addEventListener("click", () => {
    catalogLimit += 30;
    renderCatalog();
  });

  const palette = [
    ["#a9414a", "Красный"], ["#bd641f", "Оранжевый"], ["#827020", "Золотой"],
    ["#327354", "Зелёный"], ["#286593", "Синий"], ["#794496", "Фиолетовый"]
  ];

  function renderEditorChoices() {
    for (const button of byId("edit-stars").querySelectorAll("button")) {
      const rating = Number(button.dataset.rating);
      button.setAttribute("aria-pressed", String(rating === 0 ? draft.stars === 0 : rating <= draft.stars));
    }
    for (const button of byId("edit-colors").querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.color === draft.color));
    }
  }

  function editPlace(place) {
    editing = place;
    draft = { stars: place.stars ?? 0, color: place.color ?? "" };
    byId("edit-place-name").textContent = place.name;
    byId("edit-map-link").href = mapsLink(place);
    byId("edit-map-link").hidden = onMap(place);
    byId("edit-note").value = place.personalNote ?? "";
    byId("edit-error").hidden = true;
    renderEditorChoices();
    if (typeof editor.showModal === "function") editor.showModal();
    else editor.setAttribute("open", "");
  }

  function closeEditor() {
    if (typeof editor.close === "function") editor.close();
    else editor.removeAttribute("open");
  }

  byId("edit-stars").innerHTML = [1, 2, 3, 4, 5].map(rating =>
    `<button type="button" data-rating="${rating}" aria-label="${rating} из 5">★</button>`).join("") +
    '<button type="button" class="rating-clear" data-rating="0">Снять</button>';
  byId("edit-colors").innerHTML = palette.map(([color, name]) =>
    `<button type="button" class="color-choice" data-color="${color}" aria-label="${name}">${dot({ color })}</button>`).join("") +
    '<button type="button" class="color-default" data-color="">По категории</button>';
  byId("edit-stars").addEventListener("click", event => {
    const button = event.target.closest("[data-rating]");
    if (!button) return;
    draft.stars = Number(button.dataset.rating);
    renderEditorChoices();
  });
  byId("edit-colors").addEventListener("click", event => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    draft.color = button.dataset.color;
    renderEditorChoices();
  });
  byId("edit-close").addEventListener("click", closeEditor);
  byId("edit-place-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      saveAnnotation(editing, { ...draft, note: byId("edit-note").value });
    } catch {
      const error = byId("edit-error");
      error.textContent = "Браузер не смог сохранить отметки. Проверьте доступ к локальному хранилищу.";
      error.hidden = false;
      return;
    }
    closeEditor();
    updateTrip();
    if (catalogOpen) renderCatalog();
    if (selectedPoint === editing) showPoint(editing);
    notify("Отметки сохранены.");
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
  railToggle.addEventListener("click", () => {
    railVisible = !railVisible;
    toggleLayers(false);
    if (!railVisible && selectedPoint?.code) closePoint();
    layersToggle.parentElement.hidden = !railVisible;
    fitNetwork.hidden = !railVisible;
    railToggle.querySelector("span").textContent = railVisible ? "Скрыть метро" : "Показать метро";
    updateMap();
  });
  document.addEventListener("pointerdown", event => {
    if (!layersToggle.parentElement.contains(event.target)) toggleLayers(false);
    for (const field of fields) if (!field.field.contains(event.target)) hideOptions(field);
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || about.open || editor.open) return;
    if (!layers.hidden) {
      toggleLayers(false);
      layersToggle.focus();
    } else if (selectedPoint) closePoint();
  });

  byId("zoom-in").addEventListener("click", () => map.zoomBy(0.85));
  byId("zoom-out").addEventListener("click", () => map.zoomBy(-0.85));
  fitNetwork.addEventListener("click", () => {
    closePoint();
    const showing = stations.filter(station => station.lines.some(line => visibleLines.has(line.id)));
    map.fit(showing.length ? showing : stations, 13);
  });
  byId("fit-route").addEventListener("click", () => catalogOpen ? fitPlaces() : fitRoute());

  function showLocation(position) {
    const { latitude, longitude, accuracy } = position.coords;
    const point = { lat: latitude, lng: longitude, accuracy };
    closest = nearestStation(point);
    if (!onMap(point) || closest.distance > 12000) {
      userLocation = null;
      for (const { key } of fields) if (endpoints[key] === "here") setEndpoint(key, null);
      map.setState({ location: null });
      locationHint.hidden = true;
      notify("Ваше местоположение за пределами сети Бангкока.");
      return;
    }
    userLocation = { ...point, id: "here", name: "Моё местоположение" };
    map.setState({ location: userLocation });
    updateTrip();
    closePoint();
    const meters = closest.distance;
    const distance = meters >= 1000 ? `${(meters / 1000).toFixed(1).replace(".", ",")} км` : `${Math.max(10, Math.round(meters / 10) * 10)} м`;
    locationHint.innerHTML = `<button type="button" data-location="station" title="Выбрать ближайшую станцию как отправление">${icon("train")}<span>Ближайшая — <b>${escapeText(closest.station.name)}</b><br>${distance} по прямой</span></button>
      <button type="button" data-location="here">${icon("locate")} Отсюда</button>`;
    locationHint.hidden = false;
    const station = closest.station;
    if (meters > 900) map.fit([point, station], 14.25);
    else map.focus(point, 15.1);
    scrollToSection(byId("map"));
    notify(`Позиция найдена. Ближайшая станция — ${station.name}.`);
  }

  locationHint.addEventListener("click", event => {
    const choice = event.target.closest("[data-location]")?.dataset.location;
    if (choice && closest) {
      setEndpoint("from", choice === "here" ? "here" : closest.station.code, true);
      if (catalogOpen) switchPanel(false);
    }
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
  renderVia();
  updateMap();
})();
