import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const COLS = 9, ROWS = 4;
const FENG = ['東', '南', '西', '北', '中', '發', '白'];

function atlasIndex(type, value) {
  if (type === 'wan') return Number(value) - 1;
  if (type === 'tong') return 9 + Number(value) - 1;
  if (type === 'tiao') return 18 + Number(value) - 1;
  if (type === 'feng') return 27 + FENG.indexOf(value);
  return 0;
}

function canvasTexture(draw, width = 256, height = 384) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export async function createTileFactory(renderer) {
  const atlas = await new THREE.TextureLoader().loadAsync('/assets/tiles-atlas.png');
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = true;

  const sideTexture = canvasTexture((ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#cdbb98'); gradient.addColorStop(.5, '#f2e5c9'); gradient.addColorStop(1, '#c7b48f');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  }, 64, 256);
  const backTexture = canvasTexture((ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#b8b8b8'); gradient.addColorStop(1, '#666666');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(235,220,185,.9)'; ctx.lineWidth = 5; ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.lineWidth = 2; ctx.strokeRect(27, 27, w - 54, h - 54);
    ctx.fillStyle = 'rgba(245,232,205,.95)'; ctx.font = 'bold 84px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('雀', w / 2, h / 2);
  });
  const questionTexture = canvasTexture((ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#fff7e7'); gradient.addColorStop(1, '#e8d8b8');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,91,49,.48)'; ctx.lineWidth = 9; ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.fillStyle = '#76572e'; ctx.font = 'bold 210px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', w / 2, h / 2 + 8);
  });

  const geometry = new RoundedBoxGeometry(.8, 1.1, .5, 4, .05);
  const sideMaterial = new THREE.MeshStandardMaterial({ map: sideTexture, roughness: .38, metalness: .03 });
  const backMaterial = new THREE.MeshStandardMaterial({ map: backTexture, color: '#1b6845', roughness: .42, metalness: .04 });
  const questionMaterial = new THREE.MeshStandardMaterial({ map: questionTexture, roughness: .36, metalness: .02, emissive: '#000000' });
  const meshes = new Set();
  let faceBrightness = 1;

  function create(tile) {
    const index = atlasIndex(tile.type, tile.value);
    const col = index % COLS, row = Math.floor(index / COLS);
    const faceTexture = atlas.clone();
    faceTexture.offset.set(col / COLS, 1 - (row + 1) / ROWS);
    faceTexture.repeat.set(1 / COLS, 1 / ROWS);
    faceTexture.needsUpdate = true;
    const faceMaterial = new THREE.MeshStandardMaterial({ map: faceTexture, color: new THREE.Color().setScalar(faceBrightness), roughness: .34, metalness: .02, emissive: '#000000' });
    const hiddenFaceMaterial = tile.concealed ? questionMaterial.clone() : null;
    const mesh = new THREE.Mesh(geometry, [sideMaterial, sideMaterial, sideMaterial, sideMaterial, hiddenFaceMaterial || faceMaterial, backMaterial]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.tileId = tile.id;
    mesh.userData.faceTexture = faceTexture;
    mesh.userData.faceMaterial = faceMaterial;
    mesh.userData.hiddenFaceMaterial = hiddenFaceMaterial;
    mesh.userData.concealed = !!tile.concealed;
    meshes.add(mesh);
    return mesh;
  }

  function setConcealed(mesh, concealed) {
    if (mesh.userData.concealed === concealed) return;
    if (concealed) {
      mesh.userData.hiddenFaceMaterial = questionMaterial.clone();
      mesh.material[4] = mesh.userData.hiddenFaceMaterial;
    } else {
      mesh.material[4] = mesh.userData.faceMaterial;
      mesh.userData.hiddenFaceMaterial?.dispose();
      mesh.userData.hiddenFaceMaterial = null;
    }
    mesh.userData.concealed = concealed;
  }

  function disposeMesh(mesh) {
    meshes.delete(mesh);
    if (mesh.userData.faceTexture) mesh.userData.faceTexture.dispose();
    mesh.userData.faceMaterial?.dispose();
    mesh.userData.hiddenFaceMaterial?.dispose();
  }

  function setBackColor(color) { backMaterial.color.set(color); }
  function setFaceBrightness(value) {
    faceBrightness = Math.max(.35, Math.min(1.6, Number(value) || 1));
    for (const mesh of meshes) mesh.userData.faceMaterial?.color.setScalar(faceBrightness);
  }

  function dispose() {
    geometry.dispose(); sideMaterial.dispose(); backMaterial.dispose(); questionMaterial.dispose();
    sideTexture.dispose(); backTexture.dispose(); questionTexture.dispose(); atlas.dispose();
  }

  return { create, setConcealed, disposeMesh, setBackColor, setFaceBrightness, dispose };
}

export function tileQuaternion(tile) {
  const yaw = Number(tile.yaw || 0);
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  if (tile.standing) {
    if (!tile.faceUp) qYaw.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    return qYaw;
  }
  const x = tile.faceUp ? -Math.PI / 2 : Math.PI / 2;
  return qYaw.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), x));
}

