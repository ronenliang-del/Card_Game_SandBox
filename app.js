const $ = (id) => document.getElementById(id);
let definition = tabletop.validate(tabletop.sample);
let state = tabletop.start(definition);
let selected = null;
let handVisible = false;
let soundEnabled = false;
let music = null;
let effect = null;
let onlineRoom = null;
const fontScopes = new WeakMap();
let nextDefinitionId = 1;
let draftPositions;
const positionKeys = ["x", "y", "width", "height"];

function setStatus(message) {
  $("status").textContent = message;
}

function showWorkspace(editing) {
  $("editor").hidden = !editing;
  $("play").hidden = editing;
  $("edit-tab").setAttribute("aria-pressed", editing);
  $("play-tab").setAttribute("aria-pressed", !editing);
  setStatus("");
  syncSound();
}

function playAudio(track) {
  // Browsers can reject playback if a codec is unsupported or a user gesture is required.
  track.play().catch((error) => {
    if (error.name !== "AbortError" && soundEnabled && (track === music || track === effect)) {
      setStatus("Audio could not play in this browser. Try an MP3 file.");
    }
  });
}

function syncSound() {
  $("toggle-sound").textContent = soundEnabled ? "Mute sound" : "Enable sound";
  $("toggle-sound").setAttribute("aria-pressed", soundEnabled);
  if (!soundEnabled || $("play").hidden) {
    music?.pause();
    effect?.pause();
    return;
  }
  if (!music && definition.audio.music) {
    music = new Audio(definition.audio.music);
    music.loop = true;
    music.volume = 0.35;
  }
  if (music?.paused) playAudio(music);
}

function playEffect(key, source = definition.audio[key]) {
  if (!soundEnabled || !source) return;
  effect?.pause();
  effect = new Audio(source);
  playAudio(effect);
}

function element(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function cardButton(card, zone) {
  // The deck and face-down cards render only a generic back.
  const visible = zone !== "deck" && card.faceUp;
  const button = element("button", visible ? card.design.name : "Face down");
  button.type = "button";
  button.disabled = Boolean(onlineRoom && (!roomCanAct() || zone === "deck"));
  button.className = "card";
  if (!visible && state.game.theme.backArtwork) {
    button.dataset.back = "";
    button.replaceChildren(element("span", "Face down"));
  }
  button.setAttribute("aria-pressed", selected?.id === card.id);
  if (visible && card.design.artwork) {
    const image = element("img");
    image.src = card.design.artwork;
    image.alt = "";
    button.prepend(image);
  }
  if (visible && card.design.text) button.append(element("small", card.design.text));
  if (visible && state.game.stats.length) {
    const stats = state.game.stats.filter(({ id }) => card.stats[id] !== null)
      .map(({ id, label }) => label + ": " + card.stats[id]);
    if (stats.length) button.append(element("small", stats.join(" · ")));
  }
  button.addEventListener("click", () => {
    selected = { zone, id: card.id };
    renderTable();
    $("destination").focus();
  });
  return button;
}

function playerLabel(player) {
  return state.game.playerLabels[player];
}

function renderScores() {
  const finished = state.finished;
  $("scores").replaceChildren(...state.scores.map((score, player) => {
    const panel = element("div");
    panel.className = "player-score";
    if (player === state.active) panel.dataset.active = "";
    const name = playerLabel(player);
    panel.append(element("strong", name), element("span", score + (score === 1 ? " point" : " points")));
    if (state.eliminated[player]) panel.append(element("span", "Eliminated"));
    const locked = finished || state.eliminated[player];
    if (state.game.manualPoints) {
      const controls = element("div");
      controls.className = "score-controls";
      for (const amount of [-1, 1]) {
        const button = element("button", amount === 1 ? "+1" : "−1");
        button.type = "button";
        button.id = "score-" + player + "-" + amount;
        button.setAttribute("aria-label", (amount === 1 ? "Add a point to " : "Remove a point from ") + name);
        button.disabled = locked || (onlineRoom && (!roomCanAct() || player !== onlineRoom.player)) ||
          (amount === -1 && score === 0);
        button.onclick = () => {
          if (onlineRoom) { sendRoomAction({ type: "points", amount }); return; }
          if (!tabletop.adjustPoints(state, player, amount)) return;
          renderTable();
          if (state.winner !== null) {
            setStatus(name + " wins!");
            $("restart").focus();
            playEffect("win");
          } else {
            setStatus(name + " has " + state.scores[player] + " points.");
            const replacement = $(button.id);
            (replacement.disabled ? $("score-" + player + "-1") : replacement).focus();
          }
        };
        controls.append(button);
      }
      panel.append(controls);
    }
    for (const { id, label } of state.game.counters) {
      const score = state.counters[player][id];
      const counter = element("div");
      counter.className = "custom-counter";
      counter.append(element("span", label + ": " + score));
      for (const amount of [-1, 1]) {
        const button = element("button", amount === 1 ? "+1" : "−1");
        button.type = "button";
        button.id = "counter-" + player + "-" + id + "-" + amount;
        button.setAttribute("aria-label", name + ": " + (amount === 1 ? "add to " : "subtract from ") + label);
        button.disabled = locked || (onlineRoom && (!roomCanAct() || player !== onlineRoom.player)) ||
          (amount === -1 ? score === 0 : score === tabletop.maxStatistic);
        button.onclick = () => {
          if (onlineRoom) { sendRoomAction({ type: "counter", counter: id, amount }); return; }
          const active = state.active;
          if (!tabletop.adjustCounter(state, player, id, amount)) return;
          handleTurnChange(active);
          renderTable();
          const pass = !state.finished && active !== state.active ? " · Pass to " + playerLabel(state.active) + "." : "";
          setStatus(name + " · " + label + ": " + state.counters[player][id] + pass);
          if (state.finished && state.winner !== null) playEffect("win");
          if ($("victor-dialog").open) return;
          const replacement = $(button.id);
          (replacement.disabled ? $("counter-" + player + "-" + id + "-" + (-amount)) : replacement).focus();
        };
        counter.append(button);
      }
      panel.append(counter);
    }
    return panel;
  }));
}

function renderTable() {
  $("game-title").textContent = state.game.title;
  $("turn").textContent = "Turn " + state.turn + " · " + playerLabel(state.active);
  const finished = state.finished;
  const locked = finished || (onlineRoom && !roomCanAct());
  if (finished) $("turn").textContent += state.winner === null
    ? " · Game over" : " · " + playerLabel(state.winner) + " wins!";
  renderScores();
  $("rulebook").textContent = state.game.rules || "This game has no written rules yet.";
  $("draw").disabled = locked || state.deck.length === 0;
  $("shuffle").disabled = locked || state.deck.length < 2;
  $("end-turn").disabled = locked;
  $("restart").hidden = Boolean(onlineRoom);
  $("reveal").hidden = Boolean(onlineRoom);
  $("reveal").textContent = handVisible ? "Hide hand" : "Reveal hand";

  const zones = tabletop.zones(state);
  if (onlineRoom) zones.hand.cards = state.hands[onlineRoom.player];
  $("zones").replaceChildren(...Object.entries(zones).map(([key, zone]) => {
    const panel = element("section");
    panel.className = "zone";
    if (state.game.ui.layout === "custom") positionZone(panel, state.game.ui.positions[key]);
    panel.append(element("h3", zone.label + " (" + zone.cards.length + ")"));
    const cards = element("div");
    cards.className = "cards";
    if (key === "hand" && !handVisible) {
      cards.append(element("p", "Pass the screen before revealing this hand."));
    } else {
      const visibleCards = key === "deck" ? zone.cards.slice(-1) : zone.cards;
      cards.append(...visibleCards.map((card) => cardButton(card, key)));
    }
    panel.append(cards);
    return panel;
  }));

  $("selection").textContent = selected ? "Selected from " + zones[selected.zone].label : "Select a card to move or flip.";
  $("destination").replaceChildren(...Object.entries(zones)
    .filter(([key]) => key !== selected?.zone)
    .map(([key, zone]) => new Option(zone.label, key)));
  $("destination").disabled = !selected;
  $("move").disabled = locked || !selected;
  $("flip").disabled = locked || !selected || selected.zone === "deck";
  if (onlineRoom) renderOnlineControls();
  showNextVictorDisplay();
}

function showNextVictorDisplay() {
  const dialog = $("victor-dialog");
  if ($("play").hidden || dialog.open || !state.pendingDisplays.length) return;
  const { player, subject, display, value, final } = state.pendingDisplays.shift();
  if (subject !== undefined) {
    const label = state.game.counters.find(({ id }) => id === display.counter).label;
    const result = display.outcome === "lose" ? " · " + playerLabel(subject) + " was eliminated." : "";
    const winner = final ? (player === null ? " No players remain." : " " + playerLabel(player) + " wins!") : "";
    $("victor-title").textContent = display.title || (final ? (player === null ? "Game over" : "Victory") : label);
    $("victor-player").textContent = playerLabel(subject) + " · " + label + ": " + value + "." + result + winner;
  } else {
    $("victor-title").textContent = display?.title ?? "Victory";
    $("victor-player").textContent = playerLabel(player) + (final ? " wins!" : " reached " + display.points + " points.");
  }
  $("victor-message").textContent = display?.message ?? "";
  $("victor-message").hidden = !display?.message;
  const image = $("victor-image");
  image.hidden = !display?.artwork;
  if (display?.artwork) image.src = display.artwork;
  else image.removeAttribute("src");
  $("dismiss-victor").textContent = final ? "Back to tabletop" : "Continue";
  dialog.showModal();
}

function handleTurnChange(previous) {
  if (state.active === previous) return;
  handVisible = false;
  selected = null;
}

function textColor(hex) {
  // Choose black or white according to the background's relative luminance.
  const channels = hex.slice(1).match(/../g).map((pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.179 ? "#000" : "#fff";
}

function applyTheme(theme) {
  const styles = document.documentElement.style;
  styles.setProperty("--mat-color", theme.mat);
  styles.setProperty("--menu-color", theme.menu);
  styles.setProperty("--menu-text", textColor(theme.menu));
  styles.setProperty("--button-color", theme.button);
  styles.setProperty("--button-text", textColor(theme.button));
  // Validation limits image values to embedded raster data before they reach CSS.
  $("zones").style.backgroundImage = theme.matArtwork ? 'url("' + theme.matArtwork + '")' : "";
  styles.setProperty("--back-image", theme.backArtwork ? 'url("' + theme.backArtwork + '")' : "none");
  applyTypography(theme);
}

async function loadThemeFont(source, family = "Sandbox Theme") {
  try {
    // Use a fixed family name and accept only a validated embedded font source.
    return await new FontFace(family, 'url("' + tabletop.fontSource(source) + '")').load();
  } catch {
    throw new Error("Could not load this font. Choose a valid WOFF2, WOFF, TTF, or OTF file.");
  }
}

async function applyTypography(theme, target = document.documentElement) {
  const styles = target.style;
  const scope = fontScopes.get(target) ?? new Map();
  fontScopes.set(target, scope);
  const fonts = [["theme", theme.font]];
  for (const { key } of tabletop.typographyAreas) {
    const { size, color, font } = theme.typography[key];
    styles.setProperty("--" + key + "-size", size + "px");
    if (color) styles.setProperty("--" + key + "-color", color);
    else if (target === document.documentElement) styles.removeProperty("--" + key + "-color");
    else styles.setProperty("--" + key + "-color", "initial");
    fonts.push([key, font]);
  }
  await Promise.all(fonts.map(async ([key, source]) => {
    const property = "--" + key + "-font";
    const previous = scope.get(key);
    if (previous?.source === source) return;
    if (previous?.font) document.fonts.delete(previous.font);
    const entry = { source, font: null };
    scope.set(key, entry);
    styles.removeProperty(property);
    if (target !== document.documentElement) styles.setProperty(property, "initial");
    if (!source) return;
    const family = "Sandbox " + (target === document.documentElement ? "" : "preview ") + key;
    try {
      const font = await loadThemeFont(source, family);
      if (scope.get(key) !== entry) return;
      document.fonts.add(font);
      entry.font = font;
      styles.setProperty(property, '"' + family + '"');
    } catch (error) {
      if (scope.get(key) === entry) setStatus(error.message);
    }
  }));
}

function startTable(game) {
  music?.pause();
  effect?.pause();
  music = effect = null;
  definition = game;
  state = tabletop.start(game);
  selected = null;
  handVisible = false;
  applyTheme(game.theme);
  applyLayout(game.ui);
  showWorkspace(false);
  renderTable();
}

function applyLayout(ui) {
  $("workspace-title").textContent = ui.title;
  $("zones").dataset.layout = ui.layout;
  $("zones").dataset.cardSize = ui.cardSize;
}

function positionZone(node, position) {
  node.style.left = position.x + "%";
  node.style.top = position.y + "%";
  node.style.width = position.width + "%";
  node.style.height = position.height + "%";
}

function validPosition({ x, y, width, height }) {
  return [x, y, width, height].every(Number.isInteger) &&
    x >= 0 && y >= 0 && width >= 15 && height >= 15 && x + width <= 100 && y + height <= 100;
}

function attachZoneDrag(target, tile, read, write, resize) {
  let drag;
  target.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target !== target || drag) return;
    const bounds = $("layout-preview").getBoundingClientRect();
    const current = read();
    if (!validPosition(current)) return;
    raisePreviewTile(tile);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds, current };
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    const dx = Math.round((event.clientX - drag.x) * 100 / drag.bounds.width);
    const dy = Math.round((event.clientY - drag.y) * 100 / drag.bounds.height);
    const { x, y, width, height } = drag.current;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const position = resize
      ? { x, y, width: clamp(width + dx, 15, 100 - x), height: clamp(height + dy, 15, 100 - y) }
      : { x: clamp(x + dx, 0, 100 - width), y: clamp(y + dy, 0, 100 - height), width, height };
    write(position);
    positionZone(tile, position);
  });
  target.addEventListener("lostpointercapture", () => { drag = null; });
}

function raisePreviewTile(tile) {
  $("layout-preview").querySelector(".layout-tile[data-raised]")?.removeAttribute("data-raised");
  tile.dataset.raised = "";
}

function buildPositionEditor(positions) {
  const preview = $("layout-preview");
  const coordinates = $("layout-coordinates");
  preview.replaceChildren();
  coordinates.replaceChildren();
  $("layout-status").textContent = "";
  for (const [zone, initial] of Object.entries(positions)) {
    const label = $(zone + "-label").value.trim() || zone;
    const tile = element("div");
    tile.className = "layout-tile";
    tile.append(element("span", label));
    const handle = element("div");
    handle.className = "resize-handle";
    tile.append(handle);
    preview.append(tile);

    const row = element("fieldset");
    row.className = "coordinate-row";
    row.append(element("legend", label + " (%)"));
    const inputs = Object.fromEntries(positionKeys.map((key) => [
      key, numberField(row, key.toUpperCase(), initial[key], key.length === 1 ? 0 : 15, 100),
    ]));
    row.readPosition = () => Object.fromEntries(positionKeys.map((key) => [key, inputs[key].valueAsNumber]));
    row.dataset.zone = zone;
    const refresh = () => {
      const position = row.readPosition();
      if (validPosition(position)) positionZone(tile, position);
      $("layout-status").textContent = validPosition(position) ? "" : label + " must fit within the playmat.";
    };
    row.addEventListener("input", refresh);
    row.addEventListener("focusin", () => raisePreviewTile(tile));
    const write = (position) => {
      for (const key of positionKeys) inputs[key].value = position[key];
      $("layout-status").textContent = "";
    };
    attachZoneDrag(tile, tile, row.readPosition, write, false);
    attachZoneDrag(handle, tile, row.readPosition, write, true);
    coordinates.append(row);
    positionZone(tile, initial);
  }
}

function field(parent, label, type, value) {
  const wrapper = element("label", label);
  const input = element("input");
  input.type = type;
  input.value = value;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

async function checkArtwork(source) {
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error("Could not decode this artwork. Choose a valid PNG, JPEG, WebP, or GIF.");
  }
}

function mediaField({ label, source, accept, maxBytes, description, check }) {
  const wrapper = element("div");
  wrapper.className = "artwork-field";
  const file = field(wrapper, label, "file", "");
  file.accept = accept;
  const artworkStatus = element("span", source ? "File attached" : "No file");
  const removeArt = element("button", "Clear file");
  removeArt.type = "button";
  wrapper.append(artworkStatus, removeArt);

  // Keep the previous file until the replacement has been read and checked.
  let loading = null;
  removeArt.onclick = () => {
    loading = null;
    source = "";
    file.value = "";
    artworkStatus.textContent = "No file";
    wrapper.dispatchEvent(new Event("mediachange", { bubbles: true }));
  };
  file.onchange = () => {
    const upload = file.files[0];
    if (!upload) return;
    loading = null;
    if (upload.size > maxBytes) {
      setStatus(description);
      file.value = "";
      artworkStatus.textContent = source ? "Previous file attached" : "No file";
      return;
    }
    const reader = new FileReader();
    loading = reader;
    artworkStatus.textContent = "Reading file…";
    reader.onload = async () => {
      try {
        const data = await check(reader.result, upload);
        if (loading !== reader) return;
        source = data;
        artworkStatus.textContent = "File attached";
        setStatus("");
        wrapper.dispatchEvent(new Event("mediachange", { bubbles: true }));
      } catch (error) {
        if (loading !== reader) return;
        file.value = "";
        artworkStatus.textContent = source ? "Previous file attached" : "No file";
        setStatus(error.message);
      } finally {
        if (loading === reader) loading = null;
      }
    };
    reader.onerror = () => {
      if (loading !== reader) return;
      loading = null;
      file.value = "";
      artworkStatus.textContent = source ? "Previous file attached" : "No file";
      setStatus("Could not read that file.");
    };
    reader.readAsDataURL(upload);
  };
  wrapper.readSource = (allowPending = false) => {
    if (loading && !allowPending) throw new Error("Wait for the upload to finish loading.");
    return source;
  };
  return wrapper;
}

function artworkField(label, source) {
  const accept = "image/png,image/jpeg,image/webp,image/gif";
  return mediaField({ label, source, accept, maxBytes: 550000,
    description: "Choose a PNG, JPEG, WebP, or GIF up to 550 KB.",
    async check(data, upload) {
      if (!accept.split(",").includes(upload.type)) throw new Error("Choose a PNG, JPEG, WebP, or GIF.");
      await checkArtwork(data);
      return data;
    },
  });
}

function audioField(slot, source) {
  const limit = slot.key === "music" ? "5 MB" : "300 KB";
  return mediaField({
    label: slot.label + " (up to " + limit + ")",
    source,
    accept: ".mp3,.wav,.ogg,.m4a",
    maxBytes: slot.maxBytes,
    description: "Choose an MP3, WAV, Ogg, or M4A file up to " + limit + ".",
    check(data, upload) {
      // File pickers sometimes report a blank or generic MIME type for audio.
      const formats = { mp3: "mpeg", wav: "wav", ogg: "ogg", m4a: "mp4" };
      const extension = upload.name.split(".").at(-1).toLowerCase();
      if (!Object.hasOwn(formats, extension)) {
        throw new Error("Choose an MP3, WAV, Ogg, or M4A file.");
      }
      return tabletop.audioSource(data.replace(/^data:[^,]*,/, "data:audio/" + formats[extension] + ";base64,"), slot);
    },
  });
}

function fontField(source, label = "Shared interface font (optional, up to 2 MB)") {
  const accept = ".woff2,.woff,.ttf,.otf";
  return mediaField({
    label,
    source,
    accept,
    maxBytes: tabletop.fontMaxBytes,
    description: "Choose a WOFF2, WOFF, TTF, or OTF font up to 2 MB.",
    async check(data, upload) {
      const extension = upload.name.split(".").at(-1).toLowerCase();
      if (!accept.split(",").includes("." + extension)) {
        throw new Error("Choose a WOFF2, WOFF, TTF, or OTF font.");
      }
      const font = tabletop.fontSource(data.replace(/^data:[^,]*,/, "data:font/" + extension + ";base64,"));
      await loadThemeFont(font);
      return font;
    },
  });
}

function typographyEditor(area, typography) {
  const row = element("fieldset");
  row.className = "type-editor";
  row.dataset.area = area.key;
  row.append(element("legend", area.label));
  const font = fontField(typography.font, "Font file (optional, up to 2 MB)");
  row.append(font);
  const size = numberField(row, "Text size (px)", typography.size, 12, 36);
  const customColor = field(row, "Use custom text color", "checkbox", "");
  const color = field(row, "Text color", "color", typography.color || area.color);
  customColor.checked = Boolean(typography.color);
  color.disabled = !customColor.checked;
  customColor.onchange = () => { color.disabled = !customColor.checked; };
  row.readTypography = (preview = false) => ({
    font: font.readSource(preview),
    size: preview && (!size.validity.valid || !Number.isFinite(size.valueAsNumber)) ? area.size : size.valueAsNumber,
    color: customColor.checked ? color.value : "",
  });
  return row;
}

function readTypography(preview = false) {
  return Object.fromEntries(Array.from($("typography-fields").children,
    (row) => [row.dataset.area, row.readTypography(preview)]));
}

function updateTypographyPreview() {
  const preview = $("typography-preview");
  if (!$("typography-fields").children.length) return;
  const menu = $("menu-color").value;
  preview.style.setProperty("--menu-color", menu);
  preview.style.setProperty("--menu-text", textColor(menu));
  $("preview-menu-title").textContent = $("title").value.trim() || "Game menu";
  const card = $("library").firstElementChild?.previewCard();
  $("preview-card-name").textContent = card?.name || "Sample card";
  $("preview-card-text").textContent = card?.text || "Your card text appears here.";
  const victor = $("victor-displays").firstElementChild?.previewDisplay()
    ?? $("counter-rules").firstElementChild?.previewDisplay();
  $("preview-victor-title").textContent = victor?.title || "Victory";
  $("preview-victor-message").textContent = victor?.message || "Player 1 wins!";
  applyTypography({
    font: $("theme-font").firstElementChild.readSource(true),
    typography: readTypography(true),
  }, preview);
}

function definitions(container, preview = false) {
  return Array.from($(container).children, (row) => row.readDefinition(preview));
}

function addDefinition(container, definition) {
  if ($(container).children.length >= 8) {
    setStatus("Use up to eight definitions in each list.");
    return;
  }
  let id = definition?.id;
  if (!id) {
    const ids = new Set(definitions(container, true).map((entry) => entry.id));
    do { id = "field-" + nextDefinitionId++; } while (ids.has(id));
  }
  const row = element("div");
  row.className = "definition-row";
  const label = field(row, "Label", "text", definition?.label ?? "");
  label.required = true;
  label.maxLength = 40;
  const initial = numberField(row, "Starting value", definition?.initial ?? 0, 0, tabletop.maxStatistic);
  const remove = element("button", "Remove");
  remove.type = "button";
  remove.onclick = () => { row.remove(); syncCardDefinitions(); };
  row.append(remove);
  label.addEventListener("input", syncCardDefinitions);
  initial.addEventListener("input", syncCardDefinitions);
  row.readDefinition = (preview = false) => ({
    id, label: label.value.trim() || (preview ? "Untitled" : ""), initial: initial.valueAsNumber,
  });
  $(container).append(row);
  if (!definition) { syncCardDefinitions(); label.focus(); }
}

function optionField(parent, label, values) {
  const wrapper = element("label", label);
  const input = element("select");
  input.replaceChildren(...values.map(([value, title]) => new Option(title, value)));
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function addInteraction(list, saved = {}) {
  if (list.children.length >= 10) {
    setStatus("Use up to ten interactions on a card.");
    return;
  }
  const row = element("div");
  row.className = "interaction-row";
  const target = optionField(row, "Target", [
    ["self", "This card"], ["active", "Active player"], ["next", "Next player"],
  ]);
  target.value = saved.target ?? "self";
  const affected = optionField(row, "Change", []);
  affected.required = true;
  const operation = optionField(row, "Operation", tabletop.mathOperations.map((item) =>
    [item, item[0].toUpperCase() + item.slice(1)]));
  operation.value = saved.operation ?? "add";
  const operand = optionField(row, "Use amount from", []);
  const amount = numberField(row, "Fixed amount", saved.amount ?? 1, 0, tabletop.maxStatistic);
  const remove = element("button", "Remove interaction");
  remove.type = "button";
  remove.onclick = () => row.remove();
  row.append(remove);
  function updateAmount() { amount.disabled = Boolean(operand.value); }
  row.sync = (field = affected.value, source = operand.value) => {
    const stats = definitions("stat-definitions", true);
    const targets = target.value === "self" ? stats : definitions("counter-definitions", true);
    affected.replaceChildren(new Option("Choose a field", ""), ...targets.map(({ id, label }) => new Option(label, id)));
    affected.value = targets.some(({ id }) => id === field) ? field : "";
    operand.replaceChildren(new Option("Fixed amount", ""), ...stats.map(({ id, label }) => new Option(label, id)));
    if (source && !stats.some(({ id }) => id === source)) operand.append(new Option("Removed statistic", source));
    operand.value = source;
    updateAmount();
  };
  target.onchange = () => row.sync();
  operand.onchange = updateAmount;
  row.readInteraction = () => ({
    target: target.value, field: affected.value, operation: operation.value,
    operandStat: operand.value, amount: amount.valueAsNumber,
  });
  row.sync(saved.field ?? "", saved.operandStat ?? "");
  list.append(row);
  return target;
}

function syncCardDefinitions() {
  const stats = definitions("stat-definitions", true);
  for (const row of $("library").children) row.syncDefinitions(stats);
  for (const row of $("counter-rules").children) row.syncCounterOptions();
}

function numberField(parent, label, value, min, max) {
  const input = field(parent, label, "number", value);
  input.min = min;
  input.max = max;
  input.required = true;
  return input;
}

function addCardEditor(card = { name: "", text: "", copies: 1, artwork: "" }) {
  const row = element("fieldset");
  row.className = "card-editor";
  row.append(element("legend", "Card design"));
  const name = field(row, "Name", "text", card.name);
  name.required = true;
  name.maxLength = 80;
  const text = field(row, "Card text", "text", card.text);
  text.maxLength = 500;
  const copies = numberField(row, "Copies", card.copies, 1, 100);
  const playDraw = numberField(row, "Draw cards on play", card.playDraw ?? 0, 0, 30);
  const playPoints = numberField(row, "Gain points on play", card.playPoints ?? 0, 0, 30);
  const artwork = artworkField("Card artwork (optional)", card.artwork);
  const sound = audioField(tabletop.cardSound, card.playSound ?? "");
  const removeCard = element("button", "Remove card");
  removeCard.type = "button";
  removeCard.onclick = () => { row.remove(); updateTypographyPreview(); };
  row.append(artwork, sound, removeCard);
  const mechanics = element("details");
  mechanics.className = "card-mechanics";
  const statFields = element("div");
  statFields.className = "fields";
  const interactions = element("div");
  const add = element("button", "Add play interaction");
  add.type = "button";
  add.onclick = () => addInteraction(interactions)?.focus();
  mechanics.append(element("summary", "Statistics and play interactions"), statFields, interactions, add);
  row.append(mechanics);
  row.previewCard = () => ({ name: name.value.trim(), text: text.value.trim() });
  const savedStats = new Map(Object.entries(card.stats ?? {}).map(([id, value]) => [
    id, { enabled: value !== null, value: value ?? "" },
  ]));
  let statEditors = [];
  row.syncDefinitions = (stats) => {
    for (const { id, input, enabled } of statEditors) {
      savedStats.set(id, { enabled: enabled.checked, value: input.value });
    }
    statFields.replaceChildren();
    statEditors = stats.map(({ id, label, initial }) => {
      const group = element("div");
      group.className = "stat-value";
      const saved = savedStats.get(id);
      const enabled = field(group, "Use " + label, "checkbox", "");
      enabled.checked = saved?.enabled ?? true;
      const input = numberField(group, label, saved?.value ?? "", 0, tabletop.maxStatistic);
      input.required = false;
      input.placeholder = String(initial);
      input.disabled = !enabled.checked;
      enabled.onchange = () => { input.disabled = !enabled.checked; };
      statFields.append(group);
      return { id, input, enabled };
    });
    for (const interaction of interactions.children) interaction.sync();
  };
  for (const interaction of card.interactions ?? []) addInteraction(interactions, interaction);
  row.syncDefinitions(definitions("stat-definitions", true));
  row.readCard = () => {
    const stats = Object.fromEntries(statEditors
      .filter(({ input, enabled }) => !enabled.checked || input.value !== "" || input.validity.badInput)
      .map(({ id, input, enabled }) => [id, enabled.checked ? input.valueAsNumber : null]));
    return {
      name: name.value, text: text.value, copies: copies.valueAsNumber,
      artwork: artwork.readSource(), playDraw: playDraw.valueAsNumber, playPoints: playPoints.valueAsNumber,
      playSound: sound.readSource(),
      stats, interactions: Array.from(interactions.children, (interaction) => interaction.readInteraction()),
    };
  };
  $("library").append(row);
  return name;
}

function addVictorEditor(display = { points: 5, title: "", message: "", artwork: "", endsGame: false }) {
  const row = element("fieldset");
  row.className = "card-editor";
  row.append(element("legend", "Victor display"));
  const points = numberField(row, "Points to trigger", display.points, 1, 999);
  const title = field(row, "Display title", "text", display.title);
  title.required = true;
  title.maxLength = 80;
  const message = field(row, "Message (optional)", "text", display.message);
  message.maxLength = 500;
  const endsGame = field(row, "End the match", "checkbox", "");
  endsGame.checked = display.endsGame;
  const artwork = artworkField("Display artwork (optional)", display.artwork);
  const remove = element("button", "Remove display");
  remove.type = "button";
  remove.onclick = () => { row.remove(); updateTypographyPreview(); };
  row.append(artwork, remove);
  row.readDisplay = () => ({
    points: points.valueAsNumber, title: title.value, message: message.value,
    artwork: artwork.readSource(), endsGame: endsGame.checked,
  });
  row.previewDisplay = () => ({ title: title.value.trim(), message: message.value.trim() });
  $("victor-displays").append(row);
  return title;
}

function addCounterRule(rule = {}) {
  const list = $("counter-rules");
  if (list.children.length >= 10) {
    setStatus("Use up to ten counter rules.");
    return;
  }
  const row = element("fieldset");
  row.className = "card-editor";
  row.append(element("legend", "Counter rule"));
  const counter = optionField(row, "Counter", []);
  counter.required = true;
  const comparison = optionField(row, "Trigger when the counter is", [
    ["atMost", "At or below"], ["atLeast", "At or above"],
  ]);
  comparison.value = rule.comparison ?? "atMost";
  const threshold = numberField(row, "Threshold", rule.threshold ?? 0, 0, tabletop.maxStatistic);
  const outcome = optionField(row, "Outcome", [
    ["lose", "Eliminate this player"], ["win", "This player wins"], ["show", "Show a screen and continue"],
  ]);
  outcome.value = rule.outcome ?? "lose";
  const title = field(row, "Screen title (optional)", "text", rule.title ?? "");
  title.maxLength = 80;
  const message = field(row, "Screen message (optional)", "text", rule.message ?? "");
  message.maxLength = 500;
  const artwork = artworkField("Screen artwork (optional)", rule.artwork ?? "");
  const remove = element("button", "Remove counter rule");
  remove.type = "button";
  remove.onclick = () => row.remove();
  row.append(artwork, remove);
  row.syncCounterOptions = (current = counter.value) => {
    const counters = definitions("counter-definitions", true);
    counter.replaceChildren(new Option("Choose a counter", ""),
      ...counters.map(({ id, label }) => new Option(label, id)));
    counter.value = counters.some(({ id }) => id === current) ? current : "";
  };
  row.readCounterRule = () => ({
    counter: counter.value, comparison: comparison.value, threshold: threshold.valueAsNumber,
    outcome: outcome.value, title: title.value, message: message.value, artwork: artwork.readSource(),
  });
  row.previewDisplay = () => ({ title: title.value.trim(), message: message.value.trim() });
  row.syncCounterOptions(rule.counter ?? "");
  list.append(row);
  return counter;
}

function fillEditor(game) {
  $("title").value = game.title;
  $("players").value = game.players;
  $("starting-hand").value = game.startingHand;
  $("turn-draw").value = game.turnDraw;
  $("rules").value = game.rules;
  $("ui-title").value = game.ui.title;
  $("ui-layout").value = game.ui.layout;
  $("ui-card-size").value = game.ui.cardSize;
  draftPositions = game.ui.positions;
  for (const [zone, label] of Object.entries(game.ui.labels)) {
    $(zone + "-label").value = label;
  }
  $("manual-points").checked = game.manualPoints;
  $("player-labels").replaceChildren();
  // Keep inactive labels in the draft so reducing and restoring the count preserves them.
  for (let player = 0; player < 6; player++) {
    const fallback = "Player " + (player + 1);
    const input = field($("player-labels"), fallback + " label", "text", game.playerLabels[player] ?? fallback);
    input.required = true;
    input.maxLength = 40;
  }
  updatePlayerFields();
  $("mat-color").value = game.theme.mat;
  $("menu-color").value = game.theme.menu;
  $("button-color").value = game.theme.button;
  $("mat-artwork").replaceChildren(artworkField("Playmat image (optional)", game.theme.matArtwork));
  $("back-artwork").replaceChildren(artworkField("Card back image (optional)", game.theme.backArtwork));
  $("theme-font").replaceChildren(fontField(game.theme.font));
  $("typography-fields").replaceChildren(...tabletop.typographyAreas.map((area) =>
    typographyEditor(area, game.theme.typography[area.key])));
  $("audio-fields").replaceChildren(...tabletop.audioSlots.map((slot) => audioField(slot, game.audio[slot.key])));
  $("win-points").value = game.winPoints;
  $("turn-points").value = game.turnPoints;
  $("win-empty-hand").checked = game.winEmptyHand;
  $("victor-displays").replaceChildren();
  game.victorDisplays.forEach(addVictorEditor);
  $("stat-definitions").replaceChildren();
  $("counter-definitions").replaceChildren();
  game.stats.forEach((definition) => addDefinition("stat-definitions", definition));
  game.counters.forEach((definition) => addDefinition("counter-definitions", definition));
  $("counter-rules").replaceChildren();
  game.counterRules.forEach(addCounterRule);
  $("library").replaceChildren();
  game.cards.forEach(addCardEditor);
  updateTypographyPreview();
}

function updatePlayerFields() {
  const count = $("players").valueAsNumber;
  Array.from($("player-labels").children).forEach((label, index) => {
    const visible = index < count;
    label.hidden = !visible;
    label.firstElementChild.disabled = !visible;
  });
}

function readEditor() {
  return tabletop.validate({
    version: 1,
    title: $("title").value,
    players: $("players").valueAsNumber,
    playerLabels: Array.from($("player-labels").children)
      .slice(0, $("players").valueAsNumber).map((label) => label.firstElementChild.value),
    manualPoints: $("manual-points").checked,
    ui: {
      title: $("ui-title").value,
      layout: $("ui-layout").value,
      cardSize: $("ui-card-size").value,
      positions: draftPositions,
      labels: Object.fromEntries(["deck", "hand", "table", "discard"].map((zone) => [
        zone, $(zone + "-label").value,
      ])),
    },
    startingHand: $("starting-hand").valueAsNumber,
    turnDraw: $("turn-draw").valueAsNumber,
    rules: $("rules").value,
    theme: {
      mat: $("mat-color").value,
      menu: $("menu-color").value,
      button: $("button-color").value,
      matArtwork: $("mat-artwork").firstElementChild.readSource(),
      backArtwork: $("back-artwork").firstElementChild.readSource(),
      font: $("theme-font").firstElementChild.readSource(),
      typography: Object.fromEntries(Array.from($("typography-fields").children,
        (row) => [row.dataset.area, row.readTypography()])),
    },
    winPoints: $("win-points").valueAsNumber,
    audio: Object.fromEntries(tabletop.audioSlots.map((slot, index) => [
      slot.key, $("audio-fields").children[index].readSource(),
    ])),
    turnPoints: $("turn-points").valueAsNumber,
    winEmptyHand: $("win-empty-hand").checked,
    stats: definitions("stat-definitions"),
    counters: definitions("counter-definitions"),
    counterRules: Array.from($("counter-rules").children, (row) => row.readCounterRule()),
    victorDisplays: Array.from($("victor-displays").children, (row) => row.readDisplay()),
    cards: Array.from($("library").children, (row) => row.readCard()),
  });
}

$("play-tab").onclick = () => {
  showWorkspace(false);
  showNextVictorDisplay();
};
for (const [key, preset] of Object.entries(tabletop.defaultPresets)) {
  $("default-presets").append(new Option(preset.title, key));
}
$("default-presets").onchange = () => {
  $("load-default-preset").disabled = !$("default-presets").value || $("import").disabled;
};
$("load-default-preset").onclick = () => {
  const key = $("default-presets").value;
  if (!Object.hasOwn(tabletop.defaultPresets, key) || $("import").disabled) return;
  const game = tabletop.validate(tabletop.defaultPresets[key]);
  fillEditor(game);
  setStatus(game.title + " loaded into the editor. Choose Start new table to play.");
};
$("add-stat").onclick = () => addDefinition("stat-definitions");
$("add-counter").onclick = () => addDefinition("counter-definitions");
$("add-counter-rule").onclick = () => addCounterRule()?.focus();
$("game-form").addEventListener("input", updateTypographyPreview);
$("game-form").addEventListener("mediachange", updateTypographyPreview);
$("game-form").addEventListener("invalid", (event) => {
  const section = event.target.closest("details");
  if (section) section.open = true;
}, true);
$("edit-positions").onclick = () => {
  buildPositionEditor(draftPositions);
  $("layout-dialog").showModal();
};
$("reset-positions").onclick = () => buildPositionEditor(tabletop.defaultPositions);
$("cancel-positions").onclick = () => $("layout-dialog").close();
$("save-positions").onclick = () => {
  const positions = Object.fromEntries(Array.from($("layout-coordinates").children,
    (row) => [row.dataset.zone, row.readPosition()]));
  if (!Object.values(positions).every(validPosition)) {
    $("layout-status").textContent = "Enter whole percentages and keep every zone within the playmat.";
    return;
  }
  draftPositions = positions;
  $("ui-layout").value = "custom";
  $("layout-dialog").close();
};
$("dismiss-victor").onclick = () => $("victor-dialog").close();
$("victor-dialog").addEventListener("close", () => {
  showNextVictorDisplay();
  if (!$("victor-dialog").open && state.finished) $("restart").focus();
});
$("add-victor").onclick = () => {
  if ($("victor-displays").children.length >= 10) {
    setStatus("Use up to 10 victor displays.");
    return;
  }
  addVictorEditor().focus();
};
$("players").oninput = updatePlayerFields;
$("toggle-sound").onclick = () => {
  soundEnabled = !soundEnabled;
  syncSound();
};
$("edit-tab").onclick = () => showWorkspace(true);
$("restart").onclick = () => {
  if (window.confirm("Restart this table? The current match will be lost.")) startTable(definition);
};
$("reveal").onclick = () => {
  handVisible = !handVisible;
  selected = null;
  renderTable();
};
$("draw").onclick = () => {
  if (onlineRoom) { sendRoomAction({ type: "draw" }); return; }
  tabletop.draw(state, state.active);
  selected = null;
  renderTable();
  setStatus("Card drawn.");
  playEffect("draw");
};
$("shuffle").onclick = () => {
  if (onlineRoom) { sendRoomAction({ type: "shuffle" }); return; }
  tabletop.shuffle(state.deck);
  selected = null;
  renderTable();
  setStatus("Deck shuffled.");
};
$("end-turn").onclick = () => {
  if (onlineRoom) { sendRoomAction({ type: "end" }); return; }
  const drawn = tabletop.endTurn(state);
  selected = null;
  handVisible = false;
  renderTable();
  if (state.winner !== null) {
    setStatus(playerLabel(state.winner) + " wins at the start of the turn.");
    $("restart").focus();
    playEffect("win");
  } else {
    setStatus("Pass to " + playerLabel(state.active) + ". Cards drawn: " + drawn + ".");
    $("reveal").focus();
    if (drawn) playEffect("draw");
  }
};
$("move").onclick = () => {
  if (onlineRoom) {
    if (selected) sendRoomAction({ type: "move", ...selected, destination: $("destination").value });
    return;
  }
  const active = state.active;
  const { zone, id } = selected;
  const destination = $("destination").value;
  const result = tabletop.move(state, zone, destination, id);
  if (result) {
    selected = null;
    handleTurnChange(active);
    renderTable();
    const effects = [];
    if (result.drawn) effects.push("Cards drawn: " + result.drawn + ".");
    if (result.points) effects.push("Points earned: " + result.points + ".");
    for (const change of result.changes) {
      const label = (change.target === "self" ? state.game.stats : state.game.counters)
        .find(({ id }) => id === change.field).label;
      const owner = change.target === "self" ? "" : playerLabel(change.player) + " · ";
      effects.push(owner + label + ": " + change.value + ".");
    }
    if (state.winner !== null) effects.push(playerLabel(state.winner) + " wins!");
    if (!state.finished && active !== state.active) effects.push("Pass to " + playerLabel(state.active) + ".");
    setStatus(["Card moved to " + tabletop.zones(state)[destination].label + ".", ...effects].join(" "));
    if (state.winner !== null) $("restart").focus();
    if (result.sound) playEffect(null, result.sound);
    else playEffect([state.winner !== null && "win", result.drawn && "draw", "move"]
      .find((key) => key && definition.audio[key]));
  }
};
$("flip").onclick = () => {
  if (onlineRoom) {
    if (selected) sendRoomAction({ type: "flip", ...selected });
    return;
  }
  const card = tabletop.zones(state)[selected.zone].cards.find((entry) => entry.id === selected.id);
  card.faceUp = !card.faceUp;
  renderTable();
  setStatus(card.faceUp ? "Card turned face up." : "Card turned face down.");
  playEffect("flip");
};
$("add-card").onclick = () => {
  if ($("library").children.length >= 100) {
    setStatus("A game can have up to 100 card designs.");
    return;
  }
  addCardEditor().focus();
};
$("game-form").onsubmit = (event) => {
  event.preventDefault();
  if (onlineRoom) { setStatus("Leave the online room before starting a local table."); return; }
  try {
    startTable(readEditor());
  } catch (error) {
    setStatus(error.message);
  }
};
$("export").onclick = () => {
  try {
    const game = readEditor();
    const file = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = element("a");
    link.href = url;
    const slug = game.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    link.download = (slug || "sandbox-game") + ".preset.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Game preset downloaded.");
  } catch (error) {
    setStatus(error.message);
  }
};
$("import").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const input = event.target;
  input.disabled = true;
  $("load-default-preset").disabled = true;
  try {
    if (file.size > 100000000) throw new Error("Choose a game file up to 100 MB.");
    const imported = tabletop.validate(JSON.parse(await file.text()));
    const images = new Set([imported.theme.matArtwork, imported.theme.backArtwork,
      ...imported.cards.map((card) => card.artwork),
      ...imported.victorDisplays.map((display) => display.artwork),
      ...imported.counterRules.map((rule) => rule.artwork)]);
    images.delete("");
    for (const source of images) await checkArtwork(source);
    const fonts = new Set([imported.theme.font,
      ...Object.values(imported.theme.typography).map((style) => style.font)]);
    fonts.delete("");
    for (const font of fonts) await loadThemeFont(font);
    fillEditor(imported);
    setStatus("Game preset loaded into the editor. Choose Start new table to play.");
  } catch (error) {
    setStatus("Could not import game. " + error.message);
  } finally {
    input.value = "";
    input.disabled = false;
    $("load-default-preset").disabled = !$("default-presets").value;
  }
};

fillEditor(definition);
applyTheme(definition.theme);
applyLayout(definition.ui);
renderTable();
