import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createTileFactory, tileQuaternion } from './tile-factory.js?v=0.0.2';

const SEAT_NAMES = ['东', '南', '西', '北'];
const SEAT_YAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
const DEFAULT_CAMERA_POSITIONS = [[23, 17, 0], [0, 17, 23], [-23, 17, 0], [0, 17, -23]];
const DEFAULT_TABLE_COLOR = '#176B45';
const TABLE_TOP = .45, TABLE_LIMIT = 10.55, TILE_H = 1.1, TILE_D = .5;
const HAND_DIST = 9.2, HAND_GAP = .84;
const DICE_FACE_VALUES = [6, 1, 2, 5, 3, 4];
const DICE_FACE_NORMALS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const DICE_UP = new THREE.Vector3(0, 1, 0);
const params = new URLSearchParams(location.search);
const mySeat = Number(params.get('seat'));
const myName = params.get('name') || '玩家';
const myAvatar = params.get('avatar') || '';
const sessionId = params.get('session') || '';
if (!Number.isInteger(mySeat) || mySeat < 0 || mySeat > 3 || !sessionId || !myAvatar) {
  location.replace('/');
  throw new Error('无效的座位或会话信息');
}

const app = document.querySelector('#app');
const loader = document.querySelector('#loader');
const statusEl = document.querySelector('#status');
const toastEl = document.querySelector('#toast');
const centerNoticeEl = document.querySelector('#centerNotice');
const roundStatusEl = document.querySelector('#roundStatus');
const dialogOverlay = document.querySelector('#dialogOverlay');
const dialogTitle = document.querySelector('#dialogTitle');
const dialogMessage = document.querySelector('#dialogMessage');
const dialogConfirm = document.querySelector('#dialogConfirm');
const dialogCancel = document.querySelector('#dialogCancel');
const ledgerToggle = document.querySelector('#ledgerToggle');
const ledgerPanel = document.querySelector('#ledgerPanel');
const ledgerScroll = document.querySelector('#ledgerScroll');
const scoreboardRoot = document.querySelector('#scoreboards');
const socialEffectsRoot = document.querySelector('#socialEffects');
const shuffleButton = document.querySelector('#shuffleBtn');
const fullscreenButton = document.querySelector('#fullscreenBtn');
const mainViewButton = document.querySelector('#mainViewBtn');
const leaveButton = document.querySelector('#leaveBtn');
const scoreEditOverlay = document.querySelector('#scoreEditOverlay');
const scoreEditInput = document.querySelector('#scoreEditInput');
const scoreEditLabel = document.querySelector('#scoreEditLabel');
const scoreEditCurrent = document.querySelector('#scoreEditCurrent');
const scoreEditPreview = document.querySelector('#scoreEditPreview');
const scoreEditConfirm = document.querySelector('#scoreEditConfirm');
const scoreEditCancel = document.querySelector('#scoreEditCancel');
let scoreEditMode = 'delta';
const actionButtons = document.querySelectorAll('.action-btn');

let scene, camera, renderer, controls, tileFactory;
let tableGroup, tileGroup, cursorDot, cursorMaterial, feltMaterial, feltTexture;
let backgroundMaterials = [];
let interactiveMeshes = [], dealerMarkerBases = [], mainArrowGroup = null;
let diceMeshes = [], diceFaceMaterials = [], diceRolling = false, diceRollStart = 0, diceRollDuration = 0, diceRollId = 0, diceValues = [1, 1], diceVelocities = [], diceTargetQuaternions = [], diceSettleStartQuaternions = [], diceSettleStartY = [], diceSettleStarted = false, diceVisualSettled = true;
let dealerSeat = null;
const actionEffects = [null, null, null, null], actionTimers = [null, null, null, null];
const scoreEffects = [null, null, null, null], scoreTimers = [null, null, null, null];
let ws, connected = false, heldId = null, pendingGrabId = null;
let hoveredTileId = null, lastMoveSent = 0;
let tiles = new Map(), tileMeshes = new Map(), players = [null, null, null, null], scores = [0, 0, 0, 0];
let roundNumber = 1, roundHistory = [], ledgerVisible = false, activeNextRoundProposal = null;
let openSocialSeat = null, openEmojiMenu = false;
let toastTimer = null, centerNoticeTimer = null, dialogConfirmHandler = null, dialogCancelHandler = null;
let pointerNdc = new THREE.Vector2(2, 2), pointerInside = false;
const raycaster = new THREE.Raycaster();
const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_TOP);
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 3.95);
const tempPoint = new THREE.Vector3();
const SOCIAL_ITEMS = [
  { id: 'flower', icon: '🌹', label: '献花', impact: '✨', color: '#f2a7c7' },
  { id: 'heart', icon: '❤️', label: '爱心', impact: '💕', color: '#ff6b88' },
  { id: 'rock', icon: '🪨', label: '石头', impact: '💥', color: '#c4b6a2' },
  { id: 'egg', icon: '🥚', label: '鸡蛋', impact: '💦', color: '#f0d27b' },
];
const EMOJI_REACTIONS = ['😄', '😂', '😭', '😍', '👍', '❤️', '🤔', '🎉'];

function makeCanvasTexture(draw, width = 512, height = 512) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeWoodTexture() {
  return makeCanvasTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#4d2f18'); g.addColorStop(.48, '#8a5a30'); g.addColorStop(1, '#513018');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w;
      ctx.strokeStyle = Math.random() < .7 ? 'rgba(30,15,5,.13)' : 'rgba(220,165,100,.09)';
      ctx.lineWidth = .5 + Math.random() * 2;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 8) {
        const xx = x + Math.sin(y * .018 + i) * 5 + Math.sin(y * .004 + i * .7) * 14;
        if (!y) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
  });
}

function makeFeltTexture(baseColor = DEFAULT_TABLE_COLOR) {
  return makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = baseColor; ctx.fillRect(0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h), data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - .5) * 12;
      data[i] = Math.max(0, Math.min(255, data[i] + n * .5));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n * .5));
    }
    ctx.putImageData(image, 0, 0);
  }, 256, 256);
}

function makeFloorTexture() {
  return makeCanvasTexture((ctx, w, h) => {
    const plank = 128;
    for (let y = 0; y < h; y += plank) {
      const shade = .86 + Math.random() * .25;
      ctx.fillStyle = `rgb(${Math.round(116 * shade)},${Math.round(78 * shade)},${Math.round(43 * shade)})`;
      ctx.fillRect(0, y, w, plank);
      for (let i = 0; i < 22; i++) {
        const yy = y + Math.random() * plank;
        ctx.strokeStyle = 'rgba(30,16,7,.12)'; ctx.lineWidth = .8 + Math.random() * 1.5;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 24) ctx.lineTo(x, yy + Math.sin(x * .012 + i) * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,10,4,.38)'; ctx.fillRect(0, y + plank - 3, w, 3);
    }
  }, 1024, 1024);
}

function makeLabelTexture(text, fontSize = 120) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = '#f5e7c8'; ctx.font = `900 ${fontSize}px "Microsoft YaHei",serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = '#0008'; ctx.shadowBlur = 8;
  ctx.fillText(text, 128, 132);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

function makeDieFaceMaterial(value) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f0df'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#c9b995'; ctx.lineWidth = 5; ctx.strokeRect(3, 3, 122, 122);
  const spots = {
    1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  }[value];
  ctx.fillStyle = '#29251e';
  for (const [x, y] of spots) { ctx.beginPath(); ctx.arc(28 + x * 36, 28 + y * 36, 10, 0, Math.PI * 2); ctx.fill(); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: .48 });
}

function buildCenterControls(parent) {
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(.92, .98, .16, 64), new THREE.MeshStandardMaterial({ color: '#493522', metalness: .35, roughness: .48 }));
  tray.position.y = TABLE_TOP + .08; tray.castShadow = true; tray.receiveShadow = true; parent.add(tray);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(.78, .82, .045, 64), new THREE.MeshStandardMaterial({ color: '#18271d', roughness: .88 }));
  well.position.y = TABLE_TOP + .175; well.receiveShadow = true; parent.add(well);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.84, .045, 12, 64), new THREE.MeshStandardMaterial({ color: '#d4ad68', metalness: .72, roughness: .28 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = TABLE_TOP + .205; parent.add(ring);
  const diceHitArea = new THREE.Mesh(new THREE.CircleGeometry(.90, 64), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  diceHitArea.rotation.x = -Math.PI / 2; diceHitArea.position.y = TABLE_TOP + .26; diceHitArea.userData.interaction = { kind: 'dice' }; interactiveMeshes.push(diceHitArea); parent.add(diceHitArea);

  const markerPositions = [
    { x: 1.52, z: 0 }, { x: 0, z: 1.52 }, { x: -1.52, z: 0 }, { x: 0, z: -1.52 },
  ];
  const markerMaterial = new THREE.MeshStandardMaterial({ color: '#705438', metalness: .45, roughness: .38, emissive: '#1b1006' });
  for (let seat = 0; seat < 4; seat++) {
    const group = new THREE.Group(); group.position.set(markerPositions[seat].x, TABLE_TOP - .005, markerPositions[seat].z); group.rotation.y = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][seat];
    const base = new THREE.Mesh(new RoundedBoxGeometry(.88, .14, .68, 4, .08), markerMaterial.clone());
    base.position.y = .075; base.castShadow = true; base.receiveShadow = true;
    base.userData.interaction = { kind: 'dealer', seat };
    group.add(base); dealerMarkerBases[seat] = base; interactiveMeshes.push(base);
    const labelTexture = makeLabelTexture(SEAT_NAMES[seat], 116);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(.48, .48), new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    label.rotation.x = -Math.PI / 2; label.position.y = .151; group.add(label);
    parent.add(group);
  }


  diceFaceMaterials = Array.from({ length: 6 }, (_, i) => makeDieFaceMaterial(i + 1));
  const diceGeo = new THREE.BoxGeometry(.42, .42, .42);
  const faceValues = DICE_FACE_VALUES;
  for (let i = 0; i < 2; i++) {
    const materials = faceValues.map((value) => diceFaceMaterials[value - 1]);
    const die = new THREE.Mesh(diceGeo, materials);
    die.position.set(i === 0 ? -.24 : .24, TABLE_TOP + .175 + .21, 0);
    die.castShadow = true; die.receiveShadow = true; die.userData.baseY = die.position.y; die.userData.phase = i * 1.7;
    parent.add(die); diceMeshes.push(die);
  }
  setDiceValues([1, 1]);

  const seat = mySeat, pos = markerPositions[seat];
  mainArrowGroup = new THREE.Group(); mainArrowGroup.position.set(pos.x, TABLE_TOP, pos.z); mainArrowGroup.visible = true;
  const arrowMat = new THREE.MeshStandardMaterial({ color: '#ffe17b', emissive: '#c28b18', emissiveIntensity: 1.4, metalness: .25, roughness: .25 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .36, 12), arrowMat);
  shaft.position.y = .66; shaft.castShadow = true; mainArrowGroup.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(.15, .25, 16), arrowMat);
  head.rotation.z = Math.PI; head.position.y = .355; head.castShadow = true; mainArrowGroup.add(head);
  parent.add(mainArrowGroup);
  updateDealerVisual(null);
}

function updateDealerVisual(nextSeat) {
  dealerSeat = Number.isInteger(nextSeat) && nextSeat >= 0 && nextSeat < 4 ? nextSeat : null;
  for (let seat = 0; seat < dealerMarkerBases.length; seat++) {
    const material = dealerMarkerBases[seat].material;
    const selected = dealerSeat === seat;
    material.color.set(selected ? '#d9a83e' : '#705438');
    material.emissive.set(selected ? '#7c4d08' : '#1b1006');
    material.emissiveIntensity = selected ? 1.15 : .35;
  }
}

function normalizeDiceValues(values) {
  return Array.isArray(values) && values.length === 2 ? values.map((v) => Math.max(1, Math.min(6, Math.trunc(Number(v)) || 1))) : [1, 1];
}

function makeDiceTargetQuaternion(value) {
  const faceIndex = DICE_FACE_VALUES.indexOf(value);
  const quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(DICE_FACE_NORMALS[faceIndex], DICE_UP);
  return quaternion;
}

function setDiceValues(values) {
  diceValues = normalizeDiceValues(values);
  diceTargetQuaternions = diceValues.map(makeDiceTargetQuaternion);
  for (let i = 0; i < diceMeshes.length; i++) {
    const die = diceMeshes[i];
    die.quaternion.copy(diceTargetQuaternions[i]);
    die.position.y = die.userData.baseY;
  }
  diceSettleStarted = false; diceVisualSettled = true;
}

function startDiceRoll(durationMs, rollId, spin = [], elapsedMs = 0, targetValues = [1, 1]) {
  if (rollId < diceRollId || (rollId === diceRollId && diceRolling)) return;
  diceRollId = rollId; diceRolling = true; diceVisualSettled = false; diceSettleStarted = false;
  diceRollStart = performance.now() - Math.max(0, elapsedMs); diceRollDuration = Math.max(100, durationMs);
  diceValues = normalizeDiceValues(targetValues);
  diceTargetQuaternions = diceValues.map(makeDiceTargetQuaternion);
  diceVelocities = diceMeshes.map((die, i) => { const v = spin[i] || { x: 12 + i, y: 11 + i, z: 13 + i, phase: i * 1.7 }; die.userData.phase = Number(v.phase) || 0; return { x: Number(v.x) || 12 + i, y: Number(v.y) || 11 + i, z: Number(v.z) || 13 + i }; });
}

function finishDiceRoll(rollId, values) {
  if (rollId < diceRollId) return;
  if (rollId > diceRollId) { diceRollId = rollId; diceRolling = false; setDiceValues(values); return; }
  const finalValues = normalizeDiceValues(values);
  if (diceRolling && !diceVisualSettled) {
    diceValues = finalValues;
    diceTargetQuaternions = diceValues.map(makeDiceTargetQuaternion);
    return;
  }
  diceRolling = false; setDiceValues(finalValues);
}

function updateDiceAnimation(delta, now) {
  if (!diceRolling || diceVisualSettled) return;
  const elapsed = now - diceRollStart, t = Math.min(1, Math.max(0, elapsed / diceRollDuration));
  for (let i = 0; i < diceMeshes.length; i++) {
    const die = diceMeshes[i], velocity = diceVelocities[i];
    if (t < .82) {
      const decay = 1 - t * .72;
      die.rotation.x += velocity.x * delta * decay;
      die.rotation.y += velocity.y * delta * decay;
      die.rotation.z += velocity.z * delta * decay;
      die.position.y = die.userData.baseY + Math.abs(Math.sin(elapsed * .018 + die.userData.phase)) * .2 * (1 - t * .7);
    } else {
      if (!diceSettleStarted) {
        diceSettleStartQuaternions = diceMeshes.map((mesh) => mesh.quaternion.clone());
        diceSettleStartY = diceMeshes.map((mesh) => mesh.position.y);
        diceSettleStarted = true;
      }
      const settle = Math.min(1, Math.max(0, (t - .82) / .18));
      const eased = settle * settle * (3 - 2 * settle);
      die.quaternion.slerpQuaternions(diceSettleStartQuaternions[i], diceTargetQuaternions[i], eased);
      die.position.y = diceSettleStartY[i] + (die.userData.baseY - diceSettleStartY[i]) * eased;
    }
  }
  if (t >= 1) {
    for (let i = 0; i < diceMeshes.length; i++) {
      diceMeshes[i].quaternion.copy(diceTargetQuaternions[i]);
      diceMeshes[i].position.y = diceMeshes[i].userData.baseY;
    }
    diceVisualSettled = true; diceRolling = false;
  }
}

function buildTable() {
  tableGroup = new THREE.Group();
  const woodTexture = makeWoodTexture(); woodTexture.repeat.set(2, 2);
  feltTexture = makeFeltTexture(DEFAULT_TABLE_COLOR); feltTexture.repeat.set(6, 6);
  const wood = new THREE.MeshPhysicalMaterial({ map: woodTexture, color: '#8a572d', roughness: .36, metalness: .08, clearcoat: .65, clearcoatRoughness: .3 });
  feltMaterial = new THREE.MeshStandardMaterial({ map: feltTexture, color: '#ffffff', roughness: .96 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d2ad60', metalness: .78, roughness: .3, emissive: '#3b2909' });

  const base = new THREE.Mesh(new RoundedBoxGeometry(23, .8, 23, 5, .16), wood);
  base.position.y = 0; base.castShadow = true; base.receiveShadow = true; tableGroup.add(base);
  const top = new THREE.Mesh(new RoundedBoxGeometry(22, .1, 22, 5, .12), feltMaterial);
  top.position.y = .4; top.receiveShadow = true; tableGroup.add(top);
  const edgeY = TABLE_TOP + .025;
  for (const sign of [-1, 1]) {
    const barX = new THREE.Mesh(new THREE.BoxGeometry(21.6, .035, .045), gold);
    barX.position.set(0, edgeY, sign * 10.72); tableGroup.add(barX);
    const barZ = new THREE.Mesh(new THREE.BoxGeometry(.045, .035, 21.6), gold);
    barZ.position.set(sign * 10.72, edgeY, 0); tableGroup.add(barZ);
  }
  for (const x of [-9.4, 9.4]) for (const z of [-9.4, 9.4]) {
    const leg = new THREE.Mesh(new RoundedBoxGeometry(.9, 3.7, .9, 4, .12), wood);
    leg.position.set(x, -2.15, z); leg.castShadow = true; leg.receiveShadow = true; tableGroup.add(leg);
    const foot = new THREE.Mesh(new RoundedBoxGeometry(1.05, .18, 1.05, 4, .08), gold);
    foot.position.set(x, -3.95, z); tableGroup.add(foot);
  }
  buildCenterControls(tableGroup);
  const handZoneLine = new THREE.LineBasicMaterial({ color: '#e2c17c', transparent: true, opacity: .32, depthWrite: false });
  for (const zone of [
    { x: HAND_DIST, z: 0, w: 1.8, h: 14.8 },
    { x: 0, z: HAND_DIST, w: 14.8, h: 1.8 },
    { x: -HAND_DIST, z: 0, w: 1.8, h: 14.8 },
    { x: 0, z: -HAND_DIST, w: 14.8, h: 1.8 },
  ]) {
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(zone.w, zone.h)), handZoneLine);
    outline.rotation.x = -Math.PI / 2;
    outline.position.set(zone.x, TABLE_TOP + .012, zone.z);
    tableGroup.add(outline);
  }
  scene.add(tableGroup);
}

function buildEnvironment() {
  const floorTexture = makeFloorTexture(); floorTexture.repeat.set(9, 9);
  const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: .82 });
  backgroundMaterials = [{ material: floorMaterial, baseColor: floorMaterial.color.clone() }];
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMaterial);
  floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.y = -4.05; floorMesh.receiveShadow = true; scene.add(floorMesh);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#554535', roughness: .94, side: THREE.DoubleSide });
  backgroundMaterials.push({ material: wallMaterial, baseColor: wallMaterial.color.clone() });
  const wallGeo = new THREE.PlaneGeometry(120, 24);
  const walls = [
    [0, 8, -58, 0], [0, 8, 58, Math.PI], [-58, 8, 0, Math.PI / 2], [58, 8, 0, -Math.PI / 2],
  ];
  for (const [x, y, z, ry] of walls) {
    const wall = new THREE.Mesh(wallGeo, wallMaterial); wall.position.set(x, y, z); wall.rotation.y = ry; scene.add(wall);
  }
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#30271e');
  scene.fog = new THREE.Fog('#30271e', 38, 100);
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 180);
  camera.position.set(...DEFAULT_CAMERA_POSITIONS[mySeat]); camera.lookAt(0, .4, 0);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .45, 0); controls.enableDamping = true; controls.dampingFactor = .055;
  controls.minDistance = 13; controls.maxDistance = 39; controls.maxPolarAngle = Math.PI * .48;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
  controls.screenSpacePanning = false;
  controls.update(); controls.saveState();

  scene.add(new THREE.AmbientLight('#fff0d6', .7));
  scene.add(new THREE.HemisphereLight('#fff4dd', '#594632', .8));
  const key = new THREE.DirectionalLight('#ffe5bc', 2.1); key.position.set(7, 18, 9); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -16; key.shadow.camera.right = 16;
  key.shadow.camera.top = 16; key.shadow.camera.bottom = -16; key.shadow.bias = -.0005; key.shadow.radius = 4; scene.add(key);
  const fill = new THREE.PointLight('#ffb779', .65, 38); fill.position.set(-8, 7, -6); scene.add(fill);
  const rim = new THREE.PointLight('#8fd2b6', .45, 36); rim.position.set(8, 6, 8); scene.add(rim);

  buildEnvironment(); buildTable();
  tileGroup = new THREE.Group(); scene.add(tileGroup);
  cursorMaterial = new THREE.MeshBasicMaterial({ color: '#e84d4d', depthTest: false, transparent: true, opacity: .95 });
  cursorDot = new THREE.Mesh(new THREE.SphereGeometry(.12, 16, 12), cursorMaterial);
  cursorDot.renderOrder = 1000; cursorDot.visible = false; scene.add(cursorDot);
}

function showToast(message, duration = 1500) {
  toastEl.textContent = message; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

function showCenterNotice(message, duration = 3200) {
  centerNoticeEl.textContent = message;
  centerNoticeEl.classList.add('show');
  clearTimeout(centerNoticeTimer);
  centerNoticeTimer = setTimeout(() => centerNoticeEl.classList.remove('show'), duration);
}

function closeDialog() {
  dialogOverlay.hidden = true;
  dialogConfirmHandler = null;
  dialogCancelHandler = null;
}

function openDialog({ title, message, confirmText = '确认', cancelText = '取消', showConfirm = true, showCancel = true, onConfirm = null, onCancel = null }) {
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  dialogConfirm.textContent = confirmText;
  dialogCancel.textContent = cancelText;
  dialogConfirm.hidden = !showConfirm;
  dialogCancel.hidden = !showCancel;
  dialogConfirm.disabled = false;
  dialogCancel.disabled = false;
  dialogConfirmHandler = onConfirm;
  dialogCancelHandler = onCancel;
  dialogConfirm.onclick = () => dialogConfirmHandler?.();
  dialogCancel.onclick = () => dialogCancelHandler?.();
  dialogOverlay.hidden = false;
}

function showNextRoundDialog(proposal) {
  activeNextRoundProposal = proposal;
  const approved = proposal.approvals.includes(mySeat);
  const approvalText = `已确认 ${proposal.approvals.length}/4 位玩家`;
  if (mySeat === proposal.requesterSeat) {
    openDialog({
      title: '下一局申请已发出',
      message: `你已发起下一局申请。${approvalText}，等待其他玩家确认。`,
      showConfirm: false,
      cancelText: '撤回申请',
      onCancel: () => send({ type: 'NEXT_ROUND_CANCEL', proposalId: proposal.proposalId }),
    });
  } else if (approved) {
    openDialog({
      title: '已同意开始下一局',
      message: `${proposal.requesterName}（${SEAT_NAMES[proposal.requesterSeat]}位）申请开始第 ${roundNumber + 1} 局。${approvalText}。`,
      showConfirm: false,
      cancelText: '拒绝申请',
      onCancel: () => send({ type: 'NEXT_ROUND_CANCEL', proposalId: proposal.proposalId }),
    });
  } else {
    openDialog({
      title: '下一局申请',
      message: `${proposal.requesterName}（${SEAT_NAMES[proposal.requesterSeat]}位）申请开始第 ${roundNumber + 1} 局。
${approvalText}。是否同意？`,
      confirmText: '同意下一局',
      cancelText: '拒绝',
      onConfirm: () => { dialogConfirm.disabled = true; send({ type: 'NEXT_ROUND_CONFIRM', proposalId: proposal.proposalId }); },
      onCancel: () => send({ type: 'NEXT_ROUND_CANCEL', proposalId: proposal.proposalId }),
    });
  }
}

function updateRoundDisplay() {
  roundStatusEl.textContent = `对局数：${roundNumber}`;
}

function formatScore(value) { return `${value > 0 ? '+' : ''}${value}`; }

function renderLedger() {
  if (!ledgerScroll) return;
  const previousScroll = ledgerScroll.scrollTop;
  const table = document.createElement('table'); table.className = 'ledger-table';
  const thead = document.createElement('thead'), header = document.createElement('tr');
  const roundHead = document.createElement('th'); roundHead.textContent = '局数'; header.append(roundHead);
  for (let seat = 0; seat < 4; seat++) {
    const th = document.createElement('th');
    th.textContent = `${SEAT_NAMES[seat]}位${seat === mySeat ? ' · 你' : ''}`;
    if (seat === mySeat) th.classList.add('my-seat');
    header.append(th);
  }
  thead.append(header); table.append(thead);
  const tbody = document.createElement('tbody');
  const rows = roundHistory.map((record) => ({ ...record, current: false }));
  rows.push({ round: roundNumber, scores: [...scores], current: true });
  for (const record of rows) {
    const tr = document.createElement('tr');
    if (record.current) tr.classList.add('current-round');
    const roundCell = document.createElement('td'); roundCell.className = 'round-label'; roundCell.textContent = record.current ? `第${record.round}局 · 进行中` : `第${record.round}局`;
    tr.append(roundCell);
    for (let seat = 0; seat < 4; seat++) {
      const td = document.createElement('td'); if (seat === mySeat) td.classList.add('my-seat');
      const score = document.createElement('span'); score.className = 'ledger-cell-score'; score.textContent = formatScore(record.scores[seat]);
      td.append(score); tr.append(td);
    }
    tbody.append(tr);
  }
  const previousTotals = roundHistory.length ? roundHistory[roundHistory.length - 1].totals : [0, 0, 0, 0];
  const totalRow = document.createElement('tr'); totalRow.className = 'total-row';
  const totalLabel = document.createElement('td'); totalLabel.textContent = '累计总分'; totalRow.append(totalLabel);
  for (let seat = 0; seat < 4; seat++) {
    const td = document.createElement('td'); if (seat === mySeat) td.classList.add('my-seat');
    td.textContent = formatScore((previousTotals[seat] || 0) + scores[seat]);
    totalRow.append(td);
  }
  const tfoot = document.createElement('tfoot'); tfoot.append(totalRow);
  table.append(tbody, tfoot); ledgerScroll.replaceChildren(table); ledgerScroll.scrollTop = previousScroll;
}

function setLedgerVisible(visible) {
  ledgerVisible = !!visible;
  ledgerPanel.hidden = !ledgerVisible;
  ledgerToggle.setAttribute('aria-expanded', String(ledgerVisible));
  ledgerToggle.textContent = ledgerVisible ? '收起流水' : '流水';
  if (ledgerVisible) { renderLedger(); ledgerScroll.scrollTop = ledgerScroll.scrollHeight; }
}

function bindStyleControls() {
  const background = document.querySelector('#backgroundBrightness');
  const backgroundValue = document.querySelector('#backgroundBrightnessValue');
  const tableColor = document.querySelector('#tableColor');
  const tableBrightness = document.querySelector('#tableBrightness');
  const tableBrightnessValue = document.querySelector('#tableBrightnessValue');
  const backColor = document.querySelector('#backColor');
  const faceBrightness = document.querySelector('#faceBrightness');
  const faceBrightnessValue = document.querySelector('#faceBrightnessValue');
  const baseBackground = new THREE.Color('#30271e');
  const applyBackground = () => {
    const value = Number(background.value);
    const color = baseBackground.clone().multiplyScalar(value);
    scene.background.copy(color); scene.fog.color.copy(color);
    for (const entry of backgroundMaterials) entry.material.color.copy(entry.baseColor).multiplyScalar(value);
    backgroundValue.textContent = value.toFixed(2);
  };
  const applyTableBrightness = () => {
    const value = Number(tableBrightness.value);
    feltMaterial.color.setScalar(value);
    tableBrightnessValue.textContent = value.toFixed(2);
  };
  background.addEventListener('input', applyBackground);
  tableColor.addEventListener('change', () => {
    const nextTexture = makeFeltTexture(tableColor.value); nextTexture.repeat.set(6, 6);
    const previousTexture = feltMaterial.map;
    feltMaterial.map = nextTexture; feltTexture = nextTexture;
    applyTableBrightness();
    feltMaterial.needsUpdate = true;
    previousTexture?.dispose();
  });
  tableBrightness.addEventListener('input', applyTableBrightness);
  backColor.addEventListener('change', () => tileFactory.setBackColor(backColor.value));
  faceBrightness.addEventListener('input', () => {
    const value = Number(faceBrightness.value);
    tileFactory.setFaceBrightness(value);
    faceBrightnessValue.textContent = value.toFixed(2);
  });
  applyBackground();
  applyTableBrightness();
  tileFactory.setBackColor(backColor.value);
  tileFactory.setFaceBrightness(Number(faceBrightness.value));
}

function setStatus(text, online = connected) {
  statusEl.textContent = text;
  statusEl.classList.toggle('online', online);
  statusEl.classList.toggle('offline', !online);
}

function toggleSocialMenu(seat) {
  if (seat === mySeat || !players[seat]?.connected) return;
  openEmojiMenu = false;
  openSocialSeat = openSocialSeat === seat ? null : seat;
  renderScoreboards();
}

function toggleEmojiMenu() {
  if (!players[mySeat]?.connected) return;
  openSocialSeat = null;
  openEmojiMenu = !openEmojiMenu;
  renderScoreboards();
}

function sendEmojiReaction(emoji) {
  if (!EMOJI_REACTIONS.includes(emoji)) return;
  send({ type: 'EMOJI_REACTION', emoji });
  openEmojiMenu = false;
  renderScoreboards();
}

function animateEmojiReaction(message) {
  const seat = Number(message.seat), emoji = String(message.emoji || '');
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !EMOJI_REACTIONS.includes(emoji)) return;
  const avatar = scoreboardRoot.querySelector(`.score-card[data-seat="${seat}"] .avatar`);
  if (!avatar) return;
  const rect = avatar.getBoundingClientRect(), card = avatar.closest('.score-card');
  let left = rect.left + rect.width / 2, top = rect.top - 6, position = 'above';
  if (card?.classList.contains('top')) { top = rect.bottom + 6; position = 'below'; }
  else if (card?.classList.contains('left')) { left = rect.right + 7; top = rect.top + rect.height / 2; position = 'right'; }
  else if (card?.classList.contains('right')) { left = rect.left - 7; top = rect.top + rect.height / 2; position = 'left'; }
  const bubble = document.createElement('div');
  bubble.className = 'emoji-reaction-bubble'; bubble.dataset.position = position; bubble.textContent = emoji;
  bubble.setAttribute('aria-hidden', 'true');
  bubble.style.left = `${Math.max(8, Math.min(innerWidth - 8, left))}px`;
  bubble.style.top = `${Math.max(8, Math.min(innerHeight - 8, top))}px`;
  socialEffectsRoot.append(bubble);
  const transforms = {
    above: ['translate(-50%,-78%) scale(.62)', 'translate(-50%,-100%) scale(1.08)', 'translate(-50%,-100%) scale(1)', 'translate(-50%,-124%) scale(.92)'],
    below: ['translate(-50%, -22%) scale(.62)', 'translate(-50%, 0) scale(1.08)', 'translate(-50%, 0) scale(1)', 'translate(-50%, 24%) scale(.92)'],
    left: ['translate(-78%,-50%) scale(.62)', 'translate(-100%,-50%) scale(1.08)', 'translate(-100%,-50%) scale(1)', 'translate(-124%,-50%) scale(.92)'],
    right: ['translate(-22%,-50%) scale(.62)', 'translate(0,-50%) scale(1.08)', 'translate(0,-50%) scale(1)', 'translate(24%,-50%) scale(.92)'],
  }[position];
  const animation = bubble.animate([
    { transform: transforms[0], opacity: 0 },
    { transform: transforms[1], opacity: 1, offset: .12 },
    { transform: transforms[2], opacity: 1, offset: .78 },
    { transform: transforms[3], opacity: 0 },
  ], { duration: 3200, easing: 'ease-out' });
  animation.onfinish = () => bubble.remove();
}

function sendSocialInteraction(targetSeat, item) {
  if (targetSeat === mySeat || !SOCIAL_ITEMS.some((entry) => entry.id === item)) return;
  send({ type: 'SOCIAL_INTERACTION', targetSeat, item });
}

function showSocialImpact(targetAvatar, item) {
  const entry = SOCIAL_ITEMS.find((value) => value.id === item);
  if (!entry || !targetAvatar) return;
  targetAvatar.style.setProperty('--social-hit-color', entry.color);
  targetAvatar.classList.remove('social-hit');
  void targetAvatar.offsetWidth;
  targetAvatar.classList.add('social-hit');
  setTimeout(() => targetAvatar.classList.remove('social-hit'), 850);
  const rect = targetAvatar.getBoundingClientRect();
  const impact = document.createElement('div');
  impact.className = 'social-impact'; impact.textContent = entry.impact;
  impact.style.left = `${rect.left + rect.width / 2}px`; impact.style.top = `${rect.top + rect.height / 2}px`;
  socialEffectsRoot.append(impact);
  const animation = impact.animate([
    { transform: 'translate(-50%,-50%) scale(.35) rotate(-18deg)', opacity: 0 },
    { transform: 'translate(-50%,-70%) scale(1.35) rotate(12deg)', opacity: 1, offset: .35 },
    { transform: 'translate(-50%,-115%) scale(.8) rotate(0deg)', opacity: 0 },
  ], { duration: 520, easing: 'ease-out' });
  animation.onfinish = () => impact.remove();
}

function animateSocialInteraction(message) {
  const entry = SOCIAL_ITEMS.find((value) => value.id === message.item);
  const sourceAvatar = scoreboardRoot.querySelector(`.score-card[data-seat="${message.fromSeat}"] .avatar`);
  const targetAvatar = scoreboardRoot.querySelector(`.score-card[data-seat="${message.targetSeat}"] .avatar`);
  if (!entry || !sourceAvatar || !targetAvatar) return;
  const sourceRect = sourceAvatar.getBoundingClientRect(), targetRect = targetAvatar.getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2, startY = sourceRect.top + sourceRect.height / 2;
  const endX = targetRect.left + targetRect.width / 2, endY = targetRect.top + targetRect.height / 2;
  const dx = endX - startX, dy = endY - startY;
  const arc = -Math.min(105, Math.max(48, Math.hypot(dx, dy) * .13));
  const projectile = document.createElement('div');
  projectile.className = `social-projectile social-projectile-${entry.id}`; projectile.textContent = entry.icon;
  projectile.style.left = `${startX}px`; projectile.style.top = `${startY}px`;
  socialEffectsRoot.append(projectile);
  const animation = projectile.animate([
    { transform: 'translate(-50%,-50%) translate(0px,0px) scale(.55) rotate(-18deg)', opacity: .15 },
    { transform: `translate(-50%,-50%) translate(${dx * .5}px,${dy * .5 + arc}px) scale(1.2) rotate(185deg)`, opacity: 1, offset: .56 },
    { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(.72) rotate(360deg)`, opacity: .25 },
  ], { duration: 720, easing: 'cubic-bezier(.18,.72,.25,1)' });
  animation.onfinish = () => {
    projectile.remove();
    const currentTarget = scoreboardRoot.querySelector(`.score-card[data-seat="${message.targetSeat}"] .avatar`);
    showSocialImpact(currentTarget || targetAvatar, entry.id);
  };
}

function renderScoreboards() {
  if (openSocialSeat !== null && (openSocialSeat === mySeat || !players[openSocialSeat]?.connected)) openSocialSeat = null;
  if (!players[mySeat]?.connected) openEmojiMenu = false;
  scoreboardRoot.replaceChildren();
  const positions = ['bottom', 'left', 'top', 'right'];
  for (let seat = 0; seat < 4; seat++) {
    const relative = (seat - mySeat + 4) % 4;
    const player = players[seat];
    const card = document.createElement('div');
    card.dataset.seat = String(seat);
    card.className = `score-card ${positions[relative]}${seat === mySeat ? ' me' : ''}${player && !player.connected ? ' disconnected' : ''}${openSocialSeat === seat ? ' social-open' : ''}${seat === mySeat && openEmojiMenu ? ' emoji-open' : ''}`;
    const avatarWrap = document.createElement('div'); avatarWrap.className = 'avatar-wrap';
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = player?.avatar || '👤';
    if (player?.connected) {
      avatar.classList.add('interactive'); avatar.setAttribute('role', 'button'); avatar.tabIndex = 0;
      avatar.title = seat === mySeat ? '点击选择表情' : `点击与${SEAT_NAMES[seat]}位${player.name}互动`;
      avatar.addEventListener('click', (event) => { event.stopPropagation(); seat === mySeat ? toggleEmojiMenu() : toggleSocialMenu(seat); });
      avatar.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); seat === mySeat ? toggleEmojiMenu() : toggleSocialMenu(seat); }
      });
    }
    avatarWrap.append(avatar);
    if (seat === mySeat && openEmojiMenu) {
      const menu = document.createElement('div'); menu.className = 'emoji-menu'; menu.setAttribute('aria-label', '选择表情');
      for (const emoji of EMOJI_REACTIONS) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'emoji-option'; button.textContent = emoji; button.title = `发送 ${emoji}`;
        button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); sendEmojiReaction(emoji); });
        menu.append(button);
      }
      avatarWrap.append(menu);
    }
    if (openSocialSeat === seat) {
      const menu = document.createElement('div'); menu.className = 'social-menu';
      for (const item of SOCIAL_ITEMS) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `social-option social-option-${item.id}`;
        button.title = item.label; button.innerHTML = `<span class="social-icon">${item.icon}</span><span>${item.label}</span>`;
        button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); sendSocialInteraction(seat, item.id); });
        menu.append(button);
      }
      avatarWrap.append(menu);
    }
    const info = document.createElement('div'); info.style.minWidth = '0';
    const dir = document.createElement('div'); dir.className = 'seat'; dir.textContent = `${SEAT_NAMES[seat]}位${seat === mySeat ? ' · 你' : ''}`;
    const name = document.createElement('div'); name.className = 'name'; name.textContent = player?.name || '等待玩家';
    const previousTotals = roundHistory.length ? roundHistory[roundHistory.length - 1].totals : [0, 0, 0, 0];
    const scoreLines = document.createElement('div'); scoreLines.className = 'score-lines';
    const currentRow = document.createElement('div'); currentRow.className = 'score-row';
    const currentLabel = document.createElement('span'); currentLabel.className = 'score-label'; currentLabel.textContent = '本局';
    const currentScore = document.createElement('span'); currentScore.className = `score${scores[seat] < 0 ? ' negative' : ''}`; currentScore.textContent = formatScore(scores[seat]);
    currentRow.append(currentLabel, currentScore);
    const totalRow = document.createElement('div'); totalRow.className = 'score-row';
    const totalLabel = document.createElement('span'); totalLabel.className = 'score-label'; totalLabel.textContent = '总分';
    const totalValue = (previousTotals[seat] || 0) + scores[seat];
    const totalScore = document.createElement('span'); totalScore.className = `score total${totalValue < 0 ? ' negative' : ''}`; totalScore.textContent = formatScore(totalValue);
    totalRow.append(totalLabel, totalScore);
    scoreLines.append(currentRow, totalRow);
    info.append(dir, name, scoreLines);
    card.append(avatarWrap, info);
    if (seat === mySeat) {
      const edit = document.createElement('button'); edit.className = 'edit'; edit.textContent = '计分';
      edit.title = '修改自己的本局分数';
      edit.addEventListener('click', openScoreEditor);
      card.append(edit);
    }
    scoreboardRoot.append(card);
    applyActionEffect(card, seat);
    applyScoreEffect(card, seat);
  }
  updateRoundDisplay();
  renderLedger();
}

function updateScoreEditPreview() {
  const raw = scoreEditInput.value.trim();
  const value = Number(raw);
  const valid = raw !== '' && Number.isSafeInteger(value) && Math.abs(value) <= 100000;
  const delta = valid ? (scoreEditMode === 'delta' ? value : value - scores[mySeat]) : 0;
  const next = valid ? scores[mySeat] + delta : scores[mySeat];
  scoreEditPreview.textContent = valid ? `修改后本局得分：${formatScore(next)}（本次变化 ${delta > 0 ? '+' : ''}${delta}）` : '请输入 -100000 至 100000 的整数';
  scoreEditConfirm.disabled = !valid || !Number.isSafeInteger(next);
}

function setScoreEditMode(mode) {
  scoreEditMode = mode === 'set' ? 'set' : 'delta';
  document.querySelectorAll('[data-score-mode]').forEach((button) => button.classList.toggle('active', button.dataset.scoreMode === scoreEditMode));
  scoreEditLabel.textContent = scoreEditMode === 'delta' ? '分数增量' : '设定分数';
  scoreEditInput.value = scoreEditMode === 'delta' ? '10' : String(scores[mySeat]);
  updateScoreEditPreview();
}

function openScoreEditor() {
  scoreEditCurrent.textContent = `当前本局分数：${formatScore(scores[mySeat])} · 仅能修改自己的方位计分板`;
  setScoreEditMode('delta');
  scoreEditOverlay.hidden = false;
  scoreEditInput.focus(); scoreEditInput.select();
}

function closeScoreEditor() { scoreEditOverlay.hidden = true; }

function applyScoreEffect(card, seat) {
  card.querySelectorAll('.score-delta-pop').forEach((node) => node.remove());
  const effect = scoreEffects[seat];
  if (!effect || effect.until <= Date.now()) return;
  card.style.setProperty('--score-color', effect.color);
  card.classList.remove('score-flash'); void card.offsetWidth; card.classList.add('score-flash');
  const label = document.createElement('div'); label.className = 'score-delta-pop'; label.textContent = effect.label; label.style.color = effect.color;
  card.append(label);
  const remaining = Math.max(100, effect.until - Date.now()); label.style.animationDuration = `${remaining}ms`;
  setTimeout(() => label.remove(), remaining + 50);
}

function setScoreEffect(seat, delta) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !Number.isFinite(delta) || delta === 0) return;
  scoreEffects[seat] = { label: `${delta > 0 ? '+' : ''}${delta}`, color: delta > 0 ? '#5be29a' : '#ff7478', until: Date.now() + 3000 };
  if (scoreTimers[seat]) clearTimeout(scoreTimers[seat]);
  scoreTimers[seat] = setTimeout(() => {
    scoreEffects[seat] = null; scoreTimers[seat] = null;
    const card = scoreboardRoot.querySelector(`[data-seat="${seat}"]`);
    card?.classList.remove('score-flash'); card?.querySelector('.score-delta-pop')?.remove();
  }, 3050);
}

function actionStyle(action) {
  return ({ chi: { label: '吃', color: '#43d7ff' }, penggang: { label: '碰/杠', color: '#ffbd55' }, hu: { label: '胡', color: '#ff5c83' } })[action];
}

function applyActionEffect(card, seat) {
  card.querySelectorAll('.action-pop').forEach((node) => node.remove());
  const effect = actionEffects[seat];
  if (!effect || effect.until <= Date.now()) return;
  card.style.setProperty('--action-color', effect.color);
  card.classList.remove('action-flash'); void card.offsetWidth; card.classList.add('action-flash');
  const label = document.createElement('div'); label.className = 'action-pop'; label.textContent = effect.label; label.style.color = effect.color;
  card.append(label);
  const remaining = Math.max(100, effect.until - Date.now());
  label.style.animationDuration = `${remaining}ms`;
  setTimeout(() => label.remove(), remaining + 50);
}

function showPlayerAction(seat, action) {
  const style = actionStyle(action);
  if (!style || !Number.isInteger(seat) || seat < 0 || seat > 3) return;
  actionEffects[seat] = { ...style, until: Date.now() + 3000 };
  if (actionTimers[seat]) clearTimeout(actionTimers[seat]);
  actionTimers[seat] = setTimeout(() => {
    actionEffects[seat] = null; actionTimers[seat] = null;
    const card = scoreboardRoot.querySelector(`[data-seat="${seat}"]`);
    card?.classList.remove('action-flash');
    card?.querySelector('.action-pop')?.remove();
  }, 3050);
  const card = scoreboardRoot.querySelector(`[data-seat="${seat}"]`);
  if (card) applyActionEffect(card, seat);
}

function handleInteractiveClick(interaction) {
  if (!interaction) return;
  if (interaction.kind === 'dealer') send({ type: 'TOGGLE_DEALER', seat: interaction.seat });
  else if (interaction.kind === 'dice') send({ type: 'ROLL_DICE' });
}

function interactiveAtPointer() {
  if (!pointerInside || !interactiveMeshes.length) return null;
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObjects(interactiveMeshes, false)[0];
  return hit?.object?.userData?.interaction || null;
}

function send(message) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  else showToast('服务器未连接');
}

function updateTilePose(tile, immediate = false) {
  const mesh = tileMeshes.get(tile.id);
  if (!mesh) return;
  mesh.userData.state = tile;
  tileFactory.setConcealed(mesh, !!tile.concealed);
  const targetPosition = new THREE.Vector3(tile.position.x, tile.position.y, tile.position.z);
  const targetQuaternion = tileQuaternion(tile);
  mesh.userData.targetPosition = targetPosition;
  mesh.userData.targetQuaternion = targetQuaternion;
  if (immediate || tile.heldBy === mySeat) {
    mesh.position.copy(targetPosition); mesh.quaternion.copy(targetQuaternion);
  }
}

function clearTileMeshes() {
  for (const mesh of tileMeshes.values()) {
    tileGroup.remove(mesh); tileFactory.disposeMesh(mesh);
  }
  tileMeshes.clear(); tiles.clear(); heldId = null; pendingGrabId = null;
  hoveredTileId = null;
  cursorDot.visible = false;
}

function applyTableState(snapshot) {
  clearTileMeshes();
  scores = snapshot.scores || [0, 0, 0, 0];
  roundNumber = snapshot.roundNumber || 1;
  roundHistory = snapshot.roundHistory || [];
  players = snapshot.players || players;
  updateDealerVisual(snapshot.dealerSeat);
  const diceState = snapshot.diceState || { rolling: false, values: [1, 1], rollId: 0 };
  if (diceState.rolling) startDiceRoll(Math.max(100, (diceState.durationMs || 3000)), diceState.rollId || 0, diceState.spin || [], Date.now() - (diceState.rollStartedAt || Date.now()), diceState.targetValues || diceState.values || [1, 1]);
  else finishDiceRoll(diceState.rollId || 0, diceState.values || [1, 1]);
  for (const tile of snapshot.tiles || []) {
    tiles.set(tile.id, tile);
    const mesh = tileFactory.create(tile);
    tileMeshes.set(tile.id, mesh); tileGroup.add(mesh);
    updateTilePose(tile, true);
  }
  renderScoreboards();
  setStatus(`已连接 · ${players.filter(Boolean).length}/4 人在线`, true);
}

function applyTileUpdate(tile) {
  const previous = tiles.get(tile.id);
  if (!previous) return;
  tiles.set(tile.id, tile);
  if (!tile.heldBy && heldId === tile.id) heldId = null;
  if (tile.heldBy === mySeat) heldId = tile.id;
  if (previous.type !== tile.type || previous.value !== tile.value) {
    const oldMesh = tileMeshes.get(tile.id);
    if (oldMesh) { tileGroup.remove(oldMesh); tileFactory.disposeMesh(oldMesh); }
    const nextMesh = tileFactory.create(tile);
    tileMeshes.set(tile.id, nextMesh); tileGroup.add(nextMesh);
  }
  updateTilePose(tile, tile.heldBy === mySeat);
}

function updatePlayers(nextPlayers) {
  players = nextPlayers || players;
  renderScoreboards();
  setStatus(`已连接 · ${players.filter(Boolean).length}/4 人在线`, true);
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.addEventListener('open', () => {
    connected = true; setStatus('已连接 · 正在加入座位', true);
    send({ type: 'JOIN', seat: mySeat, name: myName, avatar: myAvatar, sessionId });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'JOIN_OK') {
      applyTableState(message.snapshot);
      setTimeout(() => loader.classList.add('hide'), 250);
    } else if (message.type === 'TABLE_STATE') {
      applyTableState(message);
    } else if (message.type === 'TILES_UPDATE') {
      for (const tile of message.tiles) applyTileUpdate(tile);
    } else if (message.type === 'PLAYERS') {
      updatePlayers(message.players);
    } else if (message.type === 'SCORES_UPDATE') {
      scores = message.scores; roundNumber = message.roundNumber || roundNumber; roundHistory = message.roundHistory || roundHistory; setScoreEffect(message.changedSeat, message.delta); renderScoreboards();
    } else if (message.type === 'DEALER_UPDATE') {
      updateDealerVisual(message.dealerSeat);
    } else if (message.type === 'DICE_ROLL_START') {
      startDiceRoll(message.durationMs, message.rollId, message.spin || [], Date.now() - (message.rollStartedAt || Date.now()), message.values || [1, 1]);
    } else if (message.type === 'DICE_ROLL_END') {
      finishDiceRoll(message.rollId, message.values);
    } else if (message.type === 'PLAYER_ACTION') {
      showPlayerAction(message.seat, message.action);
    } else if (message.type === 'SOCIAL_INTERACTION') {
      animateSocialInteraction(message);
    } else if (message.type === 'EMOJI_REACTION') {
      animateEmojiReaction(message);
    } else if (message.type === 'PLAYER_OFFLINE') {
      showCenterNotice(`${SEAT_NAMES[message.seat]}位${message.name}已离线`);
    } else if (message.type === 'NOTICE') {
      showToast(message.message || '当前操作无法执行');
    } else if (message.type === 'LEAVE_OK') {
      location.href = '/';
    } else if (message.type === 'NEXT_ROUND_PROGRESS') {
      closeScoreEditor();
      showNextRoundDialog({ proposalId: message.proposalId, requesterSeat: message.requesterSeat, requesterName: message.requesterName, approvals: message.approvals || [] });
    } else if (message.type === 'NEXT_ROUND_CANCELLED') {
      closeScoreEditor(); activeNextRoundProposal = null; closeDialog();
      if (message.reason === 'rejected') showCenterNotice(`${SEAT_NAMES[message.seat]}位${message.name}拒绝了下一局申请`);
      else if (message.reason === 'player_left' || message.reason === 'player_disconnected') showCenterNotice('玩家离线，下一局申请已取消');
    } else if (message.type === 'NEXT_ROUND_DONE') {
      closeScoreEditor(); activeNextRoundProposal = null; closeDialog();
      roundNumber = message.roundNumber || roundNumber + 1; roundHistory = message.roundHistory || roundHistory; scores = message.scores || [0, 0, 0, 0];
      updateRoundDisplay(); renderLedger();
      showCenterNotice(`全员确认通过 · 第 ${roundNumber} 局开始`, 3000);
    } else if (message.type === 'GRAB_OK') {
      pendingGrabId = null;
      if (tiles.get(message.tileId)?.heldBy === mySeat) {
        heldId = message.tileId;
        updateHeldAtPointer(true);
      }
    } else if (message.type === 'CANCEL_OK') {
      if (heldId === message.tileId) heldId = null;
      if (pendingGrabId === message.tileId) pendingGrabId = null;
      showToast('已撤销拾取', 700);
    } else if (message.type === 'ACTION_REJECTED') {
      pendingGrabId = null;
      showToast(message.message || '操作未成功');
    } else if (message.type === 'ERROR') {
      showToast(message.message || '加入失败', 2500);
      setTimeout(() => location.replace('/'), 1800);
    }
  });
  ws.addEventListener('close', () => {
    connected = false; setStatus('连接断开 · 请刷新页面', false);
  });
  ws.addEventListener('error', () => setStatus('网络连接错误', false));
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  pointerInside = event.target === renderer.domElement && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  raycaster.setFromCamera(pointerNdc, camera);
}

function tablePoint() {
  raycaster.setFromCamera(pointerNdc, camera);
  return raycaster.ray.intersectPlane(tablePlane, tempPoint) ? tempPoint.clone() : null;
}

function isOnTable(point) {
  return !!point && Math.abs(point.x) <= TABLE_LIMIT && Math.abs(point.z) <= TABLE_LIMIT;
}

function tileAtPointer() {
  if (!pointerInside) return null;
  raycaster.setFromCamera(pointerNdc, camera);
  const intersections = raycaster.intersectObjects([...tileMeshes.values()], false);
  return intersections.length ? { id: intersections[0].object.userData.tileId, point: intersections[0].point.clone() } : null;
}

function updateCursorAndHover() {
  if (!pointerInside) { cursorDot.visible = false; setHover(null); return; }
  const hit = tileAtPointer();
  if (heldId) {
    const point = tablePoint();
    if (point && isOnTable(point)) {
      cursorDot.visible = true; cursorDot.position.set(point.x, TABLE_TOP + .035, point.z);
      cursorMaterial.color.set('#39d98a');
    } else {
      cursorDot.visible = true;
      const floorHit = raycaster.ray.intersectPlane(floorPlane, tempPoint);
      if (floorHit) cursorDot.position.copy(floorHit).add(new THREE.Vector3(0, .04, 0));
      cursorMaterial.color.set('#ef5350');
    }
    setHover(null);
    return;
  }
  if (hit) {
    cursorDot.visible = true; cursorDot.position.copy(hit.point).add(new THREE.Vector3(0, .035, 0));
    cursorMaterial.color.set('#39d98a');
    setHover(hit.id);
  } else {
    const point = tablePoint();
    cursorDot.visible = true;
    if (point && isOnTable(point)) cursorDot.position.set(point.x, TABLE_TOP + .035, point.z);
    else {
      const floorHit = raycaster.ray.intersectPlane(floorPlane, tempPoint);
      if (floorHit) cursorDot.position.copy(floorHit).add(new THREE.Vector3(0, .04, 0));
    }
    cursorMaterial.color.set('#ef5350');
    setHover(null);
  }
}

function setHover(id) {
  if (hoveredTileId === id) return;
  const old = hoveredTileId ? tileMeshes.get(hoveredTileId) : null;
  if (old?.material?.[4]?.emissive) old.material[4].emissive.set('#000000');
  hoveredTileId = id;
  const next = id ? tileMeshes.get(id) : null;
  if (next?.material?.[4]?.emissive) next.material[4].emissive.set('#4b3a18');
}

function requestGrab(id) {
  if (!id || heldId || pendingGrabId) return;
  pendingGrabId = id;
  send({ type: 'GRAB_TILE', tileId: id });
}

function heldState() {
  return heldId ? tiles.get(heldId) : null;
}

function updateHeldAtPointer(forceSend = false) {
  const tile = heldState();
  if (!tile || !pointerInside) return;
  const point = tablePoint();
  if (!point || !isOnTable(point)) return;
  const x = point.x, z = point.z;
  tile.position = { x, y: TABLE_TOP + TILE_H / 2, z };
  tile.standing = true;
  const mesh = tileMeshes.get(tile.id);
  if (mesh) { mesh.position.set(x, tile.position.y, z); mesh.quaternion.copy(tileQuaternion(tile)); }
  const now = performance.now();
  if (forceSend || now - lastMoveSent >= 48) {
    lastMoveSent = now;
    send({ type: 'MOVE_TILE', tileId: tile.id, position: { x, z }, yaw: tile.yaw, faceUp: tile.faceUp });
  }
}

function releaseAtPointer() {
  const tile = heldState();
  if (!tile) return;
  const point = tablePoint();
  if (!isOnTable(point)) { showToast('只能放在麻将桌台面上'); return; }
  send({ type: 'RELEASE_TILE', tileId: tile.id, position: { x: point.x, z: point.z }, yaw: tile.yaw, faceUp: tile.faceUp });
}

function rotateHeld(direction) {
  const tile = heldState(); if (!tile) return;
  tile.yaw += direction * Math.PI / 18;
  updateHeldAtPointer(true);
}

function flipHeld() {
  const tile = heldState(); if (!tile) return;
  tile.faceUp = !tile.faceUp;
  updateHeldAtPointer(true);
  showToast(tile.faceUp ? '已翻为正面' : '已翻为牌背', 700);
}

function onPointerDown(event) {
  updatePointer(event);
  const hit = tileAtPointer();
  const canvas = renderer.domElement;
  if (event.button === 0) {
    const interaction = interactiveAtPointer();
    if (interaction && !hit) {
      event.preventDefault(); event.stopImmediatePropagation();
      handleInteractiveClick(interaction);
      return;
    }
    if (heldId || hit) {
      event.preventDefault(); event.stopImmediatePropagation();
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      if (heldId) releaseAtPointer();
      else requestGrab(hit.id);
    }
  }
}

function onPointerMove(event) {
  updatePointer(event);
  if (heldId) updateHeldAtPointer(false);
  updateCursorAndHover();
}

function onKeyDown(event) {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  const key = event.key.toLowerCase();
  if (key === 'w') {
    event.preventDefault(); flipHeld();
  } else if (key === 's') {
    event.preventDefault();
    const tile = heldState();
    if (tile) {
      tile.yaw = SEAT_YAW[mySeat]; tile.faceUp = true;
      const mesh = tileMeshes.get(tile.id);
      if (mesh) mesh.quaternion.copy(tileQuaternion(tile));
      send({ type: 'MOVE_TILE', tileId: tile.id, position: { x: tile.position.x, z: tile.position.z }, yaw: tile.yaw, faceUp: tile.faceUp });
      showToast('已调整为正对自己的手牌状态', 800);
    }
  } else if (key === 'a') {
    event.preventDefault(); rotateHeld(-1);
  } else if (key === 'd') {
    event.preventDefault(); rotateHeld(1);
  }
}

function onRightPointerDown(event) {
  if (event.button !== 2) return;
  event.preventDefault();
  const cancelId = heldId || pendingGrabId;
  if (cancelId) send({ type: 'CANCEL_GRAB', tileId: cancelId });
}

function bindInteraction() {
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerdown', onRightPointerDown, true);
  window.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if ((openSocialSeat !== null || openEmojiMenu) && !target.closest?.('.social-menu') && !target.closest?.('.emoji-menu') && !target.closest?.('.avatar.interactive')) {
      openSocialSeat = null; openEmojiMenu = false;
      renderScoreboards();
    }
  });
  canvas.addEventListener('pointerleave', () => { pointerInside = false; cursorDot.visible = false; setHover(null); });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('keydown', onKeyDown);
}

const frameClock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = frameClock.getDelta();
  const alpha = 1 - Math.exp(-delta * 18);
  for (const [id, mesh] of tileMeshes) {
    if (id === heldId) continue;
    const p = mesh.userData.targetPosition;
    const q = mesh.userData.targetQuaternion;
    if (p) mesh.position.lerp(p, alpha);
    if (q) mesh.quaternion.slerp(q, alpha);
  }
  controls.update();
  const now = performance.now();
  updateDiceAnimation(delta, now);
  renderer.render(scene, camera);
}

function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function resetMainView() {
  controls.reset();
  showToast('已切回主视角', 800);
}

function bindButtons() {
  shuffleButton.addEventListener('click', () => send({ type: 'NEXT_ROUND_REQUEST' }));
  ledgerToggle.addEventListener('click', () => setLedgerVisible(!ledgerVisible));
  scoreEditInput.addEventListener('input', updateScoreEditPreview);
  document.querySelectorAll('[data-score-mode]').forEach((button) => button.addEventListener('click', () => setScoreEditMode(button.dataset.scoreMode)));
  scoreEditCancel.addEventListener('click', closeScoreEditor);
  scoreEditConfirm.addEventListener('click', () => {
    const value = Number(scoreEditInput.value.trim());
    if (!Number.isSafeInteger(value) || Math.abs(value) > 100000) return showToast('请输入 -100000 至 100000 的整数');
    send({ type: 'SCORE_CHANGE', mode: scoreEditMode, value }); closeScoreEditor();
  });
  scoreEditOverlay.addEventListener('click', (event) => { if (event.target === scoreEditOverlay) closeScoreEditor(); });
  mainViewButton.addEventListener('click', resetMainView);
  actionButtons.forEach((button) => button.addEventListener('click', () => send({ type: 'PLAYER_ACTION', action: button.dataset.action }))); 
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { showToast('当前浏览器不允许进入全屏'); }
  });
  leaveButton.addEventListener('click', () => openDialog({
    title: '确认离开牌桌？',
    message: '离开后将释放当前座位，其他玩家会收到离线提示。',
    confirmText: '确认离开',
    cancelText: '继续游戏',
    onConfirm: () => { leaveButton.disabled = true; dialogConfirm.disabled = true; send({ type: 'LEAVE' }); },
    onCancel: closeDialog,
  }));
}

async function main() {
  initScene();
  tileFactory = await createTileFactory(renderer);
  bindStyleControls();
  bindInteraction(); bindButtons();
  connect();
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => {
    for (const mesh of tileMeshes.values()) tileFactory.disposeMesh(mesh);
    tileFactory.dispose(); renderer.dispose();
  });
  animate();
  setTimeout(() => loader.classList.add('hide'), 10000);
}

main().catch((error) => {
  console.error(error);
  loader.textContent = `3D 场景初始化失败：${error.message}`;
  setStatus('初始化失败，请检查浏览器控制台', false);
});
