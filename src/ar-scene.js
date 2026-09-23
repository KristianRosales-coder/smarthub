import * as THREE from 'three';

let camera, scene, renderer;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let hitTestSourceLocal = null;
let hitTestSourceLocalRequested = false;

// Floor chunk & single-tile configuration
const floorChunks = new Map(); // key: `${gx},${gz}` -> Mesh
const CHUNK_SIZE = 0.3; // 0.3m (30cm) — single tile unit
const TILE_SIZE = 0.3;  
const FLOOR_OFFSET_Y = 0.001; // 1mm tiny offset flush to physical ground

// Ground Stabilization (Fixes uneven surface detection & floating height)
let masterGroundY = null; 
const Y_SNAP_THRESHOLD = 0.15; // 15cm max variance before re-anchoring

let xrGlBinding = null;
let floorTexture = null;
let directionalLight, ambientLight;
let debugEl, statusEl;

function debug(msg) {
  try { console.log(msg); } catch (e) {}
  if (!debugEl) return;
  const line = document.createElement('div');
  line.textContent = (new Date()).toLocaleTimeString() + ' — ' + msg;
  debugEl.appendChild(line);
  while (debugEl.children.length > 10) debugEl.removeChild(debugEl.firstChild);
}

init();

function init() {
  scene = new THREE.Scene();
  // 1mm near-plane prevents tiles from disappearing when looking close or under edges
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.001, 20);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // HUD Debugger
  debugEl = document.createElement('div');
  debugEl.style.cssText = 'position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.6);color:#b8ffb8;padding:8px;border-radius:6px;font-family:monospace;font-size:12px;z-index:9999;max-width:50vw;max-height:40vh;overflow:auto;';
  debugEl.innerHTML = '<div style="font-weight:bold;margin-bottom:6px">AR Debug</div>';
  statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:11px;margin-bottom:6px;color:#fff;';
  statusEl.textContent = 'status: idle';
  debugEl.appendChild(statusEl);
  document.body.appendChild(debugEl);

  // Enter AR Button
  const arButton = document.createElement('button');
  arButton.textContent = 'Enter AR';
  arButton.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:16px 32px;font-size:18px;z-index:10;border-radius:8px;border:none;background:#2196F3;color:white;font-weight:bold;';
  document.body.appendChild(arButton);

  arButton.addEventListener('click', async () => {
    // Prefer native WebXR if available
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (navigator.xr && navigator.xr.isSessionSupported) {
      try {
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (supported) {
          try {
            const session = await navigator.xr.requestSession('immersive-ar', {
              requiredFeatures: ['hit-test', 'plane-detection'],
              optionalFeatures: ['local-floor', 'bounded-floor', 'depth-sensing', 'light-estimation'],
              depthSensing: { usagePreference: ['gpu-optimized','cpu-optimized'], dataFormatPreference: ['luminance-alpha'] }
            });
            onSessionStarted(session);
            return;
          } catch (e) {
            debug('requestSession failed: ' + e.message);
            // fall through to try reduced feature set
          }
          try {
            const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['local-floor'] });
            onSessionStarted(session);
            return;
          } catch (e2) {
            debug('reduced requestSession failed: ' + e2.message);
          }
        }
      } catch (ie) {
        debug('isSessionSupported error: ' + ie.message);
      }
    }

    // If we're on iOS, try Quick Look (USDZ) fallback — requires a USDZ file
    if (isIOS) {
      debug('iOS detected: attempting Quick Look fallback.');
      // The app should provide a USDZ in /public (e.g., tile-quicklook.usdz)
      const usdzUrl = '/tile-quicklook.usdz';
      const a = document.createElement('a');
      a.rel = 'ar';
      a.href = usdzUrl;
      // Optional: add a thumbnail for AR Quick Look on iOS
      // a.appendChild(document.createElement('img')).src = '/tile-preview.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    alert('AR not available on this device/browser. Try Chrome on Android or use an AR-capable device.');
  });

  // Target reticle ring
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.04, 0.06, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Tap interaction
  const controller = renderer.xr.getController(0);
  controller.addEventListener('select', () => {
    if (reticle.visible) {
      const worldPos = new THREE.Vector3();
      worldPos.setFromMatrixPosition(reticle.matrix);
      
      // Lock master ground level on explicit tap
      masterGroundY = worldPos.y;
      debug(`Master ground level locked at Y = ${masterGroundY.toFixed(3)}m`);

      if (!floorTexture) {
        loadAndApplyFloorTexture(worldPos);
      } else {
        ensureFloorChunkAt(worldPos, floorTexture);
      }
    }
  });
  scene.add(controller);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function onSessionStarted(session) {
  try {
    if (renderer.xr.setReferenceSpaceType) renderer.xr.setReferenceSpaceType('local-floor');
  } catch (err) {
    debug('Could not set reference space to local-floor: ' + err.message);
  }

  renderer.xr.setSession(session);

  try {
    if (window.XRWebGLBinding) {
      xrGlBinding = new window.XRWebGLBinding(session, renderer.getContext());
    }
  } catch (e) {
    debug('XRWebGLBinding error: ' + e.message);
  }

  directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
  directionalLight.position.set(0.5, 1, 0.25);
  scene.add(directionalLight);
  ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  session.requestReferenceSpace('viewer').then((refSpace) => {
    session.requestHitTestSource({ space: refSpace }).then((source) => {
      hitTestSource = source;
      hitTestSourceRequested = true;
    });
  });

  session.requestReferenceSpace('local-floor').then((localRef) => {
    session.requestHitTestSource({ space: localRef }).then((source) => {
      hitTestSourceLocal = source;
      hitTestSourceLocalRequested = true;
    });
  });

  renderer.setAnimationLoop(render);
}

function loadAndApplyFloorTexture(worldPos) {
  const loader = new THREE.TextureLoader();
  loader.load('/tile-sample.jpg', (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    
    floorTexture = texture;
    debug('Base 30cm single-tile texture loaded.');
    ensureFloorChunkAt(worldPos, floorTexture);
  });
}

function ensureFloorChunkAt(worldPos, baseTexture) {
  const gx = Math.floor(worldPos.x / CHUNK_SIZE);
  const gz = Math.floor(worldPos.z / CHUNK_SIZE);
  const key = `${gx},${gz}`;
  if (floorChunks.has(key)) return;

  const cx = (gx + 0.5) * CHUNK_SIZE;
  const cz = (gz + 0.5) * CHUNK_SIZE;

  // Lock to master ground floor height once determined
  if (masterGroundY === null) {
    masterGroundY = worldPos.y;
  } else if (Math.abs(worldPos.y - masterGroundY) < Y_SNAP_THRESHOLD) {
    masterGroundY = masterGroundY * 0.9 + worldPos.y * 0.1; // Smooth out noise
  }

  const cy = masterGroundY;

  createFloorChunk(key, cx, cy, cz, baseTexture);
}

function createFloorChunk(key, cx, cy, cz, texture) {
  const mapTex = texture.clone();
  mapTex.wrapS = THREE.RepeatWrapping;
  mapTex.wrapT = THREE.RepeatWrapping;
  mapTex.repeat.set(1, 1); // 1 single 30cm tile mapping

  // World-space UV offset alignment
  const originX = cx - CHUNK_SIZE * 0.5;
  const originZ = cz - CHUNK_SIZE * 0.5;
  mapTex.offset.set((originX / TILE_SIZE) % 1, (originZ / TILE_SIZE) % 1);
  mapTex.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    map: mapTex,
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.DoubleSide, // Ensures visibility under sharp angles/furniture
    depthTest: true,
    depthWrite: true
  });

  const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(cx, cy + FLOOR_OFFSET_Y, cz);

  scene.add(mesh);
  floorChunks.set(key, mesh);
}

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    let usedHit = null;

    if (hitTestSource) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0) usedHit = results[0];
    }
    if (hitTestSourceLocal && !usedHit) {
      const resultsLocal = frame.getHitTestResults(hitTestSourceLocal);
      if (resultsLocal.length > 0) usedHit = resultsLocal[0];
    }

    if (usedHit) {
      const pose = usedHit.getPose(referenceSpace);
      if (pose) {
        reticle.visible = true;
        
        const rawPos = new THREE.Vector3().setFromMatrixPosition(
          new THREE.Matrix4().fromArray(pose.transform.matrix)
        );
        
        const targetY = (masterGroundY !== null) ? masterGroundY : rawPos.y;
        
        reticle.matrix.identity();
        reticle.matrix.setPosition(rawPos.x, targetY + FLOOR_OFFSET_Y, rawPos.z);

        if (floorTexture) {
          ensureFloorChunkAt(new THREE.Vector3(rawPos.x, targetY, rawPos.z), floorTexture);
        }
      }
    } else {
      reticle.visible = false;
    }

    statusEl.textContent = `status: reticle=${reticle.visible ? 'visible' : 'searching'} | tiles=${floorChunks.size} | Y=${masterGroundY ? masterGroundY.toFixed(2) : 'detecting'}`;
  }
  renderer.render(scene, camera);
}