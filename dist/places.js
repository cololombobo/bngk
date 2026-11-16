"use strict";

(function loadPlaces() {
  const tags = [
    { id: "personal", label: "Мои места", color: "#884a2c" },
    { id: "biennale", label: "Биеннале", color: "#744895" },
    { id: "art", label: "Музеи и арт", color: "#58429b", minutes: 35 },
    { id: "heritage", label: "Храмы и история", color: "#a04d2f", minutes: 30 },
    { id: "parks", label: "Парки и виды", color: "#356c4d", minutes: 25 },
    { id: "shops", label: "Рынки и магазины", color: "#935713", minutes: 25 },
    { id: "cafes", label: "Кафе", color: "#845039", minutes: 25 },
    { id: "rooftops", label: "Крыши", color: "#2f6482", minutes: 30 },
    { id: "bars", label: "Бары и клубы", color: "#a03e64", minutes: 35 },
    { id: "activities", label: "Досуг", color: "#3c6670", minutes: 30 }
  ];
  const tagById = new Map(tags.map(tag => [tag.id, tag]));
  const places = window.BangkokPlacesData.map(place => ({
    ...place,
    minutes: place.minutes ?? tagById.get(place.category).minutes
  }));
  const placeById = new Map(places.map(place => [place.id, place]));
  const defaults = new Map(places.map(place => [place.id, { stars: place.stars ?? 0, personal: Boolean(place.personal) }]));
  const storageKey = "bangkok-rail-place-notes-v1";
  const annotations = new Map();

  function applyAnnotation(place, values) {
    const original = defaults.get(place.id);
    place.stars = values.stars ?? original.stars;
    place.color = values.color ?? "";
    place.personalNote = values.note ?? "";
    place.personal = original.personal || Object.keys(values).length > 0;
  }

  function sanitizeAnnotation(place, values) {
    const result = {};
    if (Number.isInteger(values.stars) && values.stars >= 0 && values.stars <= 5 && values.stars !== defaults.get(place.id).stars) {
      result.stars = values.stars;
    }
    if (typeof values.color === "string" && /^#[0-9a-f]{6}$/i.test(values.color)) result.color = values.color;
    if (typeof values.note === "string" && values.note.trim()) result.note = values.note.trim().slice(0, 1200);
    return result;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    for (const [id, value] of Object.entries(saved)) {
      const place = placeById.get(id);
      if (!place || !value || typeof value !== "object") continue;
      const clean = sanitizeAnnotation(place, value);
      annotations.set(id, clean);
      applyAnnotation(place, clean);
    }
  } catch {
    // Browsing the catalog also works when storage is unavailable.
  }

  function saveAnnotation(place, values) {
    const changes = sanitizeAnnotation(place, values);
    const updated = new Map(annotations);
    if (Object.keys(changes).length) updated.set(place.id, changes);
    else updated.delete(place.id);
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(updated)));
    annotations.clear();
    for (const [id, record] of updated) annotations.set(id, record);
    applyAnnotation(place, changes);
  }
  const dateFormat = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  });

  function today() {
    const parts = Object.fromEntries(dateFormat.formatToParts(new Date()).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function onMap({ lat, lng }) {
    return lat >= 13.455 && lat <= 14.085 && lng >= 100.235 && lng <= 100.97;
  }

  function canVisit(place, day = today()) {
    return !place.event || day >= place.event.start && day <= place.event.end;
  }

  function matchesTag(place, tag, day) {
    if (tag === "personal") return Boolean(place.personal);
    if (tag === "biennale") {
      return Boolean(place.biennale && (!day ||
        !place.biennale.pending && day >= place.biennale.start && day <= place.biennale.end));
    }
    return place.category === tag;
  }

  function searchKey(value) {
    return value.toLowerCase().normalize("NFKC").replace(/[’'\-–.,&/()]/g, " ").replace(/\s+/g, " ").trim();
  }

  const indexed = places.map(place => ({
    place,
    nameKey: searchKey(place.name),
    terms: searchKey([place.name, place.address, place.aliases, tagById.get(place.category).label].filter(Boolean).join(" "))
  }));

  function searchPlaces(query = "", filter = null) {
    const key = searchKey(query);
    const words = key.split(" ");
    const matches = [];
    for (const entry of indexed) {
      const { place, nameKey, terms } = entry;
      if (filter && !matchesTag(place, filter)) continue;
      if (!words.every(word => terms.includes(word))) continue;
      const rank = !key ? 0 : nameKey === key ? 0 : nameKey.startsWith(key) ? 1 : terms.includes(key) ? 2 : 3;
      matches.push({ place, rank });
    }
    return matches.sort((a, b) => a.rank - b.rank ||
      (b.place.stars ?? 0) - (a.place.stars ?? 0) ||
      Number(Boolean(b.place.personal)) - Number(Boolean(a.place.personal)) ||
      a.place.name.localeCompare(b.place.name)).map(({ place }) => place);
  }

  function mapsLink(place) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.lat + "," + place.lng)}`;
  }

  window.BangkokPlaces = { places, tags, tagById, placeById, searchPlaces, onMap, canVisit, matchesTag, today, mapsLink, saveAnnotation };
})();
