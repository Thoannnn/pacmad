import * as THREE from "three";

(() => {
  "use strict";

  const COLS = 28;
  const ROWS = 31;
  const WALL_H = 0.38; // low walls — pellets float clearly above
  const PELLET_Y = 0.62; // mid-air above walls, readable from far
  const POWER_Y = 0.7;
  const CAM_HEIGHT = 14;
  const CAM_DIST = 20;

  const DIRS = {
    NONE: { x: 0, y: 0, name: "none" },
    LEFT: { x: -1, y: 0, name: "left" },
    RIGHT: { x: 1, y: 0, name: "right" },
    UP: { x: 0, y: -1, name: "up" },
    DOWN: { x: 0, y: 1, name: "down" },
  };

  const OPPOSITE = {
    left: "right",
    right: "left",
    up: "down",
    down: "up",
    none: "none",
  };

  const MAZE_TEMPLATE = [
    "1111111111111111111111111111",
    "1222222222222112222222222221",
    "1211112111112112111112111121",
    "1311112111112112111112111131",
    "1211112111112112111112111121",
    "1222222222222222222222222221",
    "1211112112111111112112111121",
    "1211112112111111112112111121",
    "1222222112222112222112222221",
    "1111112111110110111112111111",
    "0000012111110110111112100000",
    "0000012110000000000112100000",
    "0000012110111441110112100000",
    "1111112110100000010112111111",
    "5555552000100000010002555555",
    "1111112110100000010112111111",
    "0000012110111111110112100000",
    "0000012110000000000112100000",
    "0000012110111111110112100000",
    "1111112110111111110112111111",
    "1222222222222112222222222221",
    "1211112111112112111112111121",
    "1211112111112112111112111121",
    "1322112222222002222222112231",
    "1112112112111111112112112111",
    "1112112112111111112112112111",
    "1222222112222112222112222221",
    "1211111111112112111111111121",
    "1211111111112112111111111121",
    "1222222222222222222222222221",
    "1111111111111111111111111111",
  ];

  const PAC_START = { x: 14.5, y: 23.5 };
  const GHOST_DEFS = [
    { name: "blinky", color: "#ff0000", start: { x: 14.5, y: 11.5 }, scatter: { x: 25, y: 0 }, release: 0 },
    { name: "pinky", color: "#ffb8ff", start: { x: 14.5, y: 14.5 }, scatter: { x: 2, y: 0 }, release: 1 },
    { name: "inky", color: "#00ffff", start: { x: 12.5, y: 14.5 }, scatter: { x: 27, y: 30 }, release: 5 },
    { name: "clyde", color: "#ffb852", start: { x: 16.5, y: 14.5 }, scatter: { x: 0, y: 30 }, release: 9 },
  ];

  const MODE_SCHEDULE = [
    { mode: "scatter", duration: 7 },
    { mode: "chase", duration: 20 },
    { mode: "scatter", duration: 7 },
    { mode: "chase", duration: 20 },
    { mode: "scatter", duration: 5 },
    { mode: "chase", duration: 20 },
    { mode: "scatter", duration: 5 },
    { mode: "chase", duration: Infinity },
  ];

  const stage = document.getElementById("stage");
  const scoreEl = document.getElementById("score");
  const highEl = document.getElementById("high-score");
  const livesEl = document.getElementById("lives");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const jumpBtn = document.getElementById("jump-btn");

  const JUMP_DURATION = 0.7;
  const JUMP_HEIGHT = 1.35;

  let maze = [];
  let pelletCount = 0;
  let score = 0;
  let highScore = Number(localStorage.getItem("pacman-high") || 0);
  let lives = 3;
  let level = 1;
  let state = "ready";
  let frightenedTimer = 0;
  let frightenedPoints = 200;
  let modeIndex = 0;
  let modeTimer = 0;
  let globalMode = "scatter";
  let releaseTimer = 0;
  let dyingTimer = 0;
  let flashTimer = 0;
  let mouthPhase = 0;
  let lastTs = 0;
  let audioCtx = null;
  let jumpTimer = 0; // >0 while airborne

  const input = { queue: null, held: null };
  let touchStart = null;
  let lastTapTime = 0;
  let lastTapPos = null;
  const DOUBLE_TAP_MS = 320;
  const TAP_MOVE_MAX = 18;

  const pacman = {
    x: PAC_START.x,
    y: PAC_START.y,
    dir: DIRS.LEFT,
    next: DIRS.LEFT,
    speed: 3.6,
  };

  const ghosts = GHOST_DEFS.map((def) => ({
    ...def,
    x: def.start.x,
    y: def.start.y,
    dir: DIRS.LEFT,
    mode: "house",
    speed: 3.2,
    eaten: false,
    decided: false,
  }));

  // ——— Three.js scene ———
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030312);
  scene.fog = new THREE.FogExp2(0x030312, 0.012);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.insertBefore(renderer.domElement, overlay);

  const hemi = new THREE.HemisphereLight(0x8899ff, 0x111122, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(8, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x334466, 0.35));

  const board = new THREE.Group();
  scene.add(board);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x2424e0,
    roughness: 0.45,
    metalness: 0.15,
    emissive: 0x0a0a55,
    emissiveIntensity: 0.25,
  });
  const wallTopMat = new THREE.MeshStandardMaterial({
    color: 0x4a4aff,
    roughness: 0.35,
    metalness: 0.2,
    emissive: 0x1111aa,
    emissiveIntensity: 0.35,
  });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x070714, roughness: 0.9, metalness: 0.05 });
  const floorAltMat = new THREE.MeshStandardMaterial({ color: 0x0b0b1c, roughness: 0.9, metalness: 0.05 });
  const pelletMat = new THREE.MeshStandardMaterial({
    color: 0xffcc99,
    emissive: 0xff9933,
    emissiveIntensity: 1.35,
    roughness: 0.25,
  });
  const powerMat = new THREE.MeshStandardMaterial({
    color: 0xffe0c0,
    emissive: 0xff7722,
    emissiveIntensity: 1.6,
    roughness: 0.2,
  });
  const gateMat = new THREE.MeshStandardMaterial({
    color: 0xffb8ff,
    emissive: 0xff66ff,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.85,
  });

  const pelletMeshes = new Map(); // "x,y" -> mesh
  let mazeRoot = null;
  let pacMesh = null;
  let pacMouth = null;
  const ghostMeshes = [];

  const camTarget = new THREE.Vector3(COLS / 2, 0, ROWS / 2);
  const camPos = new THREE.Vector3();

  function worldX(tx) {
    return tx - COLS / 2;
  }
  function worldZ(ty) {
    return ty - ROWS / 2;
  }

  function resize() {
    const w = Math.max(1, stage.clientWidth || window.innerWidth || 800);
    const h = Math.max(1, stage.clientHeight || window.innerHeight || 500);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function clearMazeMeshes() {
    if (mazeRoot) {
      board.remove(mazeRoot);
      mazeRoot.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
      });
      mazeRoot = null;
    }
    pelletMeshes.clear();
  }

  function buildMazeMeshes() {
    clearMazeMeshes();
    mazeRoot = new THREE.Group();

    const floorGeo = new THREE.BoxGeometry(1, 0.08, 1);
    const wallGeo = new THREE.BoxGeometry(0.92, WALL_H, 0.92);
    const topGeo = new THREE.BoxGeometry(0.96, 0.04, 0.96);
    const pelletGeo = new THREE.SphereGeometry(0.14, 12, 10);
    const powerGeo = new THREE.SphereGeometry(0.26, 14, 12);
    const gateGeo = new THREE.BoxGeometry(0.9, 0.06, 0.12);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = maze[y][x];
        const wx = worldX(x + 0.5);
        const wz = worldZ(y + 0.5);

        if (t !== 1) {
          const floor = new THREE.Mesh(floorGeo, (x + y) % 2 === 0 ? floorMat : floorAltMat);
          floor.position.set(wx, -0.04, wz);
          floor.receiveShadow = true;
          mazeRoot.add(floor);
        }

        if (t === 1) {
          const wall = new THREE.Mesh(wallGeo, wallMat);
          wall.position.set(wx, WALL_H / 2, wz);
          wall.castShadow = true;
          wall.receiveShadow = true;
          mazeRoot.add(wall);
          const top = new THREE.Mesh(topGeo, wallTopMat);
          top.position.set(wx, WALL_H + 0.02, wz);
          mazeRoot.add(top);
        } else if (t === 2 || t === 3) {
          const power = t === 3;
          const mesh = new THREE.Mesh(power ? powerGeo : pelletGeo, power ? powerMat : pelletMat);
          const py = power ? POWER_Y : PELLET_Y;
          mesh.position.set(wx, py, wz);
          mesh.castShadow = true;
          mesh.userData = { x, y, power };
          mazeRoot.add(mesh);
          pelletMeshes.set(`${x},${y}`, mesh);

          // Stem + floor mark so height reads from far away
          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(power ? 0.03 : 0.02, power ? 0.03 : 0.02, py, 6),
            new THREE.MeshBasicMaterial({ color: 0x664422, transparent: true, opacity: 0.45 })
          );
          stem.position.set(wx, py / 2, wz);
          stem.userData.stemFor = `${x},${y}`;
          mazeRoot.add(stem);
          mesh.userData.stem = stem;

          const mark = new THREE.Mesh(
            new THREE.CircleGeometry(power ? 0.16 : 0.1, 10),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
          );
          mark.rotation.x = -Math.PI / 2;
          mark.position.set(wx, 0.01, wz);
          mark.userData.markFor = `${x},${y}`;
          mazeRoot.add(mark);
          mesh.userData.mark = mark;
        } else if (t === 4) {
          const gate = new THREE.Mesh(gateGeo, gateMat);
          gate.position.set(wx, 0.12, wz);
          mazeRoot.add(gate);
        }
      }
    }

    // Outer rim base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(COLS + 1.2, 0.2, ROWS + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x050520, roughness: 0.85 })
    );
    base.position.set(0, -0.18, 0);
    base.receiveShadow = true;
    mazeRoot.add(base);

    board.add(mazeRoot);
  }

  function makePacmanMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 24, 18),
      new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: 0xaa7700,
        emissiveIntensity: 0.35,
        roughness: 0.4,
      })
    );
    body.castShadow = true;
    g.add(body);

    // Mouth dark wedge (rotates with facing)
    const mouth = new THREE.Mesh(
      new THREE.SphereGeometry(0.39, 16, 12, 0, Math.PI * 2, 0, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    mouth.scale.set(1, 1, 0.55);
    mouth.rotation.x = Math.PI / 2;
    mouth.position.set(0.05, 0, 0);
    g.add(mouth);
    pacMouth = mouth;

    g.position.y = 0.38;
    return g;
  }

  function makeGhostMesh(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.22, 6, 12),
      new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color).multiplyScalar(0.15),
        roughness: 0.45,
      })
    );
    body.position.y = 0.12;
    body.castShadow = true;
    g.add(body);

    const eyeGeo = new THREE.SphereGeometry(0.09, 10, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x2121ff });
    [-0.12, 0.12].forEach((ox) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ox, 0.28, 0.22);
      g.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), pupilMat);
      pupil.position.set(ox, 0.28, 0.3);
      pupil.name = "pupil";
      g.add(pupil);
    });

    g.userData.body = body;
    g.userData.baseColor = color;
    g.position.y = 0.35;
    return g;
  }

  function initActors3D() {
    if (pacMesh) board.remove(pacMesh);
    ghostMeshes.forEach((m) => board.remove(m));
    ghostMeshes.length = 0;

    pacMesh = makePacmanMesh();
    board.add(pacMesh);

    ghosts.forEach((g) => {
      const mesh = makeGhostMesh(g.color);
      ghostMeshes.push(mesh);
      board.add(mesh);
    });
  }

  function syncActors3D() {
    if (!pacMesh) return;

    pacMesh.position.x = worldX(pacman.x);
    pacMesh.position.z = worldZ(pacman.y);
    const baseY = 0.38;
    if (state === "dying") {
      pacMesh.position.y = baseY * Math.max(0, dyingTimer / 1.4);
    } else {
      pacMesh.position.y = baseY + jumpHeight();
    }
    // Squash/stretch while jumping
    if (jumpTimer > 0 && state !== "dying") {
      const h = jumpHeight() / JUMP_HEIGHT;
      pacMesh.scale.set(1 - h * 0.12, 1 + h * 0.35, 1 - h * 0.12);
    } else {
      pacMesh.scale.set(1, 1, 1);
    }

    const yaw = {
      right: Math.PI / 2,
      left: -Math.PI / 2,
      up: Math.PI,
      down: 0,
      none: 0,
    }[pacman.dir.name];
    pacMesh.rotation.y = yaw;

    if (pacMouth) {
      const open = 0.25 + Math.abs(Math.sin(mouthPhase)) * 0.45;
      pacMouth.scale.z = 0.25 + open;
      pacMouth.visible = state !== "dying";
    }
    pacMesh.visible = true;

    ghosts.forEach((g, i) => {
      const mesh = ghostMeshes[i];
      if (!mesh) return;
      mesh.position.x = worldX(g.x);
      mesh.position.z = worldZ(g.y);
      mesh.position.y = 0.35 + Math.sin(flashTimer * 6 + i) * 0.03;

      const gyaw = {
        right: Math.PI / 2,
        left: -Math.PI / 2,
        up: Math.PI,
        down: 0,
        none: 0,
      }[g.dir.name];
      mesh.rotation.y = gyaw;

      const body = mesh.userData.body;
      const flashing = g.mode === "frightened" && frightenedTimer < 3.5 && Math.floor(flashTimer * 10) % 2 === 0;

      if (g.eaten) {
        body.visible = false;
        mesh.children.forEach((c) => {
          if (c !== body) c.visible = true;
        });
      } else {
        body.visible = true;
        if (g.mode === "frightened") {
          body.material.color.set(flashing ? 0xffffff : 0x2121de);
          body.material.emissive.set(flashing ? 0x444444 : 0x111166);
        } else {
          body.material.color.set(mesh.userData.baseColor);
          body.material.emissive.set(new THREE.Color(mesh.userData.baseColor).multiplyScalar(0.15));
        }
      }

      mesh.visible = state !== "dying";
    });

    // Pulse power pellets
    pelletMeshes.forEach((mesh) => {
      if (!mesh.visible || !mesh.userData.power) return;
      const s = 1 + Math.sin(flashTimer * 8) * 0.18;
      mesh.scale.setScalar(s);
    });
  }

  function updateCamera(dt) {
    const focusX = worldX(pacman.x);
    const focusZ = worldZ(pacman.y);
    camTarget.lerp(new THREE.Vector3(focusX, 0.2, focusZ), 1 - Math.pow(0.001, dt));

    // Pulled-back overview chase cam — more of the maze in frame
    const desired = new THREE.Vector3(
      focusX - pacman.dir.x * 2 - 4,
      CAM_HEIGHT,
      focusZ - pacman.dir.y * 2 + CAM_DIST
    );
    desired.x = THREE.MathUtils.lerp(desired.x, focusX - 5, 0.45);
    desired.z = THREE.MathUtils.lerp(desired.z, focusZ + 16, 0.45);

    camPos.lerp(desired, 1 - Math.pow(0.03, dt));
    camera.position.copy(camPos);
    camera.lookAt(camTarget.x, 0.4, camTarget.z);
  }

  function hidePelletAt(x, y) {
    const mesh = pelletMeshes.get(`${x},${y}`);
    if (!mesh) return;
    mesh.visible = false;
    if (mesh.userData.stem) mesh.userData.stem.visible = false;
    if (mesh.userData.mark) mesh.userData.mark.visible = false;
  }

  function refreshPelletVisibility() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const mesh = pelletMeshes.get(`${x},${y}`);
        if (!mesh) continue;
        const on = maze[y][x] === 2 || maze[y][x] === 3;
        mesh.visible = on;
        if (mesh.userData.stem) mesh.userData.stem.visible = on;
        if (mesh.userData.mark) mesh.userData.mark.visible = on;
      }
    }
  }

  // ——— Game logic ———
  function cloneMaze() {
    maze = MAZE_TEMPLATE.map((row) => row.split("").map(Number));
    pelletCount = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (maze[y][x] === 2 || maze[y][x] === 3) pelletCount++;
      }
    }
  }

  function tileAt(tx, ty) {
    if (ty < 0 || ty >= ROWS) return 1;
    if (tx < 0 || tx >= COLS) return 5;
    return maze[ty][tx];
  }

  function isWall(tx, ty, allowGate = false) {
    const t = tileAt(tx, ty);
    if (t === 1) return true;
    if (t === 4 && !allowGate) return true;
    return false;
  }

  function wrapX(x) {
    if (x < -0.5) return COLS - 0.5;
    if (x > COLS - 0.5) return -0.5;
    return x;
  }

  function tileCenter(v) {
    return Math.floor(v) + 0.5;
  }

  function nearCenter(actor, epsilon = 0.25) {
    return (
      Math.abs(actor.x - tileCenter(actor.x)) <= epsilon &&
      Math.abs(actor.y - tileCenter(actor.y)) <= epsilon
    );
  }

  function snapToCenter(actor) {
    actor.x = tileCenter(actor.x);
    actor.y = tileCenter(actor.y);
  }

  function lockToLane(actor) {
    if (actor.dir.x !== 0) actor.y = tileCenter(actor.y);
    if (actor.dir.y !== 0) actor.x = tileCenter(actor.x);
  }

  function canMove(actor, dir, asGhost = false) {
    if (!dir || dir.name === "none") return false;
    const allowGate =
      asGhost && (actor.mode === "house" || actor.mode === "leaving" || actor.eaten);
    const tx = Math.floor(actor.x + dir.x * 0.6);
    const ty = Math.floor(actor.y + dir.y * 0.6);
    return !isWall(tx, ty, allowGate);
  }

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep(freq, duration = 0.08, type = "square", gain = 0.03) {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {
      /* ignore */
    }
  }

  function formatScore(n) {
    return String(n).padStart(2, "0");
  }

  function updateJumpHud() {
    if (jumpBtn) jumpBtn.classList.toggle("armed", jumpTimer <= 0 && state === "playing");
  }

  function jumpHeight() {
    if (jumpTimer <= 0) return 0;
    const t = 1 - jumpTimer / JUMP_DURATION;
    return Math.sin(t * Math.PI) * JUMP_HEIGHT;
  }

  function isAirborne() {
    return jumpTimer > 0;
  }

  function tryJump() {
    if (state !== "playing") return false;
    if (jumpTimer > 0) return false;
    jumpTimer = JUMP_DURATION;
    beep(520, 0.08, "square", 0.035);
    beep(780, 0.1, "triangle", 0.03);
    updateJumpHud();
    return true;
  }

  function updateHud() {
    scoreEl.textContent = formatScore(score);
    highEl.textContent = formatScore(highScore);
    livesEl.innerHTML = "";
    for (let i = 0; i < Math.max(0, lives - (state === "dying" ? 1 : 0)); i++) {
      const d = document.createElement("div");
      d.className = "life";
      livesEl.appendChild(d);
    }
  }

  function showOverlay(title, sub, titleClass = "") {
    overlay.classList.remove("hidden");
    overlayTitle.textContent = title;
    overlayTitle.className = `overlay-title ${titleClass}`.trim();
    overlaySub.textContent = sub;
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function setHighScore() {
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("pacman-high", String(highScore));
    }
  }

  function resetActors() {
    pacman.x = PAC_START.x;
    pacman.y = PAC_START.y;
    pacman.dir = DIRS.LEFT;
    pacman.next = DIRS.LEFT;
    input.queue = null;
    input.held = null;

    ghosts.forEach((g, i) => {
      g.x = GHOST_DEFS[i].start.x;
      g.y = GHOST_DEFS[i].start.y;
      g.dir = i === 0 ? DIRS.LEFT : DIRS.UP;
      g.mode = i === 0 ? globalMode : "house";
      g.eaten = false;
      g.decided = false;
      g.speed = 3.2 + Math.min(level - 1, 4) * 0.075;
    });

    releaseTimer = 0;
    frightenedTimer = 0;
    frightenedPoints = 200;
    dyingTimer = 0;
    jumpTimer = 0;
    updateJumpHud();
  }

  function startLevel(resetScore = false) {
    cloneMaze();
    if (resetScore) {
      score = 0;
      lives = 3;
      level = 1;
    }
    modeIndex = 0;
    modeTimer = MODE_SCHEDULE[0].duration;
    globalMode = MODE_SCHEDULE[0].mode;
    pacman.speed = 3.6 + Math.min(level - 1, 4) * 0.06;
    resetActors();
    buildMazeMeshes();
    initActors3D();
    refreshPelletVisibility();
    state = "ready";
    showOverlay("READY!", "Press Enter or Tap to Start", "ready");
    updateHud();

    camPos.set(worldX(pacman.x) - 5, CAM_HEIGHT, worldZ(pacman.y) + CAM_DIST);
    camTarget.set(worldX(pacman.x), 0.2, worldZ(pacman.y));
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  function beginPlay() {
    ensureAudio();
    state = "playing";
    hideOverlay();
    beep(440, 0.1);
  }

  function nextMode() {
    if (frightenedTimer > 0) return;
    modeIndex = Math.min(modeIndex + 1, MODE_SCHEDULE.length - 1);
    const next = MODE_SCHEDULE[modeIndex];
    globalMode = next.mode;
    modeTimer = next.duration;
    ghosts.forEach((g) => {
      if (g.mode === "scatter" || g.mode === "chase") {
        g.mode = globalMode;
        reverseDir(g);
      }
    });
  }

  function reverseDir(actor) {
    const opp = DIRS[OPPOSITE[actor.dir.name].toUpperCase()] || DIRS.LEFT;
    if (canMove(actor, opp, true)) actor.dir = opp;
  }

  function activateFrightened() {
    frightenedTimer = Math.max(14 - level * 0.6, 9);
    frightenedPoints = 200;
    ghosts.forEach((g) => {
      if (g.mode !== "house" && g.mode !== "leaving" && !g.eaten) {
        g.mode = "frightened";
        reverseDir(g);
      }
    });
    beep(220, 0.15, "triangle", 0.04);
  }

  function ghostTarget(g) {
    if (g.eaten) return { x: 14.5, y: 14.5 };
    if (g.mode === "house" || g.mode === "leaving") return { x: 14.5, y: 11.5 };
    if (g.mode === "frightened") {
      return { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    }
    if (g.mode === "scatter") return g.scatter;

    const px = pacman.x;
    const py = pacman.y;
    const pd = pacman.dir;

    switch (g.name) {
      case "blinky":
        return { x: px, y: py };
      case "pinky":
        return { x: px + pd.x * 4, y: py + pd.y * 4 };
      case "inky": {
        const blinky = ghosts[0];
        const ax = px + pd.x * 2;
        const ay = py + pd.y * 2;
        return { x: ax * 2 - blinky.x, y: ay * 2 - blinky.y };
      }
      case "clyde": {
        const dist = Math.hypot(g.x - px, g.y - py);
        return dist > 8 ? { x: px, y: py } : g.scatter;
      }
      default:
        return { x: px, y: py };
    }
  }

  function chooseGhostDir(g) {
    if (!nearCenter(g, 0.18)) {
      g.decided = false;
      return;
    }
    if (g.decided) return;

    snapToCenter(g);
    g.decided = true;

    if (g.mode === "house") {
      const up = canMove(g, DIRS.UP, true);
      const down = canMove(g, DIRS.DOWN, true);
      if (g.dir.name === "up" && !up && down) g.dir = DIRS.DOWN;
      else if (g.dir.name === "down" && !down && up) g.dir = DIRS.UP;
      else if (!up && down) g.dir = DIRS.DOWN;
      else if (up && !down) g.dir = DIRS.UP;
      else if (g.dir.name !== "up" && g.dir.name !== "down") g.dir = up ? DIRS.UP : DIRS.DOWN;
      return;
    }

    if (g.mode === "leaving") {
      if (Math.abs(g.x - 14.5) > 0.05) {
        g.dir = g.x < 14.5 ? DIRS.RIGHT : DIRS.LEFT;
        return;
      }
      g.x = 14.5;
      if (g.y > 11.5 + 0.05) {
        g.dir = DIRS.UP;
        return;
      }
      g.y = 11.5;
      g.mode = frightenedTimer > 0 ? "frightened" : globalMode;
      g.dir = Math.random() < 0.5 ? DIRS.LEFT : DIRS.RIGHT;
      g.decided = false;
      return;
    }

    if (g.eaten && Math.abs(g.x - 14.5) < 0.4 && Math.abs(g.y - 14.5) < 0.4) {
      g.eaten = false;
      g.mode = "leaving";
      g.decided = false;
      return;
    }

    const target = ghostTarget(g);
    const options = [DIRS.UP, DIRS.LEFT, DIRS.DOWN, DIRS.RIGHT].filter((d) => {
      if (d.name === OPPOSITE[g.dir.name]) return false;
      return canMove(g, d, true);
    });

    if (!options.length) {
      const back = DIRS[OPPOSITE[g.dir.name].toUpperCase()];
      if (back && canMove(g, back, true)) g.dir = back;
      return;
    }

    if (g.mode === "frightened" && !g.eaten) {
      g.dir = options[Math.floor(Math.random() * options.length)];
      return;
    }

    let best = options[0];
    let bestDist = Infinity;
    for (const d of options) {
      const nx = g.x + d.x;
      const ny = g.y + d.y;
      const dist = (nx - target.x) ** 2 + (ny - target.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    g.dir = best;
  }

  function moveActor(actor, dt, asGhost = false) {
    const speed =
      actor.speed *
      (asGhost && actor.mode === "frightened" && !actor.eaten ? 0.55 : 1) *
      (asGhost && actor.eaten ? 1.8 : 1);

    let remaining = speed * dt;
    let guard = 0;

    while (remaining > 0 && guard++ < 32) {
      if (asGhost) chooseGhostDir(actor);
      else tryTurnPacman();

      lockToLane(actor);

      const step = Math.min(remaining, 0.1);
      if (!canMove(actor, actor.dir, asGhost)) {
        snapToCenter(actor);
        if (asGhost) {
          actor.decided = false;
          chooseGhostDir(actor);
        } else {
          tryTurnPacman();
        }
        if (!canMove(actor, actor.dir, asGhost)) break;
      }

      actor.x = wrapX(actor.x + actor.dir.x * step);
      actor.y += actor.dir.y * step;
      remaining -= step;
    }
  }

  function tryTurnPacman() {
    const want = input.queue || input.held || pacman.next;
    if (!want || want.name === "none") return;

    if (want.name === pacman.dir.name) {
      pacman.next = want;
      input.queue = null;
      return;
    }

    if (want.name === OPPOSITE[pacman.dir.name]) {
      pacman.dir = want;
      pacman.next = want;
      input.queue = null;
      return;
    }

    pacman.next = want;

    if (nearCenter(pacman, 0.35) && canMove(pacman, want, false)) {
      snapToCenter(pacman);
      pacman.dir = want;
      input.queue = null;
    }
  }

  function eatAtPacman() {
    const tx = Math.floor(pacman.x);
    const ty = Math.floor(pacman.y);
    const cell = tileAt(tx, ty);
    if (cell !== 2 && cell !== 3) return;

    maze[ty][tx] = 0;
    pelletCount--;
    hidePelletAt(tx, ty);
    if (cell === 2) {
      score += 10;
      beep(660, 0.04, "square", 0.02);
    } else {
      score += 50;
      activateFrightened();
    }
    setHighScore();
    updateHud();
    if (pelletCount <= 0) {
      state = "won";
      showOverlay("YOU WIN!", "Enter / Tap for next level", "win");
      beep(880, 0.2, "triangle", 0.05);
    }
  }

  function collideGhosts() {
    for (const g of ghosts) {
      const dist = Math.hypot(g.x - pacman.x, g.y - pacman.y);
      if (dist >= 0.7) continue;
      if (g.eaten) continue;

      // Jumping over ghosts — clear them without dying
      if (isAirborne()) {
        if (g.mode === "frightened") {
          g.eaten = true;
          score += frightenedPoints;
          frightenedPoints *= 2;
          setHighScore();
          updateHud();
          beep(520, 0.12, "sawtooth", 0.04);
        }
        continue;
      }

      if (g.mode === "frightened") {
        g.eaten = true;
        score += frightenedPoints;
        frightenedPoints *= 2;
        setHighScore();
        updateHud();
        beep(520, 0.12, "sawtooth", 0.04);
        continue;
      }

      state = "dying";
      dyingTimer = 1.4;
      jumpTimer = 0;
      lives -= 1;
      updateHud();
      beep(120, 0.35, "sawtooth", 0.05);
      return;
    }
  }

  function releaseGhosts(dt) {
    releaseTimer += dt;
    ghosts.forEach((g) => {
      if (g.mode === "house" && releaseTimer >= g.release) g.mode = "leaving";
    });
  }

  function update(dt) {
    if (state === "dying") {
      dyingTimer -= dt;
      if (dyingTimer <= 0) {
        if (lives <= 0) {
          state = "gameover";
          showOverlay("GAME OVER", "Enter / Tap to play again", "game-over");
        } else {
          resetActors();
          state = "ready";
          showOverlay("READY!", "Press Enter or Tap to continue", "ready");
        }
      }
      return;
    }

    if (state !== "playing") return;

    flashTimer += dt;
    mouthPhase += dt * 10;

    // Airborne timer — jump is always available on landing
    if (jumpTimer > 0) {
      jumpTimer -= dt;
      if (jumpTimer < 0) jumpTimer = 0;
      updateJumpHud();
    }

    if (frightenedTimer > 0) {
      frightenedTimer -= dt;
      if (frightenedTimer <= 0) {
        frightenedTimer = 0;
        ghosts.forEach((g) => {
          if (g.mode === "frightened") g.mode = globalMode;
        });
      }
    } else {
      modeTimer -= dt;
      if (modeTimer <= 0) nextMode();
    }

    releaseGhosts(dt);
    moveActor(pacman, dt, false);
    eatAtPacman();
    if (state !== "playing") return;

    ghosts.forEach((g) => moveActor(g, dt, true));
    collideGhosts();
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (state === "ready" || state === "paused" || state === "won" || state === "gameover") {
      flashTimer += dt;
    }
    update(dt);
    syncActors3D();
    updateCamera(dt || 0.016);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  function dirFromKey(key) {
    switch (key) {
      case "ArrowLeft":
      case "a":
      case "A":
        return DIRS.LEFT;
      case "ArrowRight":
      case "d":
      case "D":
        return DIRS.RIGHT;
      case "ArrowUp":
      case "w":
      case "W":
        return DIRS.UP;
      case "ArrowDown":
      case "s":
      case "S":
        return DIRS.DOWN;
      default:
        return null;
    }
  }

  function onStartAction() {
    if (state === "ready") beginPlay();
    else if (state === "gameover") startLevel(true);
    else if (state === "won") {
      level += 1;
      startLevel(false);
    }
  }

  window.addEventListener("keydown", (e) => {
    const dir = dirFromKey(e.key);
    if (dir) {
      e.preventDefault();
      input.queue = dir;
      input.held = dir;
      if (state === "ready") onStartAction();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      onStartAction();
    } else if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      e.preventDefault();
      if (state === "playing") {
        state = "paused";
        showOverlay("PAUSED", "Shift to resume", "");
      } else if (state === "paused") {
        state = "playing";
        hideOverlay();
      } else onStartAction();
    } else if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (e.repeat) return;
      tryJump();
    } else if (e.key === "Escape") {
      startLevel(true);
    }
  });

  window.addEventListener("keyup", (e) => {
    const dir = dirFromKey(e.key);
    if (dir && input.held && input.held.name === dir.name) input.held = null;
  });

  stage.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
      if (state === "ready" || state === "gameover" || state === "won") onStartAction();
    },
    { passive: true }
  );

  stage.addEventListener(
    "touchend",
    (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const dist = Math.hypot(dx, dy);
      const now = performance.now();
      touchStart = null;

      // Swipe → move
      if (dist >= TAP_MOVE_MAX) {
        lastTapTime = 0;
        lastTapPos = null;
        const dir =
          Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? DIRS.RIGHT
              : DIRS.LEFT
            : dy > 0
              ? DIRS.DOWN
              : DIRS.UP;
        input.queue = dir;
        pacman.next = dir;
        return;
      }

      // Tap → double-tap jump
      if (state === "playing") {
        const nearLast =
          lastTapPos &&
          Math.hypot(t.clientX - lastTapPos.x, t.clientY - lastTapPos.y) < 56;
        if (nearLast && now - lastTapTime <= DOUBLE_TAP_MS) {
          lastTapTime = 0;
          lastTapPos = null;
          tryJump();
          return;
        }
        lastTapTime = now;
        lastTapPos = { x: t.clientX, y: t.clientY };
      }
    },
    { passive: true }
  );

  overlay.addEventListener("click", onStartAction);
  stage.addEventListener("click", () => {
    if (state === "ready" || state === "gameover" || state === "won") onStartAction();
  });

  if (jumpBtn) {
    jumpBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      tryJump();
    });
  }

  window.addEventListener("resize", resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(stage);
  }

  highEl.textContent = formatScore(highScore);
  updateJumpHud();
  resize();
  startLevel(true);
  requestAnimationFrame((ts) => {
    lastTs = ts;
    requestAnimationFrame(loop);
  });
})();
