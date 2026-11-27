const seatNames = ['东', '南', '西', '北'];
const seatBox = document.querySelector('#seats');
const avatarBox = document.querySelector('#avatars');
const nameInput = document.querySelector('#name');
const enterButton = document.querySelector('#enter');
const status = document.querySelector('#status');
let selectedSeat = -1;
let selectedAvatar = '';
let seats = [null, null, null, null];
let avatarChoices = ['🐼', '🐻', '🐱', '🐸', '🦊', '🐯', '🐨', '🐵', '🐰', '🦁', '🐙', '🦉', '🐧', '🐹', '🦝', '🐮'];
let connected = false;

let sessionId = sessionStorage.getItem('mahjongSessionId');
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem('mahjongSessionId', sessionId);
}

const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);
ws.addEventListener('open', () => {
  connected = true;
  status.textContent = '已连接 · 选择空闲座位和头像';
  ws.send(JSON.stringify({ type: 'WATCH_LOBBY' }));
  updateEnter();
});
ws.addEventListener('close', () => {
  connected = false;
  status.textContent = '服务器连接已断开，请刷新页面';
  updateEnter();
});
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'LOBBY_STATE') {
    seats = message.seats || [null, null, null, null];
    avatarChoices = message.avatars || avatarChoices;
    if (selectedSeat >= 0 && seats[selectedSeat]) selectedSeat = -1;
    if (selectedAvatar && seats.some((player) => player?.avatar === selectedAvatar)) selectedAvatar = '';
    renderSeats();
    renderAvatars();
    updateEnter();
  }
});

function renderSeats() {
  seatBox.replaceChildren();
  for (let seat = 0; seat < 4; seat++) {
    const player = seats[seat];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `seat${player ? ' taken' : ''}${selectedSeat === seat ? ' selected' : ''}`;
    button.disabled = !!player;
    const dir = document.createElement('div');
    dir.className = 'dir'; dir.textContent = seatNames[seat];
    const who = document.createElement('div');
    who.className = 'who'; who.textContent = player ? `${player.name}${player.connected ? ' · 在线' : ''}` : '空位';
    button.append(dir, who);
    button.addEventListener('click', () => {
      if (player) return;
      selectedSeat = selectedSeat === seat ? -1 : seat;
      renderSeats(); updateEnter();
    });
    seatBox.append(button);
  }
}

function renderAvatars() {
  avatarBox.replaceChildren();
  const taken = new Set(seats.filter(Boolean).map((player) => player.avatar));
  for (const avatar of avatarChoices) {
    const button = document.createElement('button');
    const isTaken = taken.has(avatar);
    button.type = 'button'; button.className = `avatar-option${selectedAvatar === avatar ? ' selected' : ''}${isTaken ? ' taken' : ''}`;
    button.textContent = avatar; button.disabled = isTaken; button.title = isTaken ? '已被其他玩家选择' : '选择此头像';
    button.addEventListener('click', () => { if (isTaken) return; selectedAvatar = selectedAvatar === avatar ? '' : avatar; renderAvatars(); updateEnter(); });
    avatarBox.append(button);
  }
}

function updateEnter() {
  const avatarTaken = seats.some((player) => player?.avatar === selectedAvatar);
  const valid = connected && nameInput.value.trim().length > 0 && selectedSeat >= 0 && !seats[selectedSeat] && !!selectedAvatar && !avatarTaken;
  enterButton.disabled = !valid;
}

nameInput.addEventListener('input', updateEnter);
enterButton.addEventListener('click', () => {
  const name = nameInput.value.trim().slice(0, 12);
  if (!name || selectedSeat < 0 || !connected) return;
  const query = new URLSearchParams({ seat: String(selectedSeat), name, avatar: selectedAvatar, session: sessionId });
  location.href = `/game.html?${query}`;
});

renderSeats();
renderAvatars();
