import * as THREE from "three";

(() => {
  "use strict";

  const COLS = 28;
  const ROWS = 31;
  const WALL_H = 0.38; // standard block height
  const WALL_H_MAX = WALL_H * 2; // raised blocks (level 2+)
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
  const levelEl = document.getElementById("level");
  const livesEl = document.getElementById("lives");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const jumpBtn = document.getElementById("jump-btn");
  const levelBtn = document.getElementById("level-btn");
  const levelSelectEl = document.getElementById("level-select");
  const levelPickValEl = document.getElementById("level-pick-val");
  const nameEntryEl = document.getElementById("name-entry");
  const nameSlotsEl = document.getElementById("name-slots");
  const scoreboardEl = document.getElementById("scoreboard");

  const JUMP_DURATION = 0.7;
  const JUMP_HEIGHT = 1.35;
  const GHOST_PAUSE_DUR = 0.5;
  const GHOST_PAUSE_MIN = 5;
  const GHOST_PAUSE_MAX = 35; // mean ≈ 20s
  const HS_MAX = 10;
  const NAME_LEN = 7;
  const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ .";
  const HS_KEY = "pacmad-hiscores";
  const LEVEL_COOKIE = "pacmad-level";
  const LEVEL_SELECT_MAX = 99;

  function loadSavedLevel() {
    try {
      const m = document.cookie.match(/(?:^|; )pacmad-level=(\d+)/);
      if (m) return Math.max(1, parseInt(m[1], 10) || 1);
    } catch (_) {
      /* ignore */
    }
    const ls = Number(localStorage.getItem(LEVEL_COOKIE) || 0);
    return ls >= 1 ? Math.floor(ls) : 1;
  }

  function saveLevel() {
    const n = Math.max(1, Math.floor(level));
    try {
      document.cookie = `${LEVEL_COOKIE}=${n};path=/;max-age=31536000;SameSite=Lax`;
    } catch (_) {
      /* ignore */
    }
    localStorage.setItem(LEVEL_COOKIE, String(n));
  }

  let maze = [];
  let pelletCount = 0;
  let score = 0;
  let highScore = Number(localStorage.getItem("pacman-high") || 0);
  let hiscores = [];
  let levelPick = 1;
  let nameChars = Array(NAME_LEN).fill("A");
  let nameCursor = 0;
  let lastEnteredRank = -1;
  let lives = 3;
  let level = loadSavedLevel();
  let state = "ready";
  let frightenedTimer = 0;
  let frightenedMax = 14;
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
  let musicMaster = null;
  let rhythmGain = null;
  let musicMood = "ready";
  let musicStep = 0;
  let musicAcc = 0;
  let musicOneShot = null;
  let vlToneIndex = 3; // Flute — start here
  let vlPulseCache = new Map();
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

  function nextGhostPauseDelay() {
    return GHOST_PAUSE_MIN + Math.random() * (GHOST_PAUSE_MAX - GHOST_PAUSE_MIN);
  }

  const ghosts = GHOST_DEFS.map((def) => ({
    ...def,
    x: def.start.x,
    y: def.start.y,
    dir: DIRS.LEFT,
    mode: "house",
    speed: 3.2,
    eaten: false,
    decided: false,
    pauseTimer: 0,
    pauseNext: nextGhostPauseDelay(),
    winPopped: false,
    winPopAt: -1,
  }));

  // ——— Three.js scene ———
  const scene = new THREE.Scene();
  const DEFAULT_BG = 0x030312;
  scene.background = new THREE.Color(DEFAULT_BG);
  scene.fog = new THREE.FogExp2(DEFAULT_BG, 0.012);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
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

  const sceneColorTargets = [
    wallMat,
    wallTopMat,
    floorMat,
    floorAltMat,
    pelletMat,
    powerMat,
    gateMat,
  ];
  const sceneColorBackup = sceneColorTargets.map((m) => ({
    color: m.color.clone(),
    emissive: m.emissive ? m.emissive.clone() : null,
    emissiveIntensity: m.emissiveIntensity,
  }));
  const bgBackup = new THREE.Color(DEFAULT_BG);
  const fogBackup = { color: new THREE.Color(DEFAULT_BG), density: 0.012 };
  let tripShuffleTimer = 0;
  let tripActive = false;
  let arActive = false;
  const AR_SCALE = 0.028; // ~0.8m wide — fits a coffee table
  const CAM_NEAR_DEFAULT = 0.1;
  const CAM_NEAR_AR = 0.01;
  const boardHome = { pos: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1) };

  function randomHueColor(s = 0.75, l = 0.45) {
    return new THREE.Color().setHSL(Math.random(), s, l);
  }

  function applyTripColors() {
    tripActive = true;
    sceneColorTargets.forEach((m) => {
      m.color.copy(randomHueColor(0.85, 0.4 + Math.random() * 0.25));
      if (m.emissive) {
        m.emissive.copy(randomHueColor(0.9, 0.25));
        m.emissiveIntensity = 0.4 + Math.random() * 0.9;
      }
    });
    if (arActive) {
      scene.background = null;
      scene.fog = null;
    } else {
      if (!scene.background) scene.background = new THREE.Color();
      scene.background.copy(randomHueColor(0.7, 0.08));
      if (!scene.fog) scene.fog = new THREE.FogExp2(DEFAULT_BG, fogBackup.density);
      scene.fog.color.copy(scene.background);
    }
    hemi.color.copy(randomHueColor(0.6, 0.55));
    hemi.groundColor.copy(randomHueColor(0.5, 0.2));
    sun.color.copy(randomHueColor(0.4, 0.85));
    if (pacMesh?.userData?.bodyMat) {
      pacMesh.userData.bodyMat.color.copy(randomHueColor(0.9, 0.55));
      pacMesh.userData.bodyMat.emissive.copy(randomHueColor(0.8, 0.3));
    }
    ghostMeshes.forEach((mesh) => {
      const body = mesh.userData.body;
      if (!body) return;
      body.material.color.copy(randomHueColor(0.9, 0.5));
      body.material.emissive.copy(randomHueColor(0.7, 0.25));
    });
  }

  function restoreSceneColors() {
    tripActive = false;
    tripShuffleTimer = 0;
    sceneColorTargets.forEach((m, i) => {
      const b = sceneColorBackup[i];
      m.color.copy(b.color);
      if (m.emissive && b.emissive) {
        m.emissive.copy(b.emissive);
        m.emissiveIntensity = b.emissiveIntensity;
      }
    });
    if (arActive) {
      scene.background = null;
      scene.fog = null;
    } else {
      scene.background = scene.background || new THREE.Color();
      scene.background.copy(bgBackup);
      if (!scene.fog) scene.fog = new THREE.FogExp2(fogBackup.color, fogBackup.density);
      scene.fog.color.copy(fogBackup.color);
      scene.fog.density = fogBackup.density;
    }
    hemi.color.set(0x8899ff);
    hemi.groundColor.set(0x111122);
    sun.color.set(0xffffff);
    if (pacMesh?.userData?.bodyMat) {
      pacMesh.userData.bodyMat.color.set(0xffd700);
      pacMesh.userData.bodyMat.emissive.set(0xaa7700);
      pacMesh.userData.bodyMat.emissiveIntensity = 0.35;
    }
    ghostMeshes.forEach((mesh, i) => {
      const body = mesh.userData.body;
      if (!body) return;
      const base = mesh.userData.baseColor ?? ghosts[i]?.color ?? 0xff0000;
      body.material.color.set(base);
      body.material.emissive.set(new THREE.Color(base).multiplyScalar(0.15));
    });
  }

  const pelletMeshes = new Map(); // "x,y" -> mesh
  let mazeRoot = null;
  let pacMesh = null;
  let pacMouth = null;
  let pacLimbs = null;
  let pacEyes = null;
  let pacBody = null;
  let pacUpper = null;
  let pacLower = null;
  let lastMouthGap = -1;
  const ghostMeshes = [];

  // Level-clear celebration FX
  let fxRoot = null;
  const fxParticles = [];
  let winFxActive = false;
  let winFxT = 0;
  let winFireworkAcc = 0;
  let winOverlayAt = 0;
  const confettiGeo = new THREE.BoxGeometry(0.07, 0.11, 0.02);
  const sparkGeo = new THREE.SphereGeometry(0.055, 6, 4);
  const WIN_COLORS = [0xff3355, 0xffcc00, 0x33ff66, 0x3399ff, 0xff66ff, 0xffffff, 0xff8800, 0x66ffff];

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

  /** Stable 0..1 hash from cell + level */
  function cellRand(x, y, salt) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + level * 45.164 + salt * 19.19) * 43758.5453;
    return n - Math.floor(n);
  }

  /** Outer rim + ghost-house walls stay solid (no vanishing passages). */
  function canMutateWall(x, y) {
    if (x <= 0 || y <= 0 || x >= COLS - 1 || y >= ROWS - 1) return false;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const row = MAZE_TEMPLATE[y + dy];
      if (!row) continue;
      const ch = row[x + dx];
      if (ch === "4") return false;
    }
    // Only walls that already touch the playable circuit (no isolated holes)
    return touchesCircuit(x, y);
  }

  function isWalkableTemplate(x, y) {
    if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return false;
    const ch = MAZE_TEMPLATE[y][x];
    return ch === "0" || ch === "2" || ch === "3" || ch === "5";
  }

  function touchesCircuit(x, y) {
    return (
      isWalkableTemplate(x + 1, y) ||
      isWalkableTemplate(x - 1, y) ||
      isWalkableTemplate(x, y + 1) ||
      isWalkableTemplate(x, y - 1)
    );
  }

  /**
   * From level 2: ~1/4 of mutable walls randomly raise or lower by WALL_H.
   * Lowered to 0 → passage (handled in cloneMaze); raised → 2× height.
   */
  function wallHeightFor(x, y) {
    if (level <= 1 || !canMutateWall(x, y)) return WALL_H;
    if (cellRand(x, y, 1) >= 0.25) return WALL_H;
    return cellRand(x, y, 2) < 0.5 ? WALL_H_MAX : 0;
  }

  function buildMazeMeshes() {
    clearMazeMeshes();
    mazeRoot = new THREE.Group();

    const floorGeo = new THREE.BoxGeometry(1, 0.08, 1);
    const topGeo = new THREE.BoxGeometry(0.96, 0.04, 0.96);
    const pelletGeo = new THREE.SphereGeometry(0.14, 12, 10);
    const powerGeo = new THREE.SphereGeometry(0.26, 14, 12);
    const gateGeo = new THREE.BoxGeometry(0.9, 0.06, 0.12);
    const wallGeoCache = new Map(); // height key → geometry

    function wallGeoFor(h) {
      const key = h.toFixed(3);
      if (!wallGeoCache.has(key)) {
        wallGeoCache.set(key, new THREE.BoxGeometry(0.92, h, 0.92));
      }
      return wallGeoCache.get(key);
    }

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
          const h = Math.max(WALL_H, wallHeightFor(x, y));
          const wall = new THREE.Mesh(wallGeoFor(h), wallMat);
          wall.position.set(wx, h / 2, wz);
          wall.castShadow = true;
          wall.receiveShadow = true;
          mazeRoot.add(wall);
          const top = new THREE.Mesh(topGeo, wallTopMat);
          top.position.set(wx, h + 0.02, wz);
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
    // Local facing: +Z = forward
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xaa7700,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    });
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0xffc400,
      emissive: 0x996600,
      emissiveIntensity: 0.4,
      roughness: 0.45,
    });

    // Classic Pac-Man: upper + lower hemispheres open horizontally (rotate on X)
    const jawPivot = new THREE.Group();
    const upper = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      mat
    );
    upper.castShadow = true;
    const lower = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      mat
    );
    lower.castShadow = true;
    jawPivot.add(upper);
    jawPivot.add(lower);

    // Dark gullet + plug so legs never show through the open mouth
    const gulletMat = new THREE.MeshBasicMaterial({ color: 0x140600 });
    const gullet = new THREE.Mesh(new THREE.SphereGeometry(0.31, 24, 18), gulletMat);
    gullet.renderOrder = 1;
    jawPivot.add(gullet);
    const throat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.33, 0.33, 0.14, 28),
      gulletMat
    );
    throat.rotation.x = Math.PI / 2;
    throat.position.z = 0.05;
    throat.renderOrder = 2;
    jawPivot.add(throat);

    g.add(jawPivot);
    pacUpper = upper;
    pacLower = lower;
    pacBody = jawPivot;
    g.userData.bodyMat = mat;

    // Big eyes on the upper half — pupils track nearest ghost
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    pacEyes = [];
    [-1, 1].forEach((side) => {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), eyeWhiteMat);
      white.position.set(side * 0.15, 0.2, 0.2);
      white.castShadow = true;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), eyePupilMat);
      pupil.position.set(0, 0, 0.08);
      white.add(pupil);
      upper.add(white);
      pacEyes.push({ white, pupil, side });
    });

    pacMouth = jawPivot;

    // Arms — outside body on ±X
    function makeArm(side) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.34, 0.02, -0.08);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), limbMat);
      arm.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      arm.position.x = side * 0.14;
      arm.castShadow = true;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), limbMat);
      hand.position.set(side * 0.28, 0, 0.02);
      hand.castShadow = true;
      pivot.add(hand);
      g.add(pivot);
      return pivot;
    }

    // Legs far behind the body — outside mouth view (+Z)
    function makeLeg(side) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.1, -0.34, -0.32);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 8), limbMat);
      thigh.position.y = -0.1;
      thigh.castShadow = true;
      pivot.add(thigh);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), limbMat);
      foot.position.set(0, -0.22, -0.04);
      foot.castShadow = true;
      pivot.add(foot);
      g.add(pivot);
      return pivot;
    }

    pacLimbs = {
      leftArm: makeArm(-1),
      rightArm: makeArm(1),
      leftLeg: makeLeg(-1),
      rightLeg: makeLeg(1),
    };
    g.userData.limbs = pacLimbs;
    g.userData.eyes = pacEyes;
    g.position.y = 0.42;
    lastMouthGap = -1;
    return g;
  }

  function setPacMouthOpen(halfGap) {
    if (!pacUpper || !pacLower) return;
    const gap = THREE.MathUtils.clamp(halfGap, 0.08, 0.85);
    if (Math.abs(gap - lastMouthGap) < 0.02) return;
    lastMouthGap = gap;
    // Horizontal bite: jaws hinge on X so the opening faces +Z
    pacUpper.rotation.x = -gap;
    pacLower.rotation.x = gap;
  }

  function nearestGhost() {
    let best = null;
    let bestD = Infinity;
    for (const g of ghosts) {
      if (g.eaten) continue;
      const d = Math.hypot(g.x - pacman.x, g.y - pacman.y);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return best ? { ghost: best, dist: bestD } : null;
  }

  let eyeScaleSmooth = 1;

  function updatePacEyesLook() {
    const eyes = pacEyes || pacMesh?.userData?.eyes;
    if (!eyes || !pacMesh) return;
    const near = nearestGhost();
    let lookX = 0;
    let lookY = 0;
    let lookZ = 1;
    // Target scale: big when close, back to 1 when far / no ghost
    let eyeScaleTarget = 1;
    if (near) {
      const target = near.ghost;
      const dx = worldX(target.x) - pacMesh.position.x;
      const dy = 0.4 - pacMesh.position.y;
      const dz = worldZ(target.y) - pacMesh.position.z;
      const yaw = pacMesh.rotation.y;
      const lx = dx * Math.cos(yaw) + dz * Math.sin(yaw);
      const lz = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const len = Math.hypot(lx, dy, lz) || 1;
      lookX = THREE.MathUtils.clamp(lx / len, -1, 1);
      lookY = THREE.MathUtils.clamp(dy / len, -1, 1);
      lookZ = THREE.MathUtils.clamp(lz / len, -1, 1);
      // Full panic ~1.5 tiles; fully normal again by ~6 tiles
      const t = THREE.MathUtils.clamp(1 - (near.dist - 1.5) / 4.5, 0, 1);
      eyeScaleTarget = 1 + t * t * 1.35;
    }
    // Smooth shrink/grow so eyes clearly return to normal when ghosts leave
    eyeScaleSmooth += (eyeScaleTarget - eyeScaleSmooth) * 0.18;
    if (eyeScaleSmooth < 1.02 && eyeScaleTarget <= 1) eyeScaleSmooth = 1;
    eyes.forEach((e) => {
      e.white.scale.setScalar(eyeScaleSmooth);
      e.pupil.position.set(lookX * 0.05, lookY * 0.05, 0.08 + Math.max(0, lookZ) * 0.02);
    });
  }

  function makeGhostQuestionMark() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 64, 64);
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#111122";
    ctx.lineWidth = 5;
    ctx.strokeText("?", 32, 36);
    ctx.fillStyle = "#fff8e0";
    ctx.fillText("?", 32, 36);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true })
    );
    sprite.scale.set(0.28, 0.28, 0.28);
    sprite.position.set(0, 0.72, 0);
    sprite.visible = false;
    return sprite;
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

    const question = makeGhostQuestionMark();
    g.add(question);

    g.userData.body = body;
    g.userData.baseColor = color;
    g.userData.question = question;
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
    const baseY = 0.42;
    if (state === "dying") {
      pacMesh.position.y = baseY * Math.max(0, dyingTimer / 1.4);
    } else {
      pacMesh.position.y = baseY + jumpHeight();
    }
    // Stay round while jumping — no squash/stretch
    pacMesh.scale.set(1, 1, 1);

    const yaw = {
      // Mesh forward is +Z; world: right=+X, left=-X, down=+Z, up=-Z
      down: 0,
      right: Math.PI / 2,
      up: Math.PI,
      left: -Math.PI / 2,
      none: 0,
    }[pacman.dir.name];
    pacMesh.rotation.y = yaw;

    // Mouth opens forward (+Z wedge), not downward
    if (state !== "dying") {
      const halfGap = 0.22 + Math.abs(Math.sin(mouthPhase)) * 0.55;
      setPacMouthOpen(halfGap);
    } else {
      setPacMouthOpen(0.95);
    }
    updatePacEyesLook();

    // Animate mini arms & legs (swing around X = forward plane)
    const limbs = pacLimbs || pacMesh.userData.limbs;
    if (limbs) {
      const swing = state === "playing" && jumpTimer <= 0 ? Math.sin(mouthPhase * 1.8) * 0.7 : 0;
      const jump = jumpTimer > 0 ? jumpHeight() / JUMP_HEIGHT : 0;
      // Arms flap forward/back + raise on jump
      limbs.leftArm.rotation.y = swing * 0.5;
      limbs.rightArm.rotation.y = -swing * 0.5;
      limbs.leftArm.rotation.z = 0.25 + jump * 1.1;
      limbs.rightArm.rotation.z = -0.25 - jump * 1.1;
      limbs.leftArm.rotation.x = -jump * 0.4;
      limbs.rightArm.rotation.x = -jump * 0.4;
      limbs.leftLeg.rotation.x = -swing * 0.9 + jump * 0.7;
      limbs.rightLeg.rotation.x = swing * 0.9 + jump * 0.7;
      if (state === "dying") {
        limbs.leftArm.rotation.set(-0.2, 0, 0.9);
        limbs.rightArm.rotation.set(-0.2, 0, -0.9);
        limbs.leftLeg.rotation.set(0.3, 0, 0);
        limbs.rightLeg.rotation.set(0.3, 0, 0);
      }
    }

    pacMesh.visible = true;

    ghosts.forEach((g, i) => {
      const mesh = ghostMeshes[i];
      if (!mesh) return;
      if (g.winPopped) {
        mesh.visible = false;
        if (mesh.userData.question) mesh.userData.question.visible = false;
        return;
      }
      mesh.position.x = worldX(g.x);
      mesh.position.z = worldZ(g.y);
      mesh.position.y = 0.35 + Math.sin(flashTimer * 6 + i) * 0.03;

      const gyaw = {
        down: 0,
        right: Math.PI / 2,
        up: Math.PI,
        left: -Math.PI / 2,
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
        // During trip mode, colors come from applyTripColors — don't overwrite
        if (!tripActive) {
          if (g.mode === "frightened") {
            body.material.color.set(flashing ? 0xffffff : 0x2121de);
            body.material.emissive.set(flashing ? 0x444444 : 0x111166);
          } else {
            body.material.color.set(mesh.userData.baseColor);
            body.material.emissive.set(new THREE.Color(mesh.userData.baseColor).multiplyScalar(0.15));
          }
        } else if (g.mode === "frightened" && flashing) {
          body.material.color.set(0xffffff);
        }
      }

      mesh.visible = state !== "dying";

      const question = mesh.userData.question;
      if (question) {
        const pausing = g.pauseTimer > 0 && !g.eaten && state === "playing";
        question.visible = pausing;
        if (pausing) {
          question.position.y = 0.72 + Math.sin(flashTimer * 14) * 0.025;
        }
      }
    });

    // Pulse power pellets
    pelletMeshes.forEach((mesh) => {
      if (!mesh.visible || !mesh.userData.power) return;
      const s = 1 + Math.sin(flashTimer * 8) * 0.18;
      mesh.scale.setScalar(s);
    });
  }

  function updateCamera(dt) {
    if (arActive || renderer.xr.isPresenting) return;
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

  // ——— WebXR AR (Meta Quest passthrough + mobile AR) ———
  const arBtn = document.getElementById("ar-btn");
  const recenterBtn = document.getElementById("recenter-btn");
  let xrSession = null;
  let hitTestSource = null;
  let hitTestSourceRequested = false;
  let arPlaced = false;
  let arPlaceMode = true; // look at table + trigger to place / move
  const _arPos = new THREE.Vector3();
  const _arQuat = new THREE.Quaternion();
  const _arScl = new THREE.Vector3();
  const _arMat = new THREE.Matrix4();
  const _arFwd = new THREE.Vector3();

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.9 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  function setArCameraClip() {
    camera.near = CAM_NEAR_AR;
    camera.far = 40;
    camera.updateProjectionMatrix();
  }

  function restoreCameraClip() {
    camera.near = CAM_NEAR_DEFAULT;
    camera.far = 200;
    camera.updateProjectionMatrix();
  }

  function updateRecenterHud() {
    if (!recenterBtn) return;
    recenterBtn.hidden = !arActive;
    recenterBtn.classList.toggle("armed", arPlaceMode);
    recenterBtn.textContent = arPlaceMode ? "TAP PLACE" : "RECENTER";
  }

  const _arCam = new THREE.Vector3();
  const _arToCam = new THREE.Vector3();

  /** Yaw so maze local +Z (Pacman / bottom of map) faces the player. */
  function faceBoardTowardViewer(atPos) {
    camera.getWorldPosition(_arCam);
    _arToCam.subVectors(_arCam, atPos);
    _arToCam.y = 0;
    if (_arToCam.lengthSq() < 1e-6) _arToCam.set(0, 0, 1);
    else _arToCam.normalize();
    // local +Z → toward viewer (see maze from the bottom, not the top)
    board.rotation.set(0, Math.atan2(_arToCam.x, _arToCam.z), 0);
    board.quaternion.setFromEuler(board.rotation);
  }

  /** Flat on table, playable top up, Pacman-side toward viewer. */
  function applyBoardOnSurface(matrix, preview) {
    _arMat.copy(matrix);
    _arMat.decompose(_arPos, _arQuat, _arScl);
    // Keep playable surface facing world up (never upside-down)
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(_arQuat).y;
    board.position.copy(_arPos);
    board.position.y += 0.002;
    if (upY < 0) {
      // Hit normal pointed down — lift along world up only
      board.position.y += 0.002;
    }
    board.scale.setScalar(AR_SCALE);
    faceBoardTowardViewer(board.position);
    board.visible = true;
    if (!preview) {
      arPlaced = true;
      arPlaceMode = false;
      reticle.visible = false;
      updateRecenterHud();
      if (overlaySub && state === "ready") {
        overlaySub.textContent = "Swipe to move · Tap jump · Recenter moves board";
      }
    }
  }

  function placeBoardInFrontOfViewer(frame) {
    const refSpace = renderer.xr.getReferenceSpace();
    if (!refSpace || !frame) return false;
    const viewer = frame.getViewerPose(refSpace);
    if (!viewer) return false;
    _arMat.fromArray(viewer.transform.matrix);
    _arMat.decompose(_arPos, _arQuat, _arScl);
    _arFwd.set(0, 0, -1).applyQuaternion(_arQuat);
    _arFwd.y = 0;
    if (_arFwd.lengthSq() < 1e-6) _arFwd.set(0, 0, -1);
    _arFwd.normalize();
    board.position.copy(_arPos).addScaledVector(_arFwd, 0.55);
    board.position.y = _arPos.y - 0.42;
    board.scale.setScalar(AR_SCALE);
    // Pacman-side (+Z) toward viewer (= opposite of look direction)
    faceBoardTowardViewer(board.position);
    board.visible = true;
    arPlaced = true;
    arPlaceMode = false;
    reticle.visible = false;
    updateRecenterHud();
    return true;
  }

  function startRecenterMode() {
    if (!arActive) return;
    ensureAudio();
    arPlaceMode = true;
    arFallbackAt = performance.now();
    updateRecenterHud();
    if (overlaySub) {
      overlaySub.textContent = "Point at table · Tap / Trigger to place board";
    }
  }

  function enterArLayout() {
    arActive = true;
    arPlaced = false;
    arPlaceMode = true;
    boardHome.pos.copy(board.position);
    boardHome.scale.copy(board.scale);
    boardHome.quat = board.quaternion.clone();
    scene.background = null;
    scene.fog = null;
    setArCameraClip();
    board.scale.setScalar(AR_SCALE);
    board.visible = false; // wait until surface placement
    document.body.classList.add("ar-mode");
    if (arBtn) {
      arBtn.classList.add("active");
      arBtn.textContent = "EXIT AR";
    }
    updateRecenterHud();
    if (overlaySub) {
      overlaySub.textContent = "Point at table · Tap to place · then play";
    }
  }

  function exitArLayout() {
    arActive = false;
    arPlaced = false;
    arPlaceMode = false;
    hitTestSource = null;
    hitTestSourceRequested = false;
    reticle.visible = false;
    board.visible = true;
    board.position.copy(boardHome.pos);
    board.scale.copy(boardHome.scale);
    board.quaternion.identity();
    restoreCameraClip();
    if (!tripActive) {
      scene.background = new THREE.Color(bgBackup);
      scene.fog = new THREE.FogExp2(fogBackup.color.getHex(), fogBackup.density);
    } else {
      applyTripColors();
    }
    document.body.classList.remove("ar-mode");
    if (arBtn) {
      arBtn.classList.remove("active");
      arBtn.textContent = "AR";
    }
    updateRecenterHud();
    resize();
  }

  async function startArSession() {
    if (!navigator.xr) return;
    ensureAudio();
    const ua = navigator.userAgent || "";
    const isQuest = /Quest|OculusBrowser/i.test(ua);

    const trySession = async (init) => {
      const session = await navigator.xr.requestSession("immersive-ar", init);
      xrSession = session;
      try {
        renderer.xr.setReferenceSpaceType("local-floor");
      } catch (_) {
        /* older runtimes */
      }
      await renderer.xr.setSession(session);
      enterArLayout();
      session.addEventListener("end", () => {
        xrSession = null;
        exitArLayout();
      });
    };

    try {
      const sessionInit = {
        // hit-test + planes = place on real table (Quest 3 / phones)
        optionalFeatures: [
          "local-floor",
          "bounded-floor",
          "hit-test",
          "plane-detection",
          "anchors",
          "layers",
        ],
      };
      if (!isQuest) {
        sessionInit.optionalFeatures.push("dom-overlay");
        sessionInit.domOverlay = { root: document.body };
      }
      await trySession(sessionInit);
    } catch (err) {
      console.warn("AR session failed, retrying minimal", err);
      try {
        await trySession({ optionalFeatures: ["local-floor", "hit-test", "plane-detection"] });
      } catch (err2) {
        console.warn("AR fallback failed", err2);
        if (arBtn) {
          arBtn.hidden = true;
        }
      }
    }
  }

  function endArSession() {
    if (xrSession) xrSession.end();
    else if (renderer.xr.getSession()) renderer.xr.getSession().end();
  }

  function toggleAr() {
    if (renderer.xr.isPresenting || arActive) endArSession();
    else startArSession();
  }

  function setupArButton() {
    if (!arBtn) return;
    const showUnsupported = () => {
      arBtn.hidden = true;
      if (recenterBtn) recenterBtn.hidden = true;
    };
    if (!navigator.xr || !navigator.xr.isSessionSupported) {
      showUnsupported();
      return;
    }
    navigator.xr
      .isSessionSupported("immersive-ar")
      .then((ok) => {
        if (!ok) {
          showUnsupported();
          return;
        }
        arBtn.hidden = false;
        arBtn.disabled = false;
        arBtn.title = "WebXR AR — Meta Quest / mobile";
        arBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleAr();
        });
        if (recenterBtn) {
          recenterBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            startRecenterMode();
          });
        }
      })
      .catch(showUnsupported);
  }

  function onXrSelect() {
    ensureAudio();
    // Only reposition while in place / recenter mode
    if (arActive && arPlaceMode) {
      if (reticle.visible) applyBoardOnSurface(reticle.matrix, false);
      if (state === "ready" && arPlaced) onStartAction();
      return;
    }
    // Normal play: tap / trigger commands Pacman (not the board)
    if (state === "entername") {
      confirmNameEntry();
      return;
    }
    if (state === "ready" || state === "gameover" || state === "won") onStartAction();
    else if (state === "playing") tryJump();
  }

  function onXrSqueeze() {
    if (state === "playing" && !arPlaceMode) tryJump();
  }

  {
    const c0 = renderer.xr.getController(0);
    const c1 = renderer.xr.getController(1);
    c0.addEventListener("select", onXrSelect);
    c1.addEventListener("select", onXrSelect);
    c0.addEventListener("squeeze", onXrSqueeze);
    c1.addEventListener("squeeze", onXrSqueeze);
    scene.add(c0);
    scene.add(c1);
  }

  let arFallbackAt = 0;

  function updateArHitTest(frame) {
    if (!frame || !arActive) return;
    const session = renderer.xr.getSession();
    if (!session) return;

    // Keep near clip aggressive (lets you lean in close to the maze)
    if (camera.near > CAM_NEAR_AR + 0.001) setArCameraClip();

    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true;
      arFallbackAt = performance.now();
      session.requestReferenceSpace("viewer").then((refSpace) => {
        const req = session.requestHitTestSource?.bind(session);
        if (!req) return;
        req({ space: refSpace })
          .then((source) => {
            hitTestSource = source;
          })
          .catch(() => {
            hitTestSource = null;
          });
      });
      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
    }

    // Hit-test / reticle only while placing or recentering — otherwise tap controls Pacman
    if (!arPlaceMode) {
      reticle.visible = false;
      return;
    }

    let gotHit = false;
    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        const hit = hitTestResults[0];
        const refSpace = renderer.xr.getReferenceSpace();
        const pose = hit.getPose(refSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          gotHit = true;
          applyBoardOnSurface(reticle.matrix, true);
          board.visible = true;
        }
      }
    }

    if (!gotHit) {
      reticle.visible = false;
      if (!arPlaced && performance.now() - arFallbackAt > 2500) {
        placeBoardInFrontOfViewer(frame);
        arFallbackAt = performance.now() + 1e9;
      }
    }
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
    // Vanished walls (height 0) become open passages with an extra yellow pellet
    if (level >= 2) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (maze[y][x] === 1 && wallHeightFor(x, y) <= 0) {
            maze[y][x] = 2;
          }
        }
      }
    }
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
    if (audioCtx && !musicMaster) {
      musicMaster = audioCtx.createGain();
      musicMaster.gain.value = 0.055;
      musicMaster.connect(audioCtx.destination);
      rhythmGain = audioCtx.createGain();
      rhythmGain.gain.value = 0.038;
      rhythmGain.connect(audioCtx.destination);
    }
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

  function playNoiseBurst(duration = 0.1, gain = 0.05, when = 0) {
    if (!audioCtx) return;
    try {
      const len = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 900 + Math.random() * 1200;
      filter.Q.value = 0.8;
      const g = audioCtx.createGain();
      const t0 = audioCtx.currentTime + when;
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter);
      filter.connect(g);
      g.connect(audioCtx.destination);
      src.start(t0);
      src.stop(t0 + duration + 0.02);
    } catch (_) {
      /* ignore */
    }
  }

  function playFireworkSfx() {
    ensureAudio();
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(180 + Math.random() * 120, t);
      o.frequency.exponentialRampToValueAtTime(700 + Math.random() * 500, t + 0.14);
      g.gain.setValueAtTime(0.035, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.17);
    } catch (_) {
      /* ignore */
    }
    playNoiseBurst(0.12, 0.07, 0.1);
    beep(70 + Math.random() * 40, 0.28, "sine", 0.055);
    beep(220 + Math.random() * 80, 0.1, "triangle", 0.025);
  }

  function playGhostPopSfx(index) {
    ensureAudio();
    const base = [330, 392, 494, 587][index % 4];
    beep(base, 0.08, "square", 0.045);
    beep(base * 1.5, 0.12, "triangle", 0.04);
    beep(base * 2.2, 0.18, "sine", 0.03);
    playNoiseBurst(0.07, 0.045, 0.02);
    // silly descending "boing"
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(base * 2, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.5, t + 0.22);
      g.gain.setValueAtTime(0.03, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.25);
    } catch (_) {
      /* ignore */
    }
  }

  function playWinFanfare() {
    ensureAudio();
    const seq = [523, 659, 784, 1046, 784, 1046, 1318, 1568];
    seq.forEach((f, i) => {
      setTimeout(() => {
        beep(f, 0.16, i % 2 ? "triangle" : "square", 0.04);
        if (i % 3 === 2) playNoiseBurst(0.05, 0.03);
      }, i * 95);
    });
  }

  function ensureFxRoot() {
    if (fxRoot) return;
    fxRoot = new THREE.Group();
    board.add(fxRoot);
  }

  function clearWinFx() {
    winFxActive = false;
    winFxT = 0;
    winFireworkAcc = 0;
    winOverlayAt = 0;
    ghosts.forEach((g) => {
      g.winPopped = false;
      g.winPopAt = -1;
    });
    if (!fxRoot) return;
    while (fxRoot.children.length) {
      const c = fxRoot.children[0];
      fxRoot.remove(c);
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
    fxParticles.length = 0;
  }

  function spawnFxParticle({ geo, color, x, y, z, vx, vy, vz, life, gravity = 5, spin = 0, drag = 0.985 }) {
    if (fxParticles.length > 520) return;
    ensureFxRoot();
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    fxRoot.add(mesh);
    fxParticles.push({
      mesh,
      vx,
      vy,
      vz,
      life,
      maxLife: life,
      gravity,
      spin,
      drag,
      rx: (Math.random() - 0.5) * spin,
      ry: (Math.random() - 0.5) * spin,
      rz: (Math.random() - 0.5) * spin,
    });
  }

  function spawnFireworkBurst(wx, wy, wz) {
    playFireworkSfx();
    const n = 32 + Math.floor(Math.random() * 28);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2.2 + Math.random() * 5.5;
      spawnFxParticle({
        geo: sparkGeo,
        color: WIN_COLORS[Math.floor(Math.random() * WIN_COLORS.length)],
        x: wx,
        y: wy,
        z: wz,
        vx: Math.sin(phi) * Math.cos(theta) * speed,
        vy: Math.cos(phi) * speed * 0.85 + 1.2,
        vz: Math.sin(phi) * Math.sin(theta) * speed,
        life: 0.65 + Math.random() * 0.9,
        gravity: 7,
        spin: 8,
        drag: 0.97,
      });
    }
  }

  function spawnGhostConfetti(g, ghostIndex) {
    playGhostPopSfx(ghostIndex);
    const bx = worldX(g.x);
    const by = 0.45;
    const bz = worldZ(g.y);
    const baseCol = new THREE.Color(g.color || "#ff0000");
    const n = 55 + Math.floor(Math.random() * 35);
    for (let i = 0; i < n; i++) {
      const useGhost = Math.random() < 0.35;
      const color = useGhost
        ? baseCol.getHex()
        : WIN_COLORS[Math.floor(Math.random() * WIN_COLORS.length)];
      const speed = 1.5 + Math.random() * 6;
      const theta = Math.random() * Math.PI * 2;
      const elev = 0.3 + Math.random() * 1.2;
      spawnFxParticle({
        geo: confettiGeo,
        color,
        x: bx + (Math.random() - 0.5) * 0.2,
        y: by + Math.random() * 0.3,
        z: bz + (Math.random() - 0.5) * 0.2,
        vx: Math.cos(theta) * speed,
        vy: elev * speed * 0.7 + 2,
        vz: Math.sin(theta) * speed,
        life: 1.1 + Math.random() * 1.4,
        gravity: 9,
        spin: 14,
        drag: 0.99,
      });
    }
    // Extra sparkle pop
    for (let i = 0; i < 18; i++) {
      const theta = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      spawnFxParticle({
        geo: sparkGeo,
        color: 0xffffff,
        x: bx,
        y: by,
        z: bz,
        vx: Math.cos(theta) * speed,
        vy: 2 + Math.random() * 3,
        vz: Math.sin(theta) * speed,
        life: 0.4 + Math.random() * 0.4,
        gravity: 4,
        spin: 4,
      });
    }
  }

  function beginLevelWin() {
    state = "won";
    ensureAudio();
    setMusicMood("win");
    playWinFanfare();
    clearWinFx();
    winFxActive = true;
    winFxT = 0;
    winFireworkAcc = 0;
    winOverlayAt = 1.6;
    hideOverlay();

    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    ghosts.forEach((g, i) => {
      g.winPopped = false;
      g.pauseTimer = 0;
      const slot = order.indexOf(i);
      g.winPopAt = 0.2 + slot * (0.4 + Math.random() * 0.35) + Math.random() * 0.15;
    });

    // Opening salvo
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        if (!winFxActive) return;
        spawnFireworkBurst(
          worldX(4 + Math.random() * (COLS - 8)),
          2.5 + Math.random() * 3.5,
          worldZ(4 + Math.random() * (ROWS - 8))
        );
      }, i * 180);
    }
  }

  function updateWinFx(dt) {
    if (!winFxActive) return;
    winFxT += dt;

    if (winOverlayAt > 0 && winFxT >= winOverlayAt) {
      winOverlayAt = 0;
      showOverlay("YOU WIN!", "Enter / Tap for next level", "win");
    }

    // Staggered ghost pops → confetti
    ghosts.forEach((g, i) => {
      if (g.winPopped || g.winPopAt < 0) return;
      if (winFxT >= g.winPopAt) {
        g.winPopped = true;
        spawnGhostConfetti(g, i);
      }
    });

    // Continuous fireworks
    winFireworkAcc += dt;
    const interval = 0.18 + Math.random() * 0.22;
    if (winFireworkAcc >= interval) {
      winFireworkAcc = 0;
      spawnFireworkBurst(
        worldX(2 + Math.random() * (COLS - 4)),
        2.2 + Math.random() * 4.5,
        worldZ(2 + Math.random() * (ROWS - 4))
      );
      // Occasional double burst
      if (Math.random() < 0.35) {
        spawnFireworkBurst(
          worldX(2 + Math.random() * (COLS - 4)),
          3 + Math.random() * 3,
          worldZ(2 + Math.random() * (ROWS - 4))
        );
      }
    }

    // Integrate particles
    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const p = fxParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        fxRoot.remove(p.mesh);
        p.mesh.material.dispose();
        fxParticles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.vx *= p.drag;
      p.vz *= p.drag;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      p.mesh.rotation.z += p.rz * dt;
      p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      const s = 0.6 + 0.4 * (p.life / p.maxLife);
      p.mesh.scale.setScalar(s);
    }
  }

  // --- Casio VL-Tone / VL-10 style engine ---
  // Voices inspired by VL-1/VL-10 multipulse square + linear envelopes + Po/Pi/Sha
  const N = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, Fs3: 185.0, G3: 196.0, A3: 220.0, Bb3: 233.08, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, C6: 1046.5,
  };

  const VL_TONES = [
    // duty ≈ pulse width; octaveBoost like Fantasy (2·f on VL-1)
    { id: "piano", label: "PIANO", duty: 0.7, attack: 0.01, decay: 0.12, sustain: 0.25, release: 0.18, vibHz: 5.5, vibDepth: 4, octave: 1 },
    { id: "fantasy", label: "FANTASY", duty: 0.5, attack: 0.02, decay: 0.08, sustain: 0.55, release: 0.35, vibHz: 6.5, vibDepth: 9, octave: 2 },
    { id: "violin", label: "VIOLIN", duty: 0.22, attack: 0.08, decay: 0.15, sustain: 0.7, release: 0.28, vibHz: 6.0, vibDepth: 7, octave: 1, pulses: 5 },
    { id: "flute", label: "FLUTE", duty: 0.5, attack: 0.05, decay: 0.1, sustain: 0.65, release: 0.22, vibHz: 5.0, vibDepth: 3, octave: 1 },
    { id: "guitar", label: "GUITAR", duty: 0.35, attack: 0.005, decay: 0.09, sustain: 0.12, release: 0.12, vibHz: 0, vibDepth: 0, octave: 0.5 },
    { id: "horn", label: "ENG HORN", duty: 0.12, attack: 0.04, decay: 0.12, sustain: 0.5, release: 0.2, vibHz: 4.5, vibDepth: 5, octave: 0.5 },
    { id: "electro1", label: "ELECTRO I", duty: 0.7, attack: 0.01, decay: 0.06, sustain: 0.4, release: 0.15, vibHz: 8, vibDepth: 28, octave: 1 },
    { id: "electro2", label: "ELECTRO II", duty: 0.5, attack: 0.01, decay: 0.05, sustain: 0.45, release: 0.18, vibHz: 10, vibDepth: 40, octave: 2 },
  ];

  function getVlPeriodicWave(duty, pulses = 1) {
    const key = `${duty.toFixed(3)}_${pulses}`;
    if (vlPulseCache.has(key)) return vlPulseCache.get(key);
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      // Multipulse approximation: sum of offset pulse trains
      let imagSum = 0;
      for (let p = 0; p < pulses; p++) {
        const phase = (p / pulses) * Math.PI;
        imagSum += Math.sin(i * Math.PI * duty + phase) / i;
      }
      imag[i] = (2 / Math.PI) * imagSum;
    }
    const wave = audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
    vlPulseCache.set(key, wave);
    return wave;
  }

  function playVlTone(freq, dur, tone, vol = 0.55, when = 0) {
    if (!audioCtx || !musicMaster || !freq || !tone) return;
    try {
      const t0 = audioCtx.currentTime + when;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2800;
      filter.Q.value = 0.7;

      const wave = getVlPeriodicWave(tone.duty, tone.pulses || 1);
      osc.setPeriodicWave(wave);
      osc.frequency.setValueAtTime(freq * tone.octave, t0);

      if (tone.vibDepth > 0 && tone.vibHz > 0) {
        const lfo = audioCtx.createOscillator();
        const lfoGain = audioCtx.createGain();
        lfo.frequency.value = tone.vibHz;
        lfoGain.gain.value = tone.vibDepth * tone.octave;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start(t0);
        lfo.stop(t0 + dur + tone.release + 0.05);
      }

      // VL-style near-linear envelope (fades early — classic Casio quirk)
      const peak = vol;
      const a = Math.max(0.004, tone.attack);
      const d = Math.max(0.01, tone.decay);
      const s = peak * tone.sustain;
      const r = Math.max(0.04, tone.release);
      const noteEnd = t0 + Math.max(dur, a + d * 0.5);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + a);
      g.gain.linearRampToValueAtTime(s, t0 + a + d);
      g.gain.linearRampToValueAtTime(s * 0.85, noteEnd);
      g.gain.linearRampToValueAtTime(0.0001, noteEnd + r);

      osc.connect(filter);
      filter.connect(g);
      g.connect(musicMaster);
      osc.start(t0);
      osc.stop(noteEnd + r + 0.03);
    } catch (_) {
      /* ignore */
    }
  }

  function playVlBass(freq, dur, vol = 0.45, when = 0) {
    if (!audioCtx || !musicMaster || !freq) return;
    try {
      const t0 = audioCtx.currentTime + when;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(musicMaster);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (_) {
      /* ignore */
    }
  }

  // Casio rhythm kit: Po (low clave), Pi (high clave), Sha (noise snare)
  function playPo(when = 0) {
    if (!audioCtx || !rhythmGain) return;
    try {
      const t0 = audioCtx.currentTime + when;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = 769;
      g.gain.setValueAtTime(0.5, t0);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 0.03);
      osc.connect(g);
      g.connect(rhythmGain);
      osc.start(t0);
      osc.stop(t0 + 0.035);
    } catch (_) {
      /* ignore */
    }
  }

  function playPi(when = 0) {
    if (!audioCtx || !rhythmGain) return;
    try {
      const t0 = audioCtx.currentTime + when;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = 1667;
      g.gain.setValueAtTime(0.4, t0);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 0.02);
      osc.connect(g);
      g.connect(rhythmGain);
      osc.start(t0);
      osc.stop(t0 + 0.025);
    } catch (_) {
      /* ignore */
    }
  }

  function playSha(when = 0) {
    if (!audioCtx || !rhythmGain) return;
    try {
      const t0 = audioCtx.currentTime + when;
      const len = 0.16;
      const buffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * len), audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      let reg = 0xace1;
      for (let i = 0; i < data.length; i++) {
        reg ^= reg << 7;
        reg ^= reg >>> 9;
        reg ^= reg << 8;
        data[i] = ((reg & 0xffff) / 0x8000 - 1) * (1 - i / data.length);
      }
      const src = audioCtx.createBufferSource();
      const g = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2800;
      filter.Q.value = 0.8;
      src.buffer = buffer;
      g.gain.setValueAtTime(0.45, t0);
      g.gain.linearRampToValueAtTime(0.0001, t0 + len);
      src.connect(filter);
      filter.connect(g);
      g.connect(rhythmGain);
      src.start(t0);
    } catch (_) {
      /* ignore */
    }
  }

  // Simple VL rock over 8 eighths
  function playVlRhythmHit(step) {
    const s = step % 8;
    if (s === 0) playPo();
    else if (s === 2) playPi();
    else if (s === 3) playSha();
    else if (s === 4) playPo();
    else if (s === 6) playPi();
  }

  // Soft jazz ride / brushes feel
  function playJazzRhythmHit(step) {
    const s = step % 8;
    if (s === 0) playPo();
    else if (s === 2) playPi();
    else if (s === 3) {
      playPi(0);
      playSha(0.01);
    } else if (s === 4) playPo();
    else if (s === 6) playPi();
    else if (s === 7) playPi(0);
  }

  // Bossa nova clave-ish: soft, syncopated
  function playBossaRhythmHit(step) {
    const s = step % 16;
    if (s === 0) playPo();
    else if (s === 3) playPi();
    else if (s === 6) {
      playSha();
      playPi(0.01);
    } else if (s === 8) playPo();
    else if (s === 10) playPi();
    else if (s === 13) playSha();
  }

  function playRhythmForStyle(style, step) {
    if (style === "jazz") playJazzRhythmHit(step);
    else if (style === "bossa") playBossaRhythmHit(step);
    else playVlRhythmHit(step);
  }

  // Quiet chord stab for jazz/bossa color
  function playCompChord(freqs, dur, vol = 0.12, when = 0) {
    const tone = currentVlTone();
    freqs.forEach((f, i) => {
      if (f) playVlTone(f, dur * 1.2, tone, vol * (1 - i * 0.15), when + i * 0.01);
    });
  }

  const MUSIC = {
    ready: {
      bpm: 112,
      lead: [N.G4, 0, N.E4, 0, N.C4, 0, N.E4, 0, N.G4, 0, N.C5, 0, N.B4, 0, N.A4, 0],
      bass: [N.C3, 0, 0, 0, N.G3, 0, 0, 0, N.A3, 0, 0, 0, N.G3, 0, 0, 0],
      rhythm: false,
    },
    chase: {
      bpm: 148,
      lead: [N.C5, N.C5, N.G4, 0, N.E4, N.E4, N.C4, 0, N.F4, N.F4, N.A4, 0, N.G4, N.E4, N.C4, 0],
      bass: [N.C3, 0, N.C3, 0, N.G3, 0, N.G3, 0, N.F3, 0, N.F3, 0, N.G3, 0, N.E3, 0],
      rhythm: true,
    },
    // Jazz swing variation — walking bass + chromatic lead
    chaseJazz: {
      bpm: 136,
      swing: 0.22,
      lead: [
        N.E5, 0, N.G5, N.A5, N.G5, 0, N.E5, N.D5,
        N.C5, N.D5, N.E5, 0, N.G4, N.A4, N.C5, 0,
        N.D5, 0, N.F5, N.G5, N.F5, 0, N.D5, N.C5,
        N.B4, N.C5, N.D5, 0, N.G4, N.B4, N.D5, 0,
      ],
      bass: [
        N.C3, N.E3, N.F3, N.Fs3, N.G3, N.A3, N.Bb3, N.B3,
        N.C3, N.B3, N.A3, N.G3, N.F3, N.E3, N.D3, N.G3,
        N.F3, N.A3, N.Bb3, N.B3, N.C4, N.A3, N.G3, N.F3,
        N.E3, N.G3, N.A3, N.B3, N.C3, N.E3, N.G3, N.C3,
      ],
      comps: [
        [N.E4, N.G4, N.B4], 0, 0, 0, [N.D4, N.F4, N.A4], 0, 0, 0,
        [N.C4, N.E4, N.G4], 0, 0, 0, [N.B3, N.D4, N.G4], 0, 0, 0,
      ],
      rhythm: "jazz",
    },
    // Bossa nova — laid-back syncopation
    chaseBossa: {
      bpm: 118,
      swing: 0.06,
      lead: [
        N.G4, 0, 0, N.A4, 0, N.C5, 0, 0,
        N.B4, 0, N.A4, 0, N.G4, 0, N.E4, 0,
        N.F4, 0, 0, N.G4, 0, N.A4, 0, 0,
        N.G4, 0, N.E4, 0, N.C4, 0, N.D4, 0,
      ],
      bass: [
        N.C3, 0, 0, N.G3, 0, 0, N.C3, 0,
        0, N.G3, 0, 0, N.F3, 0, 0, N.G3,
        N.F3, 0, 0, N.C3, 0, 0, N.F3, 0,
        0, N.G3, 0, 0, N.C3, 0, N.G3, 0,
      ],
      comps: [
        [N.E4, N.G4, N.C5], 0, 0, [N.D4, N.G4, N.B4], 0, 0, 0, 0,
        [N.C4, N.F4, N.A4], 0, 0, [N.B3, N.E4, N.G4], 0, 0, 0, 0,
      ],
      rhythm: "bossa",
    },
    readyJazz: {
      bpm: 108,
      swing: 0.25,
      lead: [N.E4, 0, N.G4, N.A4, 0, N.G4, 0, N.E4, N.C4, 0, 0, N.D4, 0, N.E4, 0, 0],
      bass: [N.C3, N.E3, N.G3, N.A3, N.G3, N.E3, N.D3, N.G3, N.C3, 0, N.G3, 0, N.F3, 0, N.G3, 0],
      comps: [[N.E4, N.G4, N.B4], 0, 0, 0, [N.D4, N.F4, N.A4], 0, 0, 0],
      rhythm: false,
    },
    readyBossa: {
      bpm: 100,
      swing: 0.05,
      lead: [N.G4, 0, 0, N.E4, 0, 0, N.C4, 0, 0, N.D4, 0, N.E4, 0, 0, N.G4, 0],
      bass: [N.C3, 0, 0, N.G3, 0, 0, N.A3, 0, 0, 0, N.G3, 0, N.F3, 0, N.G3, 0],
      comps: [[N.E4, N.G4, N.C5], 0, 0, 0, [N.D4, N.G4, N.B4], 0, 0, 0],
      rhythm: "bossa",
    },
    fright: {
      bpm: 196,
      lead: [N.A5, N.E5, N.C5, N.E5, N.A5, N.E5, N.C5, N.E5, N.B4, N.F5, N.D5, N.F5, N.B4, N.F5, N.D5, N.F5],
      bass: [N.A3, N.A3, N.E3, N.E3, N.A3, N.A3, N.E3, N.E3, N.B3, N.B3, N.F3, N.F3, N.B3, N.B3, N.F3, N.F3],
      rhythm: true,
    },
    paused: {
      bpm: 80,
      lead: [N.E4, 0, 0, 0, N.G4, 0, 0, 0],
      bass: [N.C3, 0, 0, 0, N.G3, 0, 0, 0],
      rhythm: false,
    },
    death: {
      bpm: 100,
      oneshot: true,
      lead: [N.E5, N.D5, N.C5, N.B4, N.A4, N.G4, N.F4, N.E4, N.D4, N.C4, 0, 0],
      bass: [N.E3, 0, N.D3, 0, N.C3, 0, N.B3, 0, N.A3, 0, N.G3, 0],
      rhythm: false,
    },
    win: {
      bpm: 150,
      oneshot: true,
      lead: [N.C4, N.E4, N.G4, N.C5, N.E5, N.G5, N.E5, N.C5, N.G5, N.C5, 0, 0],
      bass: [N.C3, 0, N.E3, 0, N.G3, 0, N.C4, 0, N.G3, 0, N.C3, 0],
      rhythm: false,
    },
    gameover: {
      bpm: 90,
      oneshot: true,
      lead: [N.G4, N.F4, N.E4, N.D4, N.C4, N.B3, N.A3, N.G3, 0, 0, 0, 0],
      bass: [N.G3, 0, N.F3, 0, N.E3, 0, N.D3, 0, N.C3, 0, 0, 0],
      rhythm: false,
    },
  };

  // Cycle VL → Jazz → Bossa over time during play
  const MUSIC_STYLE_CYCLE = ["vl", "jazz", "bossa"];
  let musicStyleIndex = 0;
  let musicStyleTimer = 0;
  const MUSIC_STYLE_SECS = 28; // seconds per vibe

  function currentMusicStyle() {
    return MUSIC_STYLE_CYCLE[musicStyleIndex % MUSIC_STYLE_CYCLE.length];
  }

  function themeForMood(mood) {
    const style = currentMusicStyle();
    if (mood === "chase") {
      if (style === "jazz") return MUSIC.chaseJazz;
      if (style === "bossa") return MUSIC.chaseBossa;
      return MUSIC.chase;
    }
    if (mood === "ready") {
      if (style === "jazz") return MUSIC.readyJazz;
      if (style === "bossa") return MUSIC.readyBossa;
      return MUSIC.ready;
    }
    return MUSIC[mood] || MUSIC.ready;
  }

  function styleLabel() {
    const s = currentMusicStyle();
    if (s === "jazz") return "JAZZ";
    if (s === "bossa") return "BOSSA";
    return "VL";
  }

  function currentVlTone() {
    return VL_TONES[vlToneIndex % VL_TONES.length];
  }

  function cycleVlTone(dir = 1) {
    ensureAudio();
    vlToneIndex = (vlToneIndex + dir + VL_TONES.length) % VL_TONES.length;
    updateToneHud();
    // Preview the new voice
    const tone = currentVlTone();
    playVlTone(N.C5, 0.28, tone, 0.7);
    playVlTone(N.E5, 0.28, tone, 0.55, 0.12);
    playVlTone(N.G5, 0.35, tone, 0.5, 0.24);
  }

  function updateToneHud() {
    const el = document.getElementById("vl-tone");
    if (!el) return;
    el.textContent = `TONE: ${currentVlTone().label} · ${styleLabel()}`;
    el.classList.add("show");
  }

  function setupToneHud() {
    const el = document.getElementById("vl-tone");
    if (!el) return;
    el.style.pointerEvents = "auto";
    el.style.cursor = "pointer";
    el.title = "Tap to change VL tone";
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    const cycle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      cycleVlTone(1);
    };
    el.addEventListener("click", cycle);
    el.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        cycle(e);
      },
      { passive: false }
    );
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cycleVlTone(1);
      }
    });
  }

  function setMusicMood(mood) {
    // chase/ready resolve via themeForMood; others need MUSIC[mood]
    if (mood !== "chase" && mood !== "ready" && !MUSIC[mood]) return;
    if (musicMood === mood && !MUSIC[mood]?.oneshot) return;
    musicMood = mood;
    musicStep = 0;
    musicAcc = 0;
    musicOneShot = false;
  }

  function tickMusic(dt) {
    if (!audioCtx || !musicMaster) return;

    // Rotate VL → Jazz → Bossa while chasing / on ready screen
    if ((musicMood === "chase" || musicMood === "ready") && state !== "paused") {
      musicStyleTimer += dt;
      if (musicStyleTimer >= MUSIC_STYLE_SECS) {
        musicStyleTimer = 0;
        musicStyleIndex = (musicStyleIndex + 1) % MUSIC_STYLE_CYCLE.length;
        musicStep = 0;
        updateToneHud();
      }
    }

    const theme = themeForMood(musicMood);
    if (!theme) return;
    if (theme.oneshot && musicOneShot) return;

    let bpm = theme.bpm;
    if (musicMood === "fright" && frightenedMax > 0) {
      const life = Math.max(0, frightenedTimer / frightenedMax);
      bpm = 100 + life * 100;
    }

    const stepDur = 60 / bpm / 2;
    const swing = theme.swing || 0;
    musicAcc += dt;
    const tone = currentVlTone();
    while (musicAcc >= stepDur) {
      musicAcc -= stepDur;
      const lead = theme.lead[musicStep % theme.lead.length];
      const bass = theme.bass[musicStep % theme.bass.length];
      const noteLen = stepDur * (swing ? 0.75 : 0.9);
      const when = musicStep % 2 === 1 ? swing * stepDur : 0;
      if (lead) playVlTone(lead, noteLen, tone, 0.58, when);
      if (bass) playVlBass(bass, noteLen * 1.15, 0.42, when * 0.5);
      if (theme.comps) {
        const comp = theme.comps[musicStep % theme.comps.length];
        if (comp && Array.isArray(comp)) playCompChord(comp, noteLen * 1.4, 0.11, when);
      }
      if (theme.rhythm) {
        const rstyle = theme.rhythm === true ? "vl" : theme.rhythm;
        playRhythmForStyle(rstyle, musicStep);
      }
      musicStep += 1;
      if (theme.oneshot && musicStep >= theme.lead.length) {
        musicOneShot = true;
        break;
      }
    }
  }

  function playEatGhostJingle() {
    ensureAudio();
    const tone = currentVlTone();
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => {
      playVlTone(f, 0.12, tone, 0.7, i * 0.055);
    });
  }

  // Back-compat alias used nowhere critical
  function playCasioNote(freq, dur, _type, vol, when = 0) {
    playVlTone(freq, dur, currentVlTone(), vol, when);
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

  function playFart(when = 0) {
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + when;
      // Always bitonal: low → high (varies every jump)
      const lowPool = [48, 55, 62, 70, 78, 88, 98, 110, 124];
      const highPool = [130, 147, 165, 185, 208, 233, 262, 294, 330];
      let fStart = lowPool[(Math.random() * lowPool.length) | 0];
      let fEnd = highPool[(Math.random() * highPool.length) | 0];
      // Guarantee clear upward interval
      if (fEnd <= fStart + 20) fEnd = fStart + 40 + Math.random() * 80;
      const dur = 0.18 + Math.random() * 0.55; // short toot → long brrrp
      const wet = 0.35 + Math.random() * 0.4;

      // Tone A → Tone B glide (the bitonal fart)
      const osc = audioCtx.createOscillator();
      osc.type = Math.random() < 0.5 ? "sawtooth" : "square";
      osc.frequency.setValueAtTime(fStart, t0);
      osc.frequency.linearRampToValueAtTime(fEnd, t0 + dur * 0.85);
      const og = audioCtx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.28 + Math.random() * 0.12, t0 + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      // Second partial an octave-ish off for rasp, also slides
      const osc2 = audioCtx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(fStart * (1.5 + Math.random() * 0.4), t0);
      osc2.frequency.linearRampToValueAtTime(fEnd * (1.3 + Math.random() * 0.5), t0 + dur * 0.85);
      const og2 = audioCtx.createGain();
      og2.gain.setValueAtTime(0.0001, t0);
      og2.gain.exponentialRampToValueAtTime(0.1 + Math.random() * 0.08, t0 + 0.025);
      og2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.95);

      // Noise rasp amount varies
      const buf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      let reg = (Math.random() * 0xffff) | 1;
      for (let i = 0; i < data.length; i++) {
        const env = Math.sin((i / data.length) * Math.PI);
        reg ^= reg << 7;
        reg ^= reg >>> 9;
        reg ^= reg << 8;
        data[i] = ((reg & 0xffff) / 0x8000 - 1) * env;
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 2 + Math.random() * 4;
      filter.frequency.setValueAtTime(fStart * 1.2, t0);
      filter.frequency.linearRampToValueAtTime(fEnd * 1.1, t0 + dur);
      const ng = audioCtx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(wet, t0 + 0.02);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(og);
      og.connect(audioCtx.destination);
      osc2.connect(og2);
      og2.connect(audioCtx.destination);
      noise.connect(filter);
      filter.connect(ng);
      ng.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      osc2.start(t0);
      osc2.stop(t0 + dur + 0.02);
      noise.start(t0);
    } catch (_) {
      /* ignore */
    }
  }

  function tryJump() {
    if (state !== "playing") return false;
    if (jumpTimer > 0) return false;
    jumpTimer = JUMP_DURATION;
    ensureAudio();
    playFart();
    updateJumpHud();
    return true;
  }

  function updateHud() {
    scoreEl.textContent = formatScore(score);
    highEl.textContent = formatScore(highScore);
    if (levelEl) levelEl.textContent = String(level);
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
    hideNameEntry();
    hideScoreboard();
    hideLevelSelect();
  }

  function normalizeHiscores(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e.score === "number" && typeof e.name === "string")
      .map((e) => ({
        name: String(e.name).toUpperCase().padEnd(NAME_LEN).slice(0, NAME_LEN),
        score: Math.max(0, Math.floor(e.score)),
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, HS_MAX);
  }

  function loadHiscores() {
    try {
      const raw = JSON.parse(localStorage.getItem(HS_KEY) || "[]");
      const list = normalizeHiscores(raw);
      if (list.length) return list;
    } catch (_) {
      /* ignore */
    }
    if (highScore > 0) return [{ name: "PLAYER ", score: highScore }];
    return [];
  }

  function applyHiscores(list, { saveLocal = true } = {}) {
    hiscores = normalizeHiscores(list);
    if (hiscores.length) {
      highScore = hiscores[0].score;
      highEl.textContent = formatScore(highScore);
      localStorage.setItem("pacman-high", String(highScore));
    }
    if (saveLocal) localStorage.setItem(HS_KEY, JSON.stringify(hiscores));
  }

  function saveHiscores() {
    applyHiscores(hiscores, { saveLocal: true });
  }

  async function fetchRemoteHiscores() {
    try {
      const r = await fetch("/api/scores", { cache: "no-store" });
      if (!r.ok) return null;
      const data = await r.json();
      return normalizeHiscores(data.scores);
    } catch (_) {
      return null;
    }
  }

  async function submitRemoteScore(name, scoreValue) {
    try {
      const r = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, score: scoreValue }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return {
        scores: normalizeHiscores(data.scores),
        rank: typeof data.rank === "number" ? data.rank : -1,
      };
    } catch (_) {
      return null;
    }
  }

  async function syncHiscoresFromServer() {
    const remote = await fetchRemoteHiscores();
    if (!remote) return;
    applyHiscores(remote);
    if (state === "gameover" || state === "ready") {
      if (scoreboardEl && !scoreboardEl.classList.contains("hidden")) {
        renderScoreboard();
      }
    }
  }

  function qualifiesForHiscore(s) {
    if (s <= 0) return false;
    if (hiscores.length < HS_MAX) return true;
    return s > hiscores[hiscores.length - 1].score;
  }

  function setHighScore() {
    // Keep top HUD in sync; full board updates on game over / name entry
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("pacman-high", String(highScore));
    }
  }

  function renderNameSlots() {
    if (!nameSlotsEl) return;
    nameSlotsEl.innerHTML = "";
    for (let i = 0; i < NAME_LEN; i++) {
      const slot = document.createElement("div");
      slot.className = "name-slot" + (i === nameCursor ? " active" : "");
      slot.textContent = nameChars[i] === " " ? "_" : nameChars[i];
      nameSlotsEl.appendChild(slot);
    }
  }

  function showNameEntry() {
    if (nameEntryEl) nameEntryEl.classList.remove("hidden");
    hideScoreboard();
    renderNameSlots();
  }

  function hideNameEntry() {
    if (nameEntryEl) nameEntryEl.classList.add("hidden");
  }

  function renderScoreboard(highlightName = null) {
    if (!scoreboardEl) return;
    scoreboardEl.innerHTML = "";
    if (!hiscores.length) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="rank">-</span><span class="name">-------</span><span class="pts">00</span>`;
      scoreboardEl.appendChild(li);
    } else {
      hiscores.forEach((e, i) => {
        const li = document.createElement("li");
        if (highlightName && e.name === highlightName && i === lastEnteredRank) li.classList.add("you");
        li.innerHTML = `<span class="rank">${String(i + 1).padStart(2, "0")}</span><span class="name">${e.name.replace(/ /g, "\u00A0")}</span><span class="pts">${formatScore(e.score)}</span>`;
        scoreboardEl.appendChild(li);
      });
    }
    scoreboardEl.classList.remove("hidden");
  }

  function hideScoreboard() {
    if (scoreboardEl) scoreboardEl.classList.add("hidden");
  }

  function renderLevelPick() {
    if (levelPickValEl) levelPickValEl.textContent = String(levelPick);
  }

  function showLevelSelect() {
    if (levelSelectEl) levelSelectEl.classList.remove("hidden");
    hideNameEntry();
    hideScoreboard();
    renderLevelPick();
  }

  function hideLevelSelect() {
    if (levelSelectEl) levelSelectEl.classList.add("hidden");
  }

  function openLevelSelect() {
    if (state === "entername" || state === "dying") return;
    ensureAudio();
    if (state === "playing") {
      state = "paused";
      showOverlay("PAUSED", "Select a level or resume", "ready");
      setMusicMood("ready");
    }
    if (state === "won") clearWinFx();
    levelPick = Math.max(1, Math.min(LEVEL_SELECT_MAX, level));
    state = "levelselect";
    showOverlay("LEVEL SELECT", "◀ ▶ then OK · Esc cancel", "ready");
    showLevelSelect();
    beep(520, 0.06, "square", 0.025);
  }

  function nudgeLevelPick(dir) {
    levelPick = Math.max(1, Math.min(LEVEL_SELECT_MAX, levelPick + dir));
    renderLevelPick();
    beep(400 + levelPick * 4, 0.04, "square", 0.02);
  }

  function confirmLevelSelect() {
    level = levelPick;
    saveLevel();
    hideLevelSelect();
    startLevel(true);
    beep(660, 0.08, "triangle", 0.03);
  }

  function cancelLevelSelect() {
    hideLevelSelect();
    state = "ready";
    showOverlay("READY!", `LEVEL ${level} — Enter / Tap to Start · H = scores`, "ready");
    setMusicMood("ready");
  }

  function beginNameEntry() {
    state = "entername";
    nameChars = Array(NAME_LEN).fill("A");
    nameCursor = 0;
    lastEnteredRank = -1;
    showOverlay("HIGH SCORE!", `Score ${formatScore(score)} — enter name`, "win");
    showNameEntry();
    setMusicMood("win");
  }

  function cycleNameChar(dir) {
    const cur = nameChars[nameCursor];
    let idx = NAME_CHARS.indexOf(cur);
    if (idx < 0) idx = 0;
    idx = (idx + dir + NAME_CHARS.length) % NAME_CHARS.length;
    nameChars[nameCursor] = NAME_CHARS[idx];
    renderNameSlots();
  }

  function moveNameCursor(dir) {
    nameCursor = Math.max(0, Math.min(NAME_LEN - 1, nameCursor + dir));
    renderNameSlots();
  }

  function typeNameChar(ch) {
    const up = ch.toUpperCase();
    if (!NAME_CHARS.includes(up)) return;
    nameChars[nameCursor] = up;
    if (nameCursor < NAME_LEN - 1) nameCursor += 1;
    renderNameSlots();
  }

  async function confirmNameEntry() {
    if (state !== "entername") return;
    const name = nameChars.join("").toUpperCase().padEnd(NAME_LEN).slice(0, NAME_LEN);
    const scoreValue = score;
    hiscores.push({ name, score: scoreValue });
    hiscores.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    hiscores = hiscores.slice(0, HS_MAX);
    lastEnteredRank = hiscores.findIndex((e) => e.name === name && e.score === scoreValue);
    saveHiscores();
    updateHud();
    hideNameEntry();
    state = "gameover";
    showOverlay("GAME OVER", "Enter / Tap to play again", "game-over");
    renderScoreboard(name);
    setMusicMood("gameover");
    beep(660, 0.08, "square", 0.03);

    const remote = await submitRemoteScore(name, scoreValue);
    if (remote && remote.scores) {
      applyHiscores(remote.scores);
      if (remote.rank >= 0) lastEnteredRank = remote.rank;
      if (state === "gameover") renderScoreboard(name);
      updateHud();
    }
  }

  function handleNameEntryKey(e) {
    if (e.key === "ArrowLeft" || e.code === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      moveNameCursor(-1);
      return true;
    }
    if (e.key === "ArrowRight" || e.code === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      moveNameCursor(1);
      return true;
    }
    if (e.key === "ArrowUp" || e.code === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      cycleNameChar(1);
      return true;
    }
    if (e.key === "ArrowDown" || e.code === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      cycleNameChar(-1);
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      confirmNameEntry();
      return true;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (nameCursor > 0 && nameChars[nameCursor] === "A") nameCursor -= 1;
      nameChars[nameCursor] = "A";
      renderNameSlots();
      return true;
    }
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      typeNameChar(" ");
      return true;
    }
    if (e.key && e.key.length === 1) {
      const up = e.key.toUpperCase();
      if (NAME_CHARS.includes(up)) {
        e.preventDefault();
        typeNameChar(up);
        return true;
      }
    }
    return false;
  }

  function goGameOver() {
    setHighScore();
    if (qualifiesForHiscore(score)) {
      beginNameEntry();
    } else {
      state = "gameover";
      showOverlay("GAME OVER", "Enter / Tap to play again", "game-over");
      renderScoreboard();
      setMusicMood("gameover");
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
      g.pauseTimer = 0;
      g.pauseNext = nextGhostPauseDelay();
      g.winPopped = false;
      g.winPopAt = -1;
    });

    releaseTimer = 0;
    frightenedTimer = 0;
    frightenedPoints = 200;
    dyingTimer = 0;
    jumpTimer = 0;
    if (tripActive) restoreSceneColors();
    updateJumpHud();
  }

  function startLevel(resetScore = false) {
    if (resetScore) {
      score = 0;
      lives = 3;
      // Keep progress: restart at saved level even after death
      level = loadSavedLevel();
    }
    clearWinFx();
    cloneMaze();
    saveLevel();
    modeIndex = 0;
    modeTimer = MODE_SCHEDULE[0].duration;
    globalMode = MODE_SCHEDULE[0].mode;
    pacman.speed = 3.6 + Math.min(level - 1, 4) * 0.06;
    resetActors();
    buildMazeMeshes();
    initActors3D();
    refreshPelletVisibility();
    state = "ready";
    showOverlay("READY!", `LEVEL ${level} — Enter / Tap to Start · L = level`, "ready");
    hideNameEntry();
    hideScoreboard();
    hideLevelSelect();
    setMusicMood("ready");
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
    setMusicMood(frightenedTimer > 0 ? "fright" : "chase");
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
    frightenedMax = frightenedTimer;
    frightenedPoints = 200;
    ghosts.forEach((g) => {
      if (g.mode !== "house" && g.mode !== "leaving" && !g.eaten) {
        g.mode = "frightened";
        reverseDir(g);
      }
    });
    applyTripColors();
    tripShuffleTimer = 0.2;
    setMusicMood("fright");
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
      beginLevelWin();
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
          playEatGhostJingle();
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
        playEatGhostJingle();
        continue;
      }

      state = "dying";
      dyingTimer = 1.4;
      jumpTimer = 0;
      lives -= 1;
      updateHud();
      if (tripActive) restoreSceneColors();
      setMusicMood("death");
      beep(120, 0.35, "sawtooth", 0.05);
      return;
    }
  }

  function canGhostPause(g) {
    if (g.eaten) return false;
    if (g.mode === "house" || g.mode === "leaving") return false;
    return g.mode === "chase" || g.mode === "scatter" || g.mode === "frightened";
  }

  function tickGhostPauses(dt) {
    ghosts.forEach((g) => {
      if (g.pauseTimer > 0) {
        g.pauseTimer -= dt;
        if (g.pauseTimer <= 0) {
          g.pauseTimer = 0;
          g.pauseNext = nextGhostPauseDelay();
        }
        return;
      }
      if (!canGhostPause(g)) return;
      g.pauseNext -= dt;
      if (g.pauseNext <= 0) {
        g.pauseTimer = GHOST_PAUSE_DUR;
        g.pauseNext = nextGhostPauseDelay();
      }
    });
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
          goGameOver();
        } else {
          resetActors();
          state = "ready";
          showOverlay("READY!", "Press Enter or Tap to continue", "ready");
          setMusicMood("ready");
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
      tripShuffleTimer -= dt;
      if (tripShuffleTimer <= 0) {
        applyTripColors();
        // Fast at start, progressively slower as power runs out
        const life = Math.max(0, frightenedTimer / Math.max(frightenedMax, 0.001));
        const interval = 0.2 + (1 - life) * (1 - life) * 1.4;
        tripShuffleTimer = interval;
      }
      if (frightenedTimer <= 0) {
        frightenedTimer = 0;
        restoreSceneColors();
        ghosts.forEach((g) => {
          if (g.mode === "frightened") g.mode = globalMode;
        });
        if (state === "playing") setMusicMood("chase");
      }
    } else {
      if (tripActive) restoreSceneColors();
      modeTimer -= dt;
      if (modeTimer <= 0) nextMode();
    }

    releaseGhosts(dt);
    tickGhostPauses(dt);
    moveActor(pacman, dt, false);
    eatAtPacman();
    if (state !== "playing") return;

    ghosts.forEach((g) => {
      if (g.pauseTimer > 0) return;
      moveActor(g, dt, true);
    });
    collideGhosts();
  }

  function loop(ts, frame) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts || performance.now();
    if (state === "ready" || state === "paused" || state === "won" || state === "gameover" || state === "entername" || state === "levelselect") {
      flashTimer += dt;
      if (state === "entername") renderNameSlots();
    }
    if (state === "won") updateWinFx(dt);
    update(dt);
    tickMusic(dt);
    syncActors3D();
    updateCamera(dt || 0.016);
    updateArHitTest(frame);
    renderer.render(scene, camera);
  }

  function dirFromKey(key, code = "") {
    const k = key || "";
    const c = code || "";
    if (k === "ArrowLeft" || c === "ArrowLeft" || k === "a" || k === "A" || c === "KeyA") {
      return DIRS.LEFT;
    }
    if (k === "ArrowRight" || c === "ArrowRight" || k === "d" || k === "D" || c === "KeyD") {
      return DIRS.RIGHT;
    }
    if (k === "ArrowUp" || c === "ArrowUp" || k === "w" || k === "W" || c === "KeyW") {
      return DIRS.UP;
    }
    if (k === "ArrowDown" || c === "ArrowDown" || k === "s" || k === "S" || c === "KeyS") {
      return DIRS.DOWN;
    }
    return null;
  }

  function onStartAction() {
    if (state === "entername") {
      confirmNameEntry();
      return;
    }
    if (state === "levelselect") {
      confirmLevelSelect();
      return;
    }
    if (state === "ready") beginPlay();
    else if (state === "gameover") startLevel(true);
    else if (state === "won") {
      level += 1;
      saveLevel();
      startLevel(false);
    }
  }

  window.addEventListener(
    "keydown",
    (e) => {
      ensureAudio();
      if (state === "entername") {
        handleNameEntryKey(e);
        return;
      }
      if (state === "levelselect") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A" || e.code === "KeyA") {
          e.preventDefault();
          nudgeLevelPick(-1);
          return;
        }
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D" || e.code === "KeyD") {
          e.preventDefault();
          nudgeLevelPick(1);
          return;
        }
        if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
          e.preventDefault();
          nudgeLevelPick(1);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
          e.preventDefault();
          nudgeLevelPick(-1);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          confirmLevelSelect();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelLevelSelect();
          return;
        }
        return;
      }
      const dir = dirFromKey(e.key, e.code);
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
          hideScoreboard();
          setMusicMood("paused");
        } else if (state === "paused") {
          state = "playing";
          hideOverlay();
          setMusicMood(frightenedTimer > 0 ? "fright" : "chase");
        } else onStartAction();
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        tryJump();
      } else if (e.key === "t" || e.key === "T" || e.code === "KeyT") {
        e.preventDefault();
        if (e.repeat) return;
        cycleVlTone(1);
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        openLevelSelect();
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        if (state === "ready" || state === "gameover") {
          if (scoreboardEl && !scoreboardEl.classList.contains("hidden")) hideScoreboard();
          else renderScoreboard();
        }
      } else if (e.key === "Escape") {
        if (state === "entername") return;
        startLevel(true);
      }
    },
    { capture: true }
  );

  window.addEventListener(
    "keyup",
    (e) => {
      const dir = dirFromKey(e.key, e.code);
      if (dir && input.held && input.held.name === dir.name) input.held = null;
    },
    { capture: true }
  );

  stage.addEventListener(
    "touchstart",
    (e) => {
      ensureAudio();
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
      if (state === "ready" || state === "gameover" || state === "won") onStartAction();
      // ignore during entername / levelselect — use dedicated controls
    },
    { passive: true }
  );

  stage.addEventListener(
    "touchend",
    (e) => {
      if (state === "entername") {
        touchStart = null;
        return;
      }
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

  overlay.addEventListener("click", (e) => {
    if (state === "entername" || state === "levelselect") return;
    onStartAction();
  });
  stage.addEventListener("click", () => {
    if (state === "entername" || state === "levelselect") return;
    if (state === "ready" || state === "gameover" || state === "won") onStartAction();
  });

  if (jumpBtn) {
    jumpBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      tryJump();
    });
  }

  if (levelBtn) {
    levelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLevelSelect();
    });
  }

  const levelMinus = document.getElementById("level-minus");
  const levelPlus = document.getElementById("level-plus");
  const levelOk = document.getElementById("level-ok");
  if (levelMinus) levelMinus.addEventListener("click", (e) => { e.stopPropagation(); if (state === "levelselect") nudgeLevelPick(-1); });
  if (levelPlus) levelPlus.addEventListener("click", (e) => { e.stopPropagation(); if (state === "levelselect") nudgeLevelPick(1); });
  if (levelOk) levelOk.addEventListener("click", (e) => { e.stopPropagation(); if (state === "levelselect") confirmLevelSelect(); });

  const namePrev = document.getElementById("name-prev");
  const nameNext = document.getElementById("name-next");
  const nameUp = document.getElementById("name-up");
  const nameDown = document.getElementById("name-down");
  const nameOk = document.getElementById("name-ok");
  if (namePrev) namePrev.addEventListener("click", (e) => { e.stopPropagation(); if (state === "entername") moveNameCursor(-1); });
  if (nameNext) nameNext.addEventListener("click", (e) => { e.stopPropagation(); if (state === "entername") moveNameCursor(1); });
  if (nameUp) nameUp.addEventListener("click", (e) => { e.stopPropagation(); if (state === "entername") cycleNameChar(1); });
  if (nameDown) nameDown.addEventListener("click", (e) => { e.stopPropagation(); if (state === "entername") cycleNameChar(-1); });
  if (nameOk) nameOk.addEventListener("click", (e) => { e.stopPropagation(); if (state === "entername") confirmNameEntry(); });

  window.addEventListener("resize", resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(stage);
  }

  hiscores = loadHiscores();
  if (hiscores.length) highScore = hiscores[0].score;
  highEl.textContent = formatScore(highScore);
  syncHiscoresFromServer();
  updateJumpHud();
  updateToneHud();
  setupToneHud();
  resize();
  setupArButton();
  startLevel(true);
  lastTs = performance.now();
  renderer.setAnimationLoop(loop);
})();
