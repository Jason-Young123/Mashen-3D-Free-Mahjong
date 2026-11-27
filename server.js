import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MODULES_DIR = path.join(ROOT, 'node_modules');
const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const SEATS = ['东', '南', '西', '北'];
const TILE_W = 0.8, TILE_H = 1.1, TILE_D = 0.5;
const TABLE_TOP = 0.45, WALL_OFFSET = 7.6, WALL_GAP = TILE_W + 0.015;
const TILE_HALF_W = TILE_W / 2, TILE_HALF_L = TILE_H / 2, TILE_HALF_D = TILE_D / 2, STACK_OVERLAP_THRESHOLD = 0.40;
const DEPTH_BIAS_STEP = 0.00025;
const HAND_DIST = 9.2, HAND_GAP = TILE_W + 0.04, TABLE_LIMIT = 10.55;
const SEAT_YAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
const clients = new Set();
const players = [null, null, null, null];
let hands = [[], [], [], []];
let scores = [0, 0, 0, 0];
let roundNumber = 1;
let roundHistory = [];
let pendingNextRound = null;
let nextRoundProposalId = 0;
let tableVersion = 1;
let tiles = new Map();
let dealerSeat = null;
let diceTimer = null;
let diceState = { rolling: false, values: [1, 1], targetValues: null, rollStartedAt: 0, rollEndsAt: 0, durationMs: 0, spin: [], rollId: 0 };
let socialInteractionId = 0;
let emojiReactionId = 0;

const EMOJI_REACTIONS = new Set(['😄', '😍', '😉', '😭', '🤔', '🙄', '🤮', '🥵', '☠️', '👍', '👎', '🤏']);
const AVATARS = ['🐼', '🐻', '🐱', '🐸', '🦊', '🐯', '🐨', '🐵', '🐰', '🦁', '🐙', '🦉', '🐧', '🐹', '🦝', '🐮'];


const deckTypes = [];
for (const type of ['wan', 'tong', 'tiao']) for (let value = 1; value <= 9; value++) deckTypes.push({ type, value });
for (const value of ['東', '南', '西', '北', '中', '發', '白']) deckTypes.push({ type: 'feng', value });

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function wallPositions() {
  const sides = [
    { x: 0, z: WALL_OFFSET, yaw: 0 },
    { x: -WALL_OFFSET, z: 0, yaw: -Math.PI / 2 },
    { x: 0, z: -WALL_OFFSET, yaw: Math.PI },
    { x: WALL_OFFSET, z: 0, yaw: Math.PI / 2 },
  ];
  const out = [];
  for (const side of sides) {
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < 17; i++) {
        const along = (i - 8) * WALL_GAP;
        const c = Math.cos(side.yaw), s = Math.sin(side.yaw);
        out.push({
          position: {
            x: side.x + along * c,
            y: TABLE_TOP + TILE_D / 2 + layer * TILE_D,
            z: side.z - along * s,
          },
          yaw: side.yaw,
          layer,
        });
      }
    }
  }
  return out;
}

function createInitialTable() {
  if (diceTimer) clearTimeout(diceTimer);
  diceTimer = null;
  dealerSeat = null;
  diceState = { rolling: false, values: [1, 1], targetValues: null, rollStartedAt: 0, rollEndsAt: 0, durationMs: 0, spin: [], rollId: diceState.rollId + 1 };
  const deck = [];
  for (const tile of deckTypes) for (let n = 0; n < 4; n++) deck.push({ ...tile });
  shuffle(deck);
  const positions = wallPositions();
  const next = new Map();
  for (let i = 0; i < deck.length; i++) {
    next.set(`tile-${String(i + 1).padStart(3, '0')}`, {
      id: `tile-${String(i + 1).padStart(3, '0')}`,
      ...deck[i],
      position: positions[i].position,
      yaw: positions[i].yaw,
      layer: positions[i].layer,
      depthBias: 0,
      faceUp: false,
      standing: false,
      area: 'wall',
      handSeat: null,
      hiddenForSeat: null,
      heldBy: null,
      revision: 0,
    });
  }
  tiles = next;
  hands = [[], [], [], []];
  scores = [0, 0, 0, 0];
  tableVersion++;
}

function seatPlayers() {
  return players.map((p, seat) => p ? { seat, name: p.name, avatar: p.avatar, connected: p.ws.readyState === WebSocket.OPEN } : null);
}

function serializeTile(tile, viewerSeat) {
  const { grabOrigin, hiddenForSeat, ...visible } = tile;
  const concealed = (Number.isInteger(tile.hiddenForSeat) && tile.hiddenForSeat !== viewerSeat) ||
    (tile.area === 'hand' && tile.standing && tile.handSeat !== viewerSeat);
  if (concealed) return { ...visible, type: 'unknown', value: '?', concealed: true };
  return { ...visible, concealed: false };
}

function tableSnapshot(viewerSeat) {
  return {
    type: 'TABLE_STATE',
    tableVersion,
    tiles: [...tiles.values()].map((tile) => serializeTile(tile, viewerSeat)),
    hands,
    scores,
    roundNumber,
    roundHistory,
    players: seatPlayers(),
    dealerSeat,
    diceState,
  };
}

function broadcastTableState() {
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && Number.isInteger(ws.seat)) send(ws, tableSnapshot(ws.seat));
  }
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(message, predicate = () => true) {
  const data = JSON.stringify(message);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN && predicate(ws)) ws.send(data);
}

function broadcastLobby() {
  broadcast({ type: 'LOBBY_STATE', seats: seatPlayers(), avatars: AVATARS });
}

function broadcastPlayers() {
  broadcast({ type: 'PLAYERS', players: seatPlayers() }, (ws) => Number.isInteger(ws.seat));
}

function cancelNextRound(seat = null, reason = 'cancelled') {
  if (!pendingNextRound) return;
  const proposal = pendingNextRound;
  pendingNextRound = null;
  const player = Number.isInteger(seat) ? players[seat] : null;
  broadcast({ type: 'NEXT_ROUND_CANCELLED', proposalId: proposal.id, seat, name: player?.name || proposal.names?.[seat] || '玩家', reason });
}

function nextRoundProgress() {
  if (!pendingNextRound) return;
  broadcast({ type: 'NEXT_ROUND_PROGRESS', proposalId: pendingNextRound.id, requesterSeat: pendingNextRound.requesterSeat, requesterName: pendingNextRound.requesterName, approvals: [...pendingNextRound.approvals], required: 4 });
}

function completeNextRound() {
  if (!pendingNextRound || pendingNextRound.approvals.size !== 4) return;
  const completedScores = [...scores];
  const previousTotals = roundHistory.length ? [...roundHistory[roundHistory.length - 1].totals] : [0, 0, 0, 0];
  const totals = previousTotals.map((total, seat) => total + completedScores[seat]);
  roundHistory.push({ round: roundNumber, scores: completedScores, totals });
  roundNumber++;
  pendingNextRound = null;
  createInitialTable();
  broadcast({ type: 'NEXT_ROUND_DONE', roundNumber, roundHistory, scores });
  broadcastTableState();
}

function broadcastTiles(updated) {
  if (!updated.length) return;
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN || !Number.isInteger(ws.seat)) continue;
    send(ws, { type: 'TILES_UPDATE', tiles: updated.map((tile) => serializeTile(tile, ws.seat)) });
  }
}

function sanitizeName(value) {
  return String(value ?? '玩家').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12) || '玩家';
}

function getHandSeat(x, z) {
  const cross = [x, z, -x, -z], along = [ -z, x, z, -x ];
  for (let seat = 0; seat < 4; seat++) {
    if (cross[seat] < HAND_DIST - .9 || cross[seat] > HAND_DIST + .9) continue;
    const positions = hands[seat].map((id) => {
      const tile = tiles.get(id);
      return tile ? handAlong(seat, tile.position.x, tile.position.z) : null;
    }).filter((value) => value !== null);
    const min = positions.length ? Math.min(...positions) : 0;
    const max = positions.length ? Math.max(...positions) : 0;
    const handEdgeExtension = TILE_W / 2 + TILE_W;
    if (along[seat] >= min - handEdgeExtension && along[seat] <= max + handEdgeExtension) return seat;
  }
  return -1;
}

function handAlong(seat, x, z) {
  if (seat === 0) return -z;
  if (seat === 1) return x;
  if (seat === 2) return z;
  return -x;
}

function handPosition(seat, index, count) {
  const along = (index - (count - 1) / 2) * HAND_GAP;
  if (seat === 0) return { x: HAND_DIST, y: TABLE_TOP + TILE_H / 2, z: -along };
  if (seat === 1) return { x: along, y: TABLE_TOP + TILE_H / 2, z: HAND_DIST };
  if (seat === 2) return { x: -HAND_DIST, y: TABLE_TOP + TILE_H / 2, z: along };
  return { x: -along, y: TABLE_TOP + TILE_H / 2, z: -HAND_DIST };
}

function layoutHand(seat, changed) {
  const list = hands[seat];
  for (let i = 0; i < list.length; i++) {
    const tile = tiles.get(list[i]);
    if (!tile) continue;
    tile.position = handPosition(seat, i, list.length);
    tile.yaw = SEAT_YAW[seat];
    tile.layer = 0;
    tile.depthBias = 0;
    tile.standing = true;
    tile.area = 'hand';
    tile.handSeat = seat;
    tile.hiddenForSeat = seat;
    tile.revision++;
    changed.push(tile);
  }
}

function removeFromHand(tile, changed) {
  if (tile.handSeat === null || tile.handSeat === undefined) return;
  const seat = tile.handSeat;
  const index = hands[seat].indexOf(tile.id);
  if (index >= 0) hands[seat].splice(index, 1);
  tile.hiddenForSeat = seat;
  tile.handSeat = null;
  layoutHand(seat, changed);
}

function validTablePoint(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= TABLE_LIMIT && Math.abs(z) <= TABLE_LIMIT;
}

function finiteTransform(message) {
  const p = message.position || {};
  return Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(message.yaw) &&
    Math.abs(p.x) <= TABLE_LIMIT + 0.5 && Math.abs(p.z) <= TABLE_LIMIT + 0.5 &&
    Math.abs(message.yaw) <= Math.PI * 100;
}

function tileFootprint(x, z, yaw, standing = false) {
  const halfW = TILE_HALF_W, halfL = standing ? TILE_HALF_D : TILE_HALF_L;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ux = { x: c, z: -s }, uz = { x: s, z: c };
  return [
    { x: x - ux.x * halfW - uz.x * halfL, z: z - ux.z * halfW - uz.z * halfL },
    { x: x + ux.x * halfW - uz.x * halfL, z: z + ux.z * halfW - uz.z * halfL },
    { x: x + ux.x * halfW + uz.x * halfL, z: z + ux.z * halfW + uz.z * halfL },
    { x: x - ux.x * halfW + uz.x * halfL, z: z - ux.z * halfW + uz.z * halfL },
  ];
}

function tileHalfHeight(tile) { return tile.standing ? TILE_HALF_L : TILE_HALF_D; }

function polygonArea(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) * 0.5;
}

function edgeSide(a, b, p) {
  return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
}

function lineIntersection(s, e, a, b) {
  const ds = edgeSide(a, b, s), de = edgeSide(a, b, e);
  const t = ds / (ds - de);
  return { x: s.x + (e.x - s.x) * t, z: s.z + (e.z - s.z) * t };
}

function intersectionArea(subject, clip) {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], input = output;
    output = [];
    if (!input.length) break;
    let previous = input[input.length - 1], previousInside = edgeSide(a, b, previous) >= -1e-9;
    for (const current of input) {
      const currentInside = edgeSide(a, b, current) >= -1e-9;
      if (currentInside) {
        if (!previousInside) output.push(lineIntersection(previous, current, a, b));
        output.push(current);
      } else if (previousInside) output.push(lineIntersection(previous, current, a, b));
      previous = current; previousInside = currentInside;
    }
  }
  return polygonArea(output);
}

function resolveTablePlacement(tileId, x, z, yaw) {
  const tile = tiles.get(tileId);
  if (!tile) return { layer: 0, depthBias: 0, y: TABLE_TOP + TILE_HALF_D };
  const footprint = tileFootprint(x, z, yaw, tile.standing);
  const footprintArea = polygonArea(footprint);
  const overlaps = [];
  let supportTop = TABLE_TOP, layer = 0, maxBias = -DEPTH_BIAS_STEP;
  for (const other of tiles.values()) {
    if (other.id === tileId || other.heldBy !== null) continue;
    const overlap = intersectionArea(footprint, tileFootprint(other.position.x, other.position.z, other.yaw, other.standing));
    if (overlap <= 1e-5) continue;
    const ratio = overlap / footprintArea;
    const stack = ratio > STACK_OVERLAP_THRESHOLD + 1e-9;
    overlaps.push({ tile: other, ratio, stack });
    if (stack) {
      supportTop = Math.max(supportTop, other.position.y + tileHalfHeight(other));
      layer = Math.max(layer, (other.layer || 0) + 1);
    }
  }
  const halfHeight = tileHalfHeight(tile);
  const y = supportTop + halfHeight;
  for (const { tile: other, stack } of overlaps) {
    if (!stack && Math.abs((other.position.y - tileHalfHeight(other)) - TABLE_TOP) < 0.02 && Math.abs(other.position.y - y) < 0.02) {
      maxBias = Math.max(maxBias, other.depthBias || 0);
    }
  }
  const depthBias = maxBias < 0 ? 0 : maxBias + DEPTH_BIAS_STEP;
  return { layer, depthBias, y: y + depthBias };
}

function restoreGrabOrigin(ws, tile) {
  const origin = tile.grabOrigin;
  if (!origin || tile.heldBy !== ws.seat) return false;
  const changed = [];
  tile.heldBy = null;
  tile.area = origin.area;
  tile.handSeat = origin.handSeat;
  tile.position = { ...origin.position };
  tile.yaw = origin.yaw;
  tile.faceUp = origin.faceUp;
  tile.standing = origin.standing;
  tile.layer = origin.layer || 0;
  tile.depthBias = origin.depthBias || 0;
  tile.hiddenForSeat = origin.hiddenForSeat ?? null;
  delete tile.grabOrigin;
  tile.revision++;
  if (origin.area === 'hand' && Number.isInteger(origin.handSeat)) {
    const list = hands[origin.handSeat];
    const index = Math.max(0, Math.min(list.length, origin.handIndex));
    list.splice(index, 0, tile.id);
    layoutHand(origin.handSeat, changed);
  } else changed.push(tile);
  broadcastTiles(changed);
  send(ws, { type: 'CANCEL_OK', tileId: tile.id });
  return true;
}

function releaseHeldForSeat(seat) {
  const changed = [];
  for (const tile of tiles.values()) {
    if (tile.heldBy !== seat) continue;
    tile.heldBy = null;
    tile.area = 'table';
    tile.handSeat = null;
    tile.hiddenForSeat = null;
    tile.standing = false;
    const placement = resolveTablePlacement(tile.id, tile.position.x, tile.position.z, tile.yaw);
    tile.layer = placement.layer; tile.depthBias = placement.depthBias;
    tile.position.y = placement.y;
    delete tile.grabOrigin;
    tile.revision++;
    changed.push(tile);
  }
  return changed;
}

function handleMessage(ws, message) {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'WATCH_LOBBY') {
    send(ws, { type: 'LOBBY_STATE', seats: seatPlayers(), avatars: AVATARS });
    return;
  }
  if (message.type === 'JOIN') {
    const seat = Number(message.seat);
    if (!Number.isInteger(seat) || seat < 0 || seat > 3) return send(ws, { type: 'ERROR', message: '无效座位' });
    const sessionId = String(message.sessionId || '').slice(0, 80);
    if (!sessionId) return send(ws, { type: 'ERROR', message: '缺少本次浏览器会话标识，请返回大厅重新进入' });
    const current = players[seat];
    if (current && current.ws !== ws && current.sessionId !== sessionId) {
      send(ws, { type: 'ERROR', message: `${SEATS[seat]}位已被占用` });
      return;
    }
    const isSameSession = current?.sessionId === sessionId;
    const avatar = isSameSession ? current.avatar : String(message.avatar || '');
    if (!AVATARS.includes(avatar)) {
      send(ws, { type: 'ERROR', message: '请返回大厅选择一个可用头像' });
      return;
    }
    const avatarOwner = players.findIndex((player, index) => index !== seat && player?.avatar === avatar);
    if (avatarOwner >= 0) {
      send(ws, { type: 'ERROR', message: '该头像已被其他玩家选择，请返回大厅重新选择' });
      return;
    }
    if (current && current.ws !== ws && current.sessionId === sessionId) current.ws.close(4001, 'replaced');
    ws.seat = seat;
    ws.sessionId = sessionId;
    players[seat] = { seat, name: sanitizeName(message.name), avatar, sessionId, ws };
    send(ws, { type: 'JOIN_OK', seat, snapshot: tableSnapshot(seat) });
    broadcastPlayers();
    broadcastLobby();
    return;
  }

  const seat = ws.seat;
  if (!Number.isInteger(seat) || !players[seat] || players[seat].ws !== ws) return;

  if (message.type === 'LEAVE') {
    const player = players[seat];
    if (pendingNextRound) cancelNextRound(seat, 'player_left');
    const changed = releaseHeldForSeat(seat);
    players[seat] = null;
    broadcastTiles(changed);
    broadcast({ type: 'PLAYER_OFFLINE', seat, name: player.name });
    broadcastPlayers();
    broadcastLobby();
    send(ws, { type: 'LEAVE_OK' });
    return;
  }

  if (message.type === 'NEXT_ROUND_REQUEST') {
    if (pendingNextRound) return send(ws, { type: 'NOTICE', message: '已有下一局申请正在等待确认' });
    if (players.some((player) => !player || player.ws.readyState !== WebSocket.OPEN)) return send(ws, { type: 'NOTICE', message: '需要四位玩家全部在线才能申请下一局' });
    pendingNextRound = { id: ++nextRoundProposalId, requesterSeat: seat, requesterName: players[seat].name, names: players.map((player) => player?.name || '玩家'), approvals: new Set([seat]) };
    nextRoundProgress();
    return;
  }

  if (message.type === 'NEXT_ROUND_CONFIRM') {
    if (!pendingNextRound || Number(message.proposalId) !== pendingNextRound.id) return;
    pendingNextRound.approvals.add(seat);
    if (pendingNextRound.approvals.size === 4) completeNextRound();
    else nextRoundProgress();
    return;
  }

  if (message.type === 'NEXT_ROUND_CANCEL') {
    if (!pendingNextRound || Number(message.proposalId) !== pendingNextRound.id) return;
    cancelNextRound(seat, 'rejected');
    return;
  }

  if (message.type === 'GRAB_TILE') {
    const tile = tiles.get(String(message.tileId));
    if (!tile || tile.heldBy !== null) return send(ws, { type: 'ACTION_REJECTED', action: 'GRAB_TILE', message: '这张牌正在被其他玩家操作或不存在' });
    const handIndex = Number.isInteger(tile.handSeat) ? hands[tile.handSeat].indexOf(tile.id) : -1;
    tile.grabOrigin = {
      position: { ...tile.position }, yaw: tile.yaw, faceUp: tile.faceUp, standing: tile.standing,
      area: tile.area, handSeat: tile.handSeat, handIndex, layer: tile.layer || 0,
      depthBias: tile.depthBias || 0, hiddenForSeat: tile.hiddenForSeat ?? null,
    };
    const changed = [];
    removeFromHand(tile, changed);
    if (tile.area === 'wall' && !tile.faceUp) tile.faceUp = true;
    tile.heldBy = seat;
    tile.area = 'held';
    tile.handSeat = null;
    tile.standing = true;
    tile.layer = 0; tile.depthBias = 0;
    tile.position = handPosition(seat, 0, 1);
    tile.yaw = SEAT_YAW[seat];
    tile.revision++;
    changed.push(tile);
    broadcastTiles(changed);
    send(ws, { type: 'GRAB_OK', tileId: tile.id });
    return;
  }

  if (message.type === 'CANCEL_GRAB') {
    const tile = tiles.get(String(message.tileId));
    if (tile && tile.heldBy === seat) restoreGrabOrigin(ws, tile);
    return;
  }

  if (message.type === 'MOVE_TILE') {
    const tile = tiles.get(String(message.tileId));
    if (!tile || tile.heldBy !== seat || !finiteTransform(message)) return;
    tile.position = { x: message.position.x, y: TABLE_TOP + TILE_H / 2, z: message.position.z };
    tile.yaw = message.yaw;
    tile.faceUp = !!message.faceUp;
    tile.standing = true;
    tile.revision++;
    broadcastTiles([tile]);
    return;
  }

  if (message.type === 'RELEASE_TILE') {
    const tile = tiles.get(String(message.tileId));
    if (!tile || tile.heldBy !== seat || !finiteTransform(message)) return;
    const x = message.position.x, z = message.position.z;
    if (!validTablePoint(x, z)) return send(ws, { type: 'ACTION_REJECTED', action: 'RELEASE_TILE', message: '只能放在麻将桌台面上' });
    const changed = [];
    const handSeat = getHandSeat(x, z);
    tile.heldBy = null;
    tile.yaw = message.yaw;
    tile.faceUp = !!message.faceUp;
    delete tile.grabOrigin;
    if (handSeat >= 0) {
      const along = handAlong(handSeat, x, z);
      const list = hands[handSeat];
      const index = Math.max(0, Math.min(list.length, Math.round(along / HAND_GAP + (list.length - 1) / 2)));
      tile.yaw = SEAT_YAW[handSeat];
      tile.hiddenForSeat = handSeat;
      tile.layer = 0; tile.depthBias = 0;
      list.splice(index, 0, tile.id);
      tile.area = 'hand';
      tile.handSeat = handSeat;
      tile.standing = true;
      changed.push(tile);
      layoutHand(handSeat, changed);
    } else {
      tile.area = 'table';
      tile.handSeat = null;
      tile.hiddenForSeat = null;
      tile.standing = false;
      const placement = resolveTablePlacement(tile.id, x, z, tile.yaw);
      tile.layer = placement.layer; tile.depthBias = placement.depthBias;
      tile.position = { x, y: placement.y, z };
      tile.revision++;
      changed.push(tile);
    }
    broadcastTiles(changed);
    return;
  }

  if (message.type === 'SCORE_CHANGE') {
    const mode = String(message.mode || ''), value = Number(message.value);
    if (!['delta', 'set'].includes(mode) || !Number.isSafeInteger(value) || Math.abs(value) > 100000) return send(ws, { type: 'NOTICE', message: '请输入 -100000 至 100000 的整数' });
    const previous = scores[seat];
    const next = mode === 'delta' ? previous + value : value;
    if (!Number.isSafeInteger(next)) return send(ws, { type: 'NOTICE', message: '分数超出有效范围' });
    const delta = next - previous;
    scores[seat] = next;
    broadcast({ type: 'SCORES_UPDATE', scores, roundNumber, roundHistory, changedSeat: seat, delta, mode });
    return;
  }

  if (message.type === 'SCORE_DELTA') {
    const targetSeat = Number(message.seat), delta = Number(message.delta);
    if (targetSeat !== seat || !Number.isSafeInteger(delta) || Math.abs(delta) > 100000) return;
    const next = scores[seat] + delta;
    if (!Number.isSafeInteger(next)) return;
    scores[seat] = next;
    broadcast({ type: 'SCORES_UPDATE', scores, roundNumber, roundHistory, changedSeat: seat, delta, mode: 'delta' });
    return;
  }

  if (message.type === 'TOGGLE_DEALER') {
    const targetSeat = Number(message.seat);
    if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat > 3) return;
    dealerSeat = dealerSeat === targetSeat ? null : targetSeat;
    broadcast({ type: 'DEALER_UPDATE', dealerSeat });
    return;
  }

  if (message.type === 'ROLL_DICE') {
    if (diceState.rolling) return;
    const durationMs = 2200 + crypto.randomInt(0, 1201);
    const values = [crypto.randomInt(1, 7), crypto.randomInt(1, 7)];
    const spin = Array.from({ length: 2 }, () => ({ x: 8 + crypto.randomInt(0, 10), y: 7 + crypto.randomInt(0, 10), z: 9 + crypto.randomInt(0, 10), phase: crypto.randomInt(0, 628) / 100 }));
    const rollId = diceState.rollId + 1, rollStartedAt = Date.now();
    diceState = { rolling: true, values: diceState.values, targetValues: values, rollStartedAt, rollEndsAt: rollStartedAt + durationMs, durationMs, spin, rollId };
    broadcast({ type: 'DICE_ROLL_START', rollId, durationMs, rollStartedAt, spin, values });
    diceTimer = setTimeout(() => {
      diceState = { rolling: false, values, targetValues: null, rollStartedAt: 0, rollEndsAt: 0, durationMs: 0, spin: [], rollId };
      diceTimer = null;
      broadcast({ type: 'DICE_ROLL_END', rollId, values });
    }, durationMs);
    return;
  }

  if (message.type === 'PLAYER_ACTION') {
    const action = String(message.action || '');
    if (!['chi', 'penggang', 'hu'].includes(action)) return;
    broadcast({ type: 'PLAYER_ACTION', seat, action });
    return;
  }

  if (message.type === 'SOCIAL_INTERACTION') {
    const targetSeat = Number(message.targetSeat), item = String(message.item || '');
    if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat > 3 || targetSeat === seat || !['flower', 'heart', 'rock', 'egg'].includes(item)) return;
    const target = players[targetSeat];
    if (!target || target.ws.readyState !== WebSocket.OPEN) return send(ws, { type: 'NOTICE', message: '目标玩家当前不在线' });
    const now = Date.now();
    ws.socialMessageTimes = (ws.socialMessageTimes || []).filter((time) => now - time < 1000);
    if (ws.socialMessageTimes.length >= 15) return send(ws, { type: 'NOTICE', message: '互动太频繁，请稍后再试' });
    ws.socialMessageTimes.push(now);
    broadcast({ type: 'SOCIAL_INTERACTION', id: ++socialInteractionId, fromSeat: seat, targetSeat, item, createdAt: now }, (client) => Number.isInteger(client.seat));
    return;
  }

  if (message.type === 'EMOJI_REACTION') {
    const emoji = String(message.emoji || '');
    if (!EMOJI_REACTIONS.has(emoji)) return;
    const now = Date.now();
    ws.emojiReactionTimes = (ws.emojiReactionTimes || []).filter((time) => now - time < 1000);
    if (ws.emojiReactionTimes.length >= 12) return send(ws, { type: 'NOTICE', message: '表情发送太频繁，请稍后再试' });
    ws.emojiReactionTimes.push(now);
    broadcast({ type: 'EMOJI_REACTION', id: ++emojiReactionId, seat, emoji, createdAt: now }, (client) => Number.isInteger(client.seat));
    return;
  }

}

createInitialTable();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, players: seatPlayers(), tiles: tiles.size, version: tableVersion }));
    return;
  }
  const isModule = pathname.startsWith('/node_modules/');
  const root = isModule ? MODULES_DIR : PUBLIC_DIR;
  const relative = isModule ? pathname.slice('/node_modules/'.length) : pathname.replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(root, relative);
  const rel = path.relative(root, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': ['.html', '.js', '.mjs'].includes(ext) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
      //'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname !== '/ws') { socket.destroy(); return; }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) { socket.destroy(); return; }
    } catch { socket.destroy(); return; }
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('error', () => {});
  ws.messageTimes = [];
  send(ws, { type: 'LOBBY_STATE', seats: seatPlayers(), avatars: AVATARS });
  ws.on('message', (raw) => {
    const now = Date.now();
    ws.messageTimes = ws.messageTimes.filter((t) => now - t < 1000);
    if (ws.messageTimes.length >= 90) return;
    ws.messageTimes.push(now);
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(ws, message);
  });
  ws.on('close', () => {
    clients.delete(ws);
    if (Number.isInteger(ws.seat) && players[ws.seat]?.ws === ws) {
      const seat = ws.seat;
      const player = players[seat];
      if (pendingNextRound) cancelNextRound(seat, 'player_disconnected');
      const changed = releaseHeldForSeat(seat);
      players[seat] = null;
      broadcastTiles(changed);
      broadcast({ type: 'PLAYER_OFFLINE', seat, name: player.name });
      broadcastPlayers();
      broadcastLobby();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('麻神 · 3D Free Mahjong 已启动');
  console.log(`本机: http://localhost:${PORT}`);
  console.log(`局域网: http://<你的局域网IP>:${PORT}`);
  console.log('WebSocket: /ws');
});
