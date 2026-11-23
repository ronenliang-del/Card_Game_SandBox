const roomSessionKey = "sandbox-online-seat";
let onlineConnecting = false;

function readInvite(link) {
  const pattern = /^([a-zA-Z0-9_-]{16})\.([a-zA-Z0-9_-]{32})$/;
  const code = pattern.exec(link);
  if (code) return { roomId: code[1], invite: code[2] };
  const url = new URL(link);
  if (url.origin !== location.origin) throw new Error("Open the invite on the game site where the room was created.");
  const match = url.hash.startsWith("#join=") && pattern.exec(url.hash.slice(6));
  if (!match) throw new Error("Paste the complete invite link, including the #join= part, or ask the host for the room code.");
  return { roomId: match[1], invite: match[2] };
}

function showInviteFromAddress() {
  if (onlineRoom || !location.hash.startsWith("#join=")) return false;
  $("join-invite").value = location.href;
  showWorkspace(true);
  return true;
}

function roomCanAct() {
  return onlineRoom.ready && !state.finished && state.active === onlineRoom.player;
}

function renderOnlineControls() {
  const room = onlineRoom;
  $("online-table").hidden = !room;
  $("create-room").disabled = Boolean(room || onlineConnecting);
  if (!room) return;
  const opponent = state.game.playerLabels[1 - room.player];
  $("room-status").textContent = room.error || (!room.ready
    ? "Waiting for a second player"
    : "Online · You are " + playerLabel(room.player) + " · Opponent: " + opponent +
      " (" + room.opponentCards + " cards)" +
      (state.finished ? "" : (roomCanAct() ? " · Your turn" : " · Waiting for their turn")));
  $("invite-panel").hidden = room.ready || !room.invite;
  if (!$("invite-panel").hidden) {
    const link = new URL("./", location.href);
    link.hash = "join=" + room.id + "." + room.invite;
    $("invite-link").value = link.href;
  }
}

async function roomRequest(path, { body, token } = {}) {
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    throw new Error("Open this game through a sandbox server to use online rooms.");
  }
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(new URL("api/rooms" + path, location.href), {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 204) return null;
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("This site needs the sandbox server for online rooms.");
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

function seatStorage(seat) {
  try {
    if (seat) sessionStorage.setItem(roomSessionKey, JSON.stringify(seat));
    else sessionStorage.removeItem(roomSessionKey);
  } catch {
    // Private browsing can disable storage. The in-memory seat still works.
  }
}

function acceptRoomSnapshot(room, snapshot, initial = false) {
  if (!snapshot || onlineRoom !== room || snapshot.revision <= room.revision) return;
  room.ready = snapshot.ready;
  if (room.ready && room.invite) {
    room.invite = null;
    seatStorage({ id: room.id, token: room.token });
  }
  room.revision = snapshot.revision;
  room.error = "";
  room.player = snapshot.player;

  // Resolve only the card identities the server chose to reveal to this seat.
  const cardView = (card) => card.faceUp
    ? { ...card, design: definition.cards[card.design] }
    : card;
  const { hand, handCounts, deckCount, table, discard, ...publicState } = snapshot.state;
  room.opponentCards = handCounts[1 - room.player];
  const pendingDisplays = initial ? [] : state.pendingDisplays;
  for (const event of snapshot.displays) {
    if (event.id <= room.lastDisplay) continue;
    const displays = event.subject === undefined ? definition.victorDisplays : definition.counterRules;
    pendingDisplays.push({ ...event, display: displays[event.index] ?? null });
    room.lastDisplay = event.id;
  }
  const hands = handCounts.map(() => []);
  hands[room.player] = hand.map(cardView);
  state = {
    ...publicState, game: definition, hands, pendingDisplays,
    deck: Array(deckCount).fill({ faceUp: false }),
    table: table.map(cardView), discard: discard.map(cardView),
  };
  selected = null;
  renderTable();

  if (!initial && snapshot.sound && !$("play").hidden) {
    const { key, card } = snapshot.sound;
    if (key) playEffect(key);
    else playEffect(null, definition.cards[card]?.playSound);
  }
}

function enterOnlineRoom(data, id = data.id, token = data.token, invite = data.invite) {
  const room = {
    id, token, invite, revision: -1, lastDisplay: 0, ready: false, busy: false, error: "",
    local: { definition, state, handVisible },
  };
  onlineRoom = room;
  seatStorage({ id, token, invite });
  definition = data.game;
  handVisible = true;
  music?.pause();
  effect?.pause();
  music = effect = null;
  applyTheme(definition.theme);
  applyLayout(definition.ui);
  showWorkspace(false);
  acceptRoomSnapshot(room, data, true);
  pollRoom(room);
}

async function pollRoom(room) {
  if (onlineRoom !== room) return;
  try {
    const snapshot = await roomRequest("/" + room.id + "/state?after=" + room.revision, { token: room.token });
    if (onlineRoom !== room) return;
    room.error = "";
    if (snapshot) acceptRoomSnapshot(room, snapshot);
    else renderOnlineControls();
  } catch (error) {
    if (onlineRoom !== room) return;
    if (error.status === 403 || error.status === 404) {
      room.error = error.message;
      room.ready = false;
      room.invite = null;
      renderTable();
      return;
    }
    room.error = "Connection interrupted. Retrying…";
    renderOnlineControls();
  }
  if (onlineRoom === room) room.pollTimer = setTimeout(() => pollRoom(room), 900);
}

async function sendRoomAction(action) {
  const room = onlineRoom;
  if (!room || room.busy || !roomCanAct()) return;
  room.busy = true;
  try {
    const snapshot = await roomRequest("/" + room.id + "/action", {
      body: { ...action, revision: room.revision },
      token: room.token,
    });
    acceptRoomSnapshot(room, snapshot);
  } catch (error) {
    if (onlineRoom === room) setStatus(error.message);
  } finally {
    room.busy = false;
  }
}

async function connectOnline(path, body) {
  if (onlineConnecting || onlineRoom) return;
  onlineConnecting = true;
  renderOnlineControls();
  $("join-room").disabled = true;
  try {
    const data = await roomRequest(path, { body });
    enterOnlineRoom(data);
    if (location.hash.startsWith("#join=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    $("join-invite").value = "";
  } catch (error) {
    setStatus(error.message);
  } finally {
    onlineConnecting = false;
    $("join-room").disabled = false;
    renderOnlineControls();
  }
}

$("create-room").onclick = () => {
  try {
    const game = readEditor();
    if (game.players !== 2) throw new Error("Set Players to 2 before starting an online room.");
    connectOnline("", game);
  } catch (error) {
    setStatus(error.message);
  }
};
$("join-room").onclick = () => {
  const link = $("join-invite").value.trim();
  if (!link) { setStatus("Paste the private invite link first."); return; }
  try {
    const { roomId, invite } = readInvite(link);
    connectOnline("/" + roomId + "/join", { invite });
  } catch (error) {
    setStatus(error instanceof TypeError ? "Paste the complete invite link or room code." : error.message);
  }
};
$("copy-invite").onclick = async () => {
  const input = $("invite-link");
  try { await navigator.clipboard.writeText(input.value); setStatus("Invite link copied."); }
  catch { input.select(); setStatus("Copy the selected invite link."); }
};
$("copy-room-code").onclick = async () => {
  if (!onlineRoom?.invite) return;
  const code = onlineRoom.id + "." + onlineRoom.invite;
  try { await navigator.clipboard.writeText(code); setStatus("Room code copied."); }
  catch { setStatus("Copy this room code: " + code); }
};
$("leave-room").onclick = () => {
  if (!onlineRoom) return;
  roomRequest("/" + onlineRoom.id + "/leave", { body: {}, token: onlineRoom.token }).catch(() => {});
  clearTimeout(onlineRoom.pollTimer);
  ({ definition, state, handVisible } = onlineRoom.local);
  onlineRoom = null;
  selected = null;
  seatStorage(null);
  music?.pause();
  effect?.pause();
  music = effect = null;
  applyTheme(definition.theme);
  applyLayout(definition.ui);
  showWorkspace(false);
  renderOnlineControls();
  renderTable();
};

window.addEventListener("hashchange", showInviteFromAddress);
if (!showInviteFromAddress()) {
  (async () => {
    let seat;
    try { seat = JSON.parse(sessionStorage.getItem(roomSessionKey)); } catch {}
    if (!seat?.id || !seat?.token) return;
    onlineConnecting = true;
    renderOnlineControls();
    try {
      const data = await roomRequest("/" + seat.id + "/state?after=-1", { token: seat.token });
      enterOnlineRoom(data, seat.id, seat.token, seat.invite);
    } catch (error) {
      if (error.status === 403 || error.status === 404) seatStorage(null);
      setStatus(error.message);
    } finally {
      onlineConnecting = false;
      renderOnlineControls();
    }
  })();
}
