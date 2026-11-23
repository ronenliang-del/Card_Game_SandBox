const tabletop = (() => {
  const artworkPattern = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;
  const defaultTheme = { mat: "#ddd4bc", menu: "#f5eddf", button: "#a43e28", matArtwork: "", backArtwork: "" };
  const typographyAreas = [
    { key: "cards", label: "Cards", size: 16, color: "#231e18" },
    { key: "menus", label: "Menus", size: 16, color: "#231e18" },
    { key: "victor", label: "Victor screens", size: 18, color: "#231e18" },
  ];
  const defaultLabels = { deck: "Deck", hand: "Active hand", table: "Table", discard: "Discard" };
  const defaultPositions = {
    deck: { x: 2, y: 2, width: 47, height: 46 },
    hand: { x: 51, y: 2, width: 47, height: 46 },
    table: { x: 2, y: 50, width: 47, height: 48 },
    discard: { x: 51, y: 50, width: 47, height: 48 },
  };
  const cardSound = { key: "card", label: "Card play sound", maxBytes: 300000 };
  const fontMaxBytes = 2000000;
  const maxStatistic = 999999;
  const mathOperations = ["add", "subtract", "multiply", "divide", "set"];
  const audioSlots = [
    { key: "music", label: "Background music", maxBytes: 5000000 },
    { key: "draw", label: "Draw a card", maxBytes: 300000 },
    { key: "move", label: "Move a card", maxBytes: 300000 },
    { key: "flip", label: "Flip a card", maxBytes: 300000 },
    { key: "win", label: "Win the game", maxBytes: 300000 },
  ];
  const sample = {
    version: 1,
    title: "High Score Card Game",
    players: 2,
    startingHand: 3,
    turnDraw: 1,
    rules: "On your turn, play one card face up to the table. Leave it there until you start your next turn, then discard it. Remember the points you earn: Pebble is worth 1, Leaf is worth 2, and Star is worth 3. End your turn and pass the screen. The first player to 8 points wins.",
    cards: [
      { name: "Pebble", text: "Worth 1 point.", copies: 8, artwork: "" },
      { name: "Leaf", text: "Worth 2 points.", copies: 8, artwork: "" },
      { name: "Star", text: "Worth 3 points.", copies: 8, artwork: "" },
    ],
  };

  const combatPreset = {
    version: 1,
    title: "Two-Player Card Combat",
    players: 2,
    startingHand: 3,
    turnDraw: 1,
    rules: "Each player starts with 12 Health. Reveal your hand, play one card face up to the table, then end your turn. Strike cards deal their Attack as damage to the other player. Field Aid restores 2 Health to you. The first player to reduce the other player's Health to zero wins.",
    stats: [{ id: "attack", label: "Attack", initial: 0 }],
    counters: [{ id: "health", label: "Health", initial: 12 }],
    counterRules: [{
      counter: "health",
      comparison: "atMost",
      threshold: 0,
      outcome: "lose",
      title: "Arena Champion",
      message: "The final strike ends the duel. The arena has a champion.",
    }],
    cards: [
      ...[["Quick Strike", 2, 10], ["Heavy Strike", 4, 8]].map(([name, attack, copies]) => ({
        name, copies,
        text: "Deal " + attack + " damage to the other player.",
        stats: { attack },
        interactions: [{ target: "next", field: "health", operation: "subtract", operandStat: "attack" }],
      })),
      {
        name: "Field Aid", text: "Restore 2 of your Health.", copies: 6, stats: { attack: null },
        interactions: [{ target: "active", field: "health", operation: "add", amount: 2 }],
      },
    ],
  };
  const defaultPresets = { sample, combat: combatPreset };

  function integer(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(label + " must be a whole number from " + min + " to " + max + ".");
    }
    return value;
  }

  function text(value, limit, label, required = false) {
    if (typeof value !== "string" || value.length > limit || (required && !value.trim())) {
      throw new Error("Check " + label + " (up to " + limit + " characters).");
    }
    return value.trim();
  }

  function artwork(value, label) {
    const image = text(value ?? "", 750000, label);
    if (image && !artworkPattern.test(image)) {
      throw new Error("Artwork must be an embedded PNG, JPEG, WebP, or GIF.");
    }
    return image;
  }

  function color(value, fallback) {
    const result = value ?? fallback;
    if (typeof result !== "string" || !/^#[a-f0-9]{6}$/i.test(result)) {
      throw new Error("Choose valid theme colors.");
    }
    return result;
  }

  function audioSource(value, slot) {
    const source = text(value ?? "", Math.ceil(slot.maxBytes / 3) * 4 + 32, slot.label);
    if (source && !/^data:audio\/(mpeg|mp3|wav|wave|x-wav|ogg|mp4|x-m4a);base64,[a-z0-9+/]+={0,2}$/i.test(source)) {
      throw new Error(slot.label + " must be embedded MP3, WAV, Ogg, or M4A audio.");
    }
    return source;
  }

  function fontSource(value) {
    const source = text(value ?? "", Math.ceil(fontMaxBytes / 3) * 4 + 32, "theme font");
    if (source && !/^data:font\/(woff2?|ttf|otf);base64,[a-z0-9+/]+={0,2}$/i.test(source)) {
      throw new Error("Choose an embedded WOFF2, WOFF, TTF, or OTF font.");
    }
    return source;
  }

  function zonePosition(value, fallback) {
    const position = {
      x: integer(value?.x ?? fallback.x, 0, 85, "Zone X"),
      y: integer(value?.y ?? fallback.y, 0, 85, "Zone Y"),
      width: integer(value?.width ?? fallback.width, 15, 100, "Zone width"),
      height: integer(value?.height ?? fallback.height, 15, 100, "Zone height"),
    };
    if (position.x + position.width > 100 || position.y + position.height > 100) {
      throw new Error("Zone coordinates and size must fit within the playmat.");
    }
    return position;
  }

  function statDefinitions(raw, kind) {
    const definitions = raw ?? [];
    if (!Array.isArray(definitions) || definitions.length > 8) throw new Error("Use up to eight " + kind + ".");
    const labels = new Set();
    const ids = new Set();
    return definitions.map((entry) => {
      const id = entry?.id;
      const label = text(entry?.label, 40, kind + " label", true);
      if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(id) || ids.has(id) || labels.has(label.toLowerCase())) {
        throw new Error("Give each " + kind + " definition a unique label and ID.");
      }
      ids.add(id);
      labels.add(label.toLowerCase());
      return { id, label, initial: integer(entry.initial, 0, maxStatistic, kind + " starting value") };
    });
  }

  function cardInteractions(raw, stats, counters) {
    const interactions = raw ?? [];
    if (!Array.isArray(interactions) || interactions.length > 10) throw new Error("Use up to ten interactions per card.");
    return interactions.map((interaction) => {
      const target = interaction?.target;
      const playerTarget = target === "active" || target === "next";
      if ((target !== "self" && !playerTarget) || !mathOperations.includes(interaction.operation) ||
          !(playerTarget ? counters : stats).some(({ id }) => id === interaction.field)) {
        throw new Error("Choose a valid interaction target, statistic or counter, and operation.");
      }
      const operandStat = interaction.operandStat ?? "";
      if (operandStat !== "" && !stats.some(({ id }) => id === operandStat)) {
        throw new Error("Choose a valid source statistic for the interaction.");
      }
      const amount = operandStat ? 0 : integer(interaction.amount, 0, maxStatistic, "Interaction amount");
      if (!operandStat && interaction.operation === "divide" && amount === 0) {
        throw new Error("A divide interaction needs a nonzero amount.");
      }
      return { target, field: interaction.field, operation: interaction.operation, operandStat, amount };
    });
  }

  function counterRules(raw, counters) {
    const rules = raw ?? [];
    if (!Array.isArray(rules) || rules.length > 10) throw new Error("Use up to ten counter rules.");
    return rules.map((rule) => {
      if (!counters.some(({ id }) => id === rule?.counter) ||
          !["atMost", "atLeast"].includes(rule.comparison) ||
          !["show", "win", "lose"].includes(rule.outcome)) {
        throw new Error("Choose a valid counter, comparison, and outcome for each counter rule.");
      }
      return {
        counter: rule.counter,
        comparison: rule.comparison,
        threshold: integer(rule.threshold, 0, maxStatistic, "Counter rule threshold"),
        outcome: rule.outcome,
        title: text(rule.title ?? "", 80, "counter screen title"),
        message: text(rule.message ?? "", 500, "counter screen message"),
        artwork: artwork(rule.artwork, "counter screen artwork"),
      };
    });
  }

  // Both imported JSON and editor submissions use the same validation.
  function validate(raw) {
    if (raw?.version !== 1) throw new Error("Choose a version 1 sandbox game file.");
    if (!Array.isArray(raw.cards) || raw.cards.length < 1 || raw.cards.length > 100) {
      throw new Error("A game needs 1 to 100 card designs.");
    }
    const players = integer(raw.players, 1, 6, "Players");
    const stats = statDefinitions(raw.stats, "card statistics");
    const counters = statDefinitions(raw.counters, "player counters");
    if (raw.playerLabels != null && (!Array.isArray(raw.playerLabels) || raw.playerLabels.length !== players)) {
      throw new Error("Provide one label for each player.");
    }
    const displays = raw.victorDisplays ?? [];
    if (!Array.isArray(displays) || displays.length > 10) throw new Error("Use up to 10 victor displays.");
    const victorDisplays = displays.map((display) => {
      if (typeof display?.endsGame !== "boolean") throw new Error("Check the victor display settings.");
      return {
        points: integer(display.points, 1, 999, "Victor display threshold"),
        title: text(display.title, 80, "victor display title", true),
        message: text(display.message ?? "", 500, "victor display message"),
        artwork: artwork(display.artwork, "victor display artwork"),
        endsGame: display.endsGame,
      };
    }).sort((a, b) => a.points - b.points);
    if (new Set(victorDisplays.map((display) => display.points)).size !== displays.length) {
      throw new Error("Give each victor display a different point threshold.");
    }
    const game = {
      version: 1,
      title: text(raw.title, 80, "the game title", true),
      players,
      stats,
      counters,
      counterRules: counterRules(raw.counterRules, counters),
      victorDisplays,
      playerLabels: Array.from({ length: players }, (_, player) =>
        text(raw.playerLabels?.[player] ?? "Player " + (player + 1), 40, "player label", true)
      ),
      manualPoints: raw.manualPoints ?? false,
      ui: {
        title: text(raw.ui?.title ?? "Card Game Sandbox", 80, "header title", true),
        layout: raw.ui?.layout ?? "grid",
        cardSize: raw.ui?.cardSize ?? "standard",
        positions: Object.fromEntries(Object.entries(defaultPositions).map(([zone, fallback]) => [
          zone, zonePosition(raw.ui?.positions?.[zone], fallback),
        ])),
        labels: Object.fromEntries(Object.entries(defaultLabels).map(([zone, fallback]) => [
          zone, text(raw.ui?.labels?.[zone] ?? fallback, 40, zone + " label", true),
        ])),
      },
      startingHand: integer(raw.startingHand, 0, 30, "Starting hand"),
      turnDraw: integer(raw.turnDraw, 0, 30, "Turn draw"),
      rules: text(raw.rules, 10000, "the rulebook"),
      audio: Object.fromEntries(audioSlots.map((slot) => [
        slot.key, audioSource(raw.audio?.[slot.key], slot),
      ])),
      // Missing fields get defaults so old game files still work.
      theme: {
        mat: color(raw.theme?.mat, defaultTheme.mat),
        menu: color(raw.theme?.menu, defaultTheme.menu),
        button: color(raw.theme?.button, defaultTheme.button),
        matArtwork: artwork(raw.theme?.matArtwork, "playmat artwork"),
        backArtwork: artwork(raw.theme?.backArtwork, "card back artwork"),
        font: fontSource(raw.theme?.font),
        typography: Object.fromEntries(typographyAreas.map((area) => {
          const style = raw.theme?.typography?.[area.key];
          return [area.key, {
            font: fontSource(style?.font),
            size: integer(style?.size ?? area.size, 12, 36, area.label + " text size"),
            color: style?.color == null || style.color === "" ? "" : color(style.color, area.color),
          }];
        })),
      },
      winPoints: integer(raw.winPoints ?? 0, 0, 999, "Points to win"),
      turnPoints: integer(raw.turnPoints ?? 0, 0, 30, "Points at turn start"),
      winEmptyHand: raw.winEmptyHand ?? false,
      cards: raw.cards.map((card, index) => {
        const label = "card " + (index + 1);
        return {
          name: text(card?.name, 80, label + " name", true),
          text: text(card.text, 500, label + " text"),
          copies: integer(card.copies, 1, 100, "Copies for " + label),
          artwork: artwork(card.artwork, label + " artwork"),
          playDraw: integer(card.playDraw ?? 0, 0, 30, "Draw effect for " + label),
          playPoints: integer(card.playPoints ?? 0, 0, 30, "Point effect for " + label),
          playSound: audioSource(card.playSound, cardSound),
          stats: Object.fromEntries(stats.map(({ id, initial }) => {
            const value = Object.hasOwn(card.stats ?? {}, id) ? card.stats[id] : initial;
            return [id, value === null ? null : integer(value, 0, maxStatistic, "Card statistic")];
          })),
          interactions: cardInteractions(card.interactions, stats, counters),
        };
      }),
    };
    if (typeof game.manualPoints !== "boolean") throw new Error("Choose a valid manual scoring setting.");
    if (!["grid", "stack", "custom"].includes(game.ui.layout) || !["standard", "compact", "large"].includes(game.ui.cardSize)) {
      throw new Error("Choose a supported layout and card size.");
    }
    const media = [
      ...Object.values(game.audio), game.theme.matArtwork, game.theme.backArtwork, game.theme.font,
      ...Object.values(game.theme.typography).map((style) => style.font),
      ...game.cards.flatMap((card) => [card.artwork, card.playSound]),
      ...game.victorDisplays.map((display) => display.artwork),
      ...game.counterRules.map((rule) => rule.artwork),
    ];
    if (media.reduce((size, source) => size + source.length, 0) > 95000000) {
      throw new Error("This preset contains too much embedded media. Remove or compress some files.");
    }
    if (typeof game.winEmptyHand !== "boolean") throw new Error("Choose a valid last-card win setting.");
    const copies = game.cards.reduce((total, card) => total + card.copies, 0);
    if (copies > 300) throw new Error("Use at most 300 total cards.");
    if (copies < game.startingHand * game.players) throw new Error("Add enough cards to deal every starting hand.");
    return game;
  }

  function shuffle(cards, randomIndex = (limit) => Math.floor(Math.random() * limit)) {
    for (let index = cards.length - 1; index > 0; index--) {
      const other = randomIndex(index + 1);
      [cards[index], cards[other]] = [cards[other], cards[index]];
    }
  }

  function draw(state, player, count = 1) {
    if (state.finished || state.eliminated[player] || count === 0) return 0;
    const drawn = state.deck.splice(-Math.min(count, state.deck.length), count);
    state.hands[player].push(...drawn);
    return drawn.length;
  }

  function start(game, { randomIndex, cardId = (number) => number } = {}) {
    // Each copy has its own identity and face state. Copies share their card design.
    let id = 0;
    const state = {
      game,
      deck: game.cards.flatMap((design) =>
        Array.from({ length: design.copies }, () => ({ id: cardId(++id), design, faceUp: true, stats: { ...design.stats } }))
      ),
      table: [],
      discard: [],
      hands: Array.from({ length: game.players }, () => []),
      scores: Array(game.players).fill(0),
      counters: Array.from({ length: game.players }, () =>
        Object.fromEntries(game.counters.map(({ id, initial }) => [id, initial]))
      ),
      highestScores: Array(game.players).fill(0),
      pendingDisplays: [],
      eliminated: Array(game.players).fill(false),
      firedCounterRules: game.counters.length ? Array.from({ length: game.players }, () => new Set()) : [],
      finished: false,
      winner: null,
      active: 0,
      turn: 1,
    };
    shuffle(state.deck, randomIndex);
    state.hands.forEach((_, player) => draw(state, player, game.startingHand));
    startTurn(state);
    return state;
  }

  function awardPoints(state, player, count) {
    state.scores[player] = Math.max(0, state.scores[player] + count);
    // A threshold fires the first time a player reaches or passes it, including on a large award.
    const previousHigh = state.highestScores[player];
    const endingDisplay = state.game.victorDisplays.find((display) =>
      display.endsGame && display.points > previousHigh && display.points <= state.scores[player]
    );
    const finishAt = Math.min(endingDisplay?.points ?? Infinity, state.game.winPoints || Infinity);
    for (const display of state.game.victorDisplays) {
      if (display.points > previousHigh && display.points <= Math.min(state.scores[player], finishAt)) {
        state.pendingDisplays.push({ player, display, final: display.points === finishAt });
      }
    }
    state.highestScores[player] = Math.max(previousHigh, state.scores[player]);
    if (state.scores[player] >= finishAt) {
      finishGame(state, player);
    }
  }

  function finishGame(state, player, display = null) {
    if (state.finished) return;
    state.finished = true;
    state.winner = player;
    if (display) {
      state.pendingDisplays.push({ ...display, player, final: true });
    } else if (!state.pendingDisplays.at(-1)?.final) {
      state.pendingDisplays.push({ player, display: null, final: true });
    }
  }

  function adjustPoints(state, player, amount) {
    if (!state.game.manualPoints || state.finished || state.eliminated[player] || !Number.isInteger(player) ||
        !(player in state.scores) || ![-1, 1].includes(amount)) return false;
    awardPoints(state, player, amount);
    return true;
  }

  function adjustCounter(state, player, counter, amount) {
    if (state.finished || state.eliminated[player] || !Number.isInteger(player) ||
        !Object.hasOwn(state.counters[player] ?? {}, counter) ||
        ![-1, 1].includes(amount)) return false;
    const values = state.counters[player];
    const before = values[counter];
    values[counter] = Math.min(maxStatistic, Math.max(0, values[counter] + amount));
    checkCounterRules(state, player, counter, before, values[counter]);
    advancePastEliminated(state);
    return true;
  }

  function checkCounterRules(state, player, counter, before, after) {
    if (before === after) return;
    const fired = state.firedCounterRules[player];
    for (const [index, rule] of state.game.counterRules.entries()) {
      if (rule.counter !== counter || fired.has(index)) continue;
      const crossed = rule.comparison === "atMost"
        ? before > rule.threshold && after <= rule.threshold
        : before < rule.threshold && after >= rule.threshold;
      if (!crossed) continue;
      fired.add(index);
      const event = { player, subject: player, display: rule, value: after, final: false };
      if (rule.outcome === "win") {
        finishGame(state, player, event);
        break;
      }
      if (rule.outcome === "lose") {
        state.eliminated[player] = true;
        const remaining = state.eliminated.flatMap((eliminated, index) => eliminated ? [] : [index]);
        if (remaining.length <= 1) finishGame(state, remaining[0] ?? null, event);
        else state.pendingDisplays.push(event);
        break;
      }
      state.pendingDisplays.push(event);
    }
  }

  function nextPlayer(state) {
    let player = state.active;
    do {
      player = (player + 1) % state.hands.length;
    } while (state.eliminated[player]);
    return player;
  }

  function advancePastEliminated(state) {
    if (!state.finished && state.eliminated[state.active]) endTurn(state);
  }

  function applyInteractions(state, card) {
    const changes = [];
    for (const { target, field, operation, operandStat, amount } of card.design.interactions) {
      if (state.finished || state.eliminated[state.active]) break;
      const player = target === "next" ? nextPlayer(state) : state.active;
      const values = target === "self" ? card.stats : state.counters[player];
      const before = values[field];
      const operand = operandStat ? card.stats[operandStat] : amount;
      if (before === null || operand === null) continue;
      let result = before;
      switch (operation) {
        case "add": result += operand; break;
        case "subtract": result -= operand; break;
        case "multiply": result *= operand; break;
        case "divide": if (operand !== 0) result = Math.floor(result / operand); break;
        case "set": result = operand; break;
      }
      values[field] = Math.min(maxStatistic, Math.max(0, result));
      if (values[field] !== before) {
        changes.push({ target, player, field, value: values[field] });
        if (target !== "self") checkCounterRules(state, player, field, before, values[field]);
      }
    }
    return changes;
  }

  function startTurn(state) {
    const drawn = draw(state, state.active, state.game.turnDraw);
    awardPoints(state, state.active, state.game.turnPoints);
    return drawn;
  }

  function endTurn(state) {
    if (state.finished) return 0;
    state.active = nextPlayer(state);
    state.turn++;
    return startTurn(state);
  }

  function zones(state) {
    return {
      deck: { label: state.game.ui.labels.deck, cards: state.deck },
      hand: { label: state.game.ui.labels.hand, cards: state.hands[state.active] },
      table: { label: state.game.ui.labels.table, cards: state.table },
      discard: { label: state.game.ui.labels.discard, cards: state.discard },
    };
  }

  function move(state, source, destination, id) {
    if (state.finished) return null;
    const available = zones(state);
    const from = available[source]?.cards;
    const to = available[destination]?.cards;
    if (!from || !to || from === to) return null;
    const index = from.findIndex((card) => card.id === id);
    if (index < 0 || (source === "deck" && index !== from.length - 1)) return null;
    const [card] = from.splice(index, 1);
    to.push(card);
    // Resolve effects after moving the card, with the draw before the win check.
    if (source === "hand" && destination === "table" && card.faceUp) {
      const drawn = draw(state, state.active, card.design.playDraw);
      const changes = applyInteractions(state, card);
      let points = 0;
      if (!state.finished && !state.eliminated[state.active]) {
        points = card.design.playPoints;
        awardPoints(state, state.active, points);
        if (state.game.winEmptyHand && state.hands[state.active].length === 0) {
          finishGame(state, state.active);
        }
      }
      advancePastEliminated(state);
      return { drawn, points, sound: card.design.playSound, changes };
    }
    return { drawn: 0, points: 0, changes: [] };
  }

  return { sample, defaultPresets, validate, start, shuffle, draw, endTurn, zones, move, adjustPoints,
    audioSlots, audioSource, cardSound, defaultPositions, fontSource, fontMaxBytes, typographyAreas,
    maxStatistic, mathOperations, adjustCounter };
})();

if (typeof module !== "undefined" && module.exports) module.exports = tabletop;
