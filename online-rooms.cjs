const { randomBytes, randomInt, randomUUID } = require("node:crypto");
const tabletop = require("./tabletop.js");

const rooms = new Map();
const roomLimit = 24;
const roomLifetime = 2 * 60 * 60 * 1000;
const maxPresetBytes = 3 * 1024 * 1024;
let pendingCreates = 0;

function token() { return randomBytes(24).toString("base64url"); }

function reply(response, status, data) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function readJSON(request, maxBytes) {
  if (request.headers["content-type"] !== "application/json") throw new Error("Send JSON.");
  if (Number(request.headers["content-length"]) > maxBytes) throw new Error("Request is too large.");
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request is too large."));
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (size > maxBytes) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Invalid JSON.")); }
    });
  });
}

function collectDisplays(room) {
  for (const event of room.state.pendingDisplays.splice(0)) {
    const displays = event.subject === undefined ? room.game.victorDisplays : room.game.counterRules;
    const { display, ...rest } = event;
    room.displays.push({ ...rest, index: displays.indexOf(display), id: ++room.eventId });
  }
  room.displays.splice(0, Math.max(0, room.displays.length - 50));
}

function snapshot(room, player, includeGame) {
  const { state } = room;
  const cardView = (card) => card.faceUp
    ? { id: card.id, faceUp: true, design: room.cardIndexes.get(card.design), stats: card.stats }
    : { id: card.id, faceUp: false };
  return {
    player, ready: Boolean(room.players[1]), revision: room.revision,
    ...(includeGame ? { game: room.game } : {}),
    state: {
      active: state.active, turn: state.turn, winner: state.winner, finished: state.finished,
      eliminated: state.eliminated, scores: state.scores, counters: state.counters,
      deckCount: state.deck.length,
      hand: state.hands[player].map(cardView), handCounts: state.hands.map((hand) => hand.length),
      table: state.table.map(cardView), discard: state.discard.map(cardView),
    },
    displays: room.displays,
    sound: room.sound,
  };
}

function act(room, player, action) {
  const { state } = room;
  if (!action || typeof action !== "object") return false;
  if (state.finished || state.active !== player || !room.players[1]) return false;
  if (action.type === "draw" && state.deck.length) {
    tabletop.draw(state, player);
    room.sound = { key: "draw" };
    return true;
  }
  if (action.type === "shuffle" && state.deck.length > 1) {
    tabletop.shuffle(state.deck, randomInt);
    room.sound = null;
    return true;
  }
  if (action.type === "end") {
    const drawn = tabletop.endTurn(state);
    room.sound = state.finished ? { key: "win" } : (drawn ? { key: "draw" } : null);
    return true;
  }
  if (action.type === "points" || action.type === "counter") {
    const changed = action.type === "points"
      ? tabletop.adjustPoints(state, player, action.amount)
      : typeof action.counter === "string" && tabletop.adjustCounter(state, player, action.counter, action.amount);
    if (changed) room.sound = state.finished && state.winner !== null ? { key: "win" } : null;
    return changed;
  }
  const visibleZones = ["hand", "table", "discard"];
  if (!visibleZones.includes(action.zone) || typeof action.id !== "string") return false;
  const source = tabletop.zones(state)[action.zone].cards.find((card) => card.id === action.id);
  if (!source) return false;
  if (action.type === "flip") {
    source.faceUp = !source.faceUp;
    room.sound = { key: "flip" };
    return true;
  }
  if (action.type !== "move" || ![...visibleZones, "deck"].includes(action.destination)) return false;
  const result = tabletop.move(state, action.zone, action.destination, action.id);
  if (!result) return false;
  const keys = [state.winner !== null && "win", result.drawn && "draw", "move"];
  const fallback = keys.find((key) => key && room.game.audio[key]);
  room.sound = result.sound ? { card: room.cardIndexes.get(source.design) } : (fallback ? { key: fallback } : null);
  return true;
}

function trimRooms() {
  const cutoff = Date.now() - roomLifetime;
  for (const [id, room] of rooms) {
    if (room.touched < cutoff) rooms.delete(id);
  }
}

async function handleRooms(request, response, url, allowedOrigins) {
  const route = /^\/api\/rooms(?:\/([a-zA-Z0-9_-]{16})(?:\/(join|state|action|leave))?)?$/.exec(url.pathname);
  if (!route) { reply(response, 404, { error: "Room endpoint not found." }); return; }
  const [, roomId, operation] = route;
  const post = request.method === "POST";
  if ((operation === "state" ? request.method !== "GET" : !post) || (post && !allowedOrigins.includes(request.headers.origin))) {
    reply(response, 403, { error: "Open the sandbox at its configured address to use online play." });
    return;
  }
  trimRooms();
  try {
    if (!roomId) {
      if (rooms.size + pendingCreates >= roomLimit || pendingCreates >= 3) {
        reply(response, 503, { error: "The room server is busy. Try again shortly." });
        return;
      }
      pendingCreates++;
      try {
        const raw = await readJSON(request, maxPresetBytes);
        const game = tabletop.validate(raw);
        if (game.players !== 2) throw new Error("Online rooms require a two-player preset.");
        const state = tabletop.start(game, { randomIndex: randomInt, cardId: () => randomUUID() });
        const room = {
          game, state, cardIndexes: new Map(game.cards.map((card, index) => [card, index])),
          invite: token(), players: [token(), null], revision: 0, eventId: 0, displays: [],
          touched: Date.now(), sound: null,
        };
        const id = randomBytes(12).toString("base64url");
        collectDisplays(room);
        rooms.set(id, room);
        reply(response, 201, { id, token: room.players[0], invite: room.invite, ...snapshot(room, 0, true) });
      } finally { pendingCreates--; }
      return;
    }
    const room = rooms.get(roomId);
    if (!room || !operation) { reply(response, 404, { error: "This room is unavailable or expired." }); return; }
    if (operation === "join") {
      const body = await readJSON(request, 2048);
      if (!room.invite || body?.invite !== room.invite) {
        reply(response, 403, { error: "This invite is invalid or has already been used." });
        return;
      }
      room.players[1] = token();
      room.invite = null;
      room.revision++;
      room.touched = Date.now();
      reply(response, 200, { id: roomId, token: room.players[1], ...snapshot(room, 1, true) });
      return;
    }
    const header = request.headers.authorization;
    const player = typeof header === "string" && header.startsWith("Bearer ")
      ? room.players.indexOf(header.slice(7)) : -1;
    if (player < 0) { reply(response, 403, { error: "This browser doesn’t have a seat in the room." }); return; }
    room.touched = Date.now();
    if (operation === "leave") {
      rooms.delete(roomId);
      response.writeHead(204).end();
      return;
    }
    if (operation === "state") {
      const after = Number(url.searchParams.get("after") ?? -1);
      if (after === room.revision) { response.writeHead(204).end(); return; }
      reply(response, 200, snapshot(room, player, after === -1));
      return;
    }
    const action = await readJSON(request, 2048);
    if (action?.revision !== room.revision) {
      reply(response, 409, { error: "The table changed. Wait for the updated view and try again." });
      return;
    }
    if (!act(room, player, action)) {
      reply(response, 422, { error: "That move is unavailable." });
      return;
    }
    room.revision++;
    collectDisplays(room);
    reply(response, 200, snapshot(room, player, false));
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Request could not be completed.";
    reply(response, message === "Request is too large." ? 413 : 400, {
      error: message === "Request is too large." ? "Online presets must be under 3 MB." : message,
    });
  }
}

module.exports = { handleRooms };
