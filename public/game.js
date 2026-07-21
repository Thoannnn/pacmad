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

    // Dark throat so limbs aren't visible through the open mouth
    const throat = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 28),
      new THREE.MeshBasicMaterial({ color: 0x1a0800, side: THREE.DoubleSide })
    );
    throat.position.z = -0.02;
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
      pivot.position.set(side * 0.34, 0.02, -0.02);
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

    // Legs sit behind the body so they never show through the mouth
    function makeLeg(side) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.11, -0.3, -0.14);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.14, 4, 8), limbMat);
      thigh.position.y = -0.12;
      thigh.castShadow = true;
      pivot.add(thigh);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), limbMat);
      foot.position.set(0, -0.26, 0.02);
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

  function updatePacEyesLook() {
    const eyes = pacEyes || pacMesh?.userData?.eyes;
    if (!eyes || !pacMesh) return;
    const near = nearestGhost();
    let lookX = 0;
    let lookY = 0;
    let lookZ = 1;
    // Closer ghost → bigger eyes (calm at ~8 tiles, panic under ~2)
    let eyeScale = 1;
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
      const t = THREE.MathUtils.clamp(1 - (near.dist - 1.2) / 6.5, 0, 1);
      eyeScale = 1 + t * t * 1.35; // up to ~2.35x when very close
    }
    eyes.forEach((e) => {
      e.white.scale.setScalar(eyeScale);
      e.pupil.position.set(lookX * 0.05, lookY * 0.05, 0.08 + Math.max(0, lookZ) * 0.02);
    });
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

  /** Flat on table: keep world-up, only yaw from surface hit. */
  function applyBoardOnSurface(matrix, preview) {
    _arMat.copy(matrix);
    _arMat.decompose(_arPos, _arQuat, _arScl);
    board.position.copy(_arPos);
    board.position.y += 0.002; // sit on table, avoid z-fight
    // Flatten — horizontal tabletop (ignore surface tilt wobble)
    board.rotation.set(0, 0, 0);
    board.quaternion.identity();
    board.scale.setScalar(AR_SCALE);
    board.visible = true;
    if (!preview) {
      arPlaced = true;
      arPlaceMode = false;
      reticle.visible = false;
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
    // ~55cm ahead, ~40cm below eye ≈ table height
    board.position.copy(_arPos).addScaledVector(_arFwd, 0.55);
    board.position.y = _arPos.y - 0.42;
    board.rotation.set(0, Math.atan2(_arFwd.x, _arFwd.z), 0);
    board.scale.setScalar(AR_SCALE);
    board.visible = true;
    arPlaced = true;
    arPlaceMode = false;
    reticle.visible = false;
    return true;
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
    if (overlaySub) {
      overlaySub.textContent = "Look at table · Trigger to place · Squeeze = jump";
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
        arBtn.title = "WebXR AR — place maze on your table (Quest / mobile)";
        arBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleAr();
        });
      })
      .catch(showUnsupported);
  }

  function onXrSelect() {
    ensureAudio();
    // Place / move board onto surface under reticle
    if (arActive && reticle.visible) {
      applyBoardOnSurface(reticle.matrix, false);
      if (state === "ready") onStartAction();
      return;
    }
    if (state === "ready" || state === "gameover" || state === "won") onStartAction();
    else if (state === "playing") tryJump();
  }

  function onXrSqueeze() {
    if (state === "playing") tryJump();
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
          // Preview follow until confirmed with trigger
          if (!arPlaced) {
            applyBoardOnSurface(reticle.matrix, true);
            board.visible = true;
          }
        }
      }
    }

    if (!gotHit) {
      reticle.visible = false;
      // No surface yet: after 2.5s place a table-height board in front
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

  // --- Casio VL-Tone / VL-10 style engine ---
  // Voices inspired by VL-1/VL-10 multipulse square + linear envelopes + Po/Pi/Sha
  const N = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
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

  // Simple rock-ish VL pattern over 8 eighths: Po _ Pi Sha | Po _ Pi _
  function playVlRhythmHit(step) {
    const s = step % 8;
    if (s === 0) playPo();
    else if (s === 2) playPi();
    else if (s === 3) playSha();
    else if (s === 4) playPo();
    else if (s === 6) playPi();
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
    el.textContent = `TONE: ${currentVlTone().label}`;
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
    el.addEventListener("touchend", (e) => {
      e.preventDefault();
      cycle(e);
    }, { passive: false });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cycleVlTone(1);
      }
    });
  }

  function setMusicMood(mood) {
    if (!MUSIC[mood]) return;
    if (musicMood === mood && !MUSIC[mood].oneshot) return;
    musicMood = mood;
    musicStep = 0;
    musicAcc = 0;
    musicOneShot = false;
  }

  function tickMusic(dt) {
    if (!audioCtx || !musicMaster) return;

    const theme = MUSIC[musicMood] || MUSIC.ready;
    if (theme.oneshot && musicOneShot) return;

    let bpm = theme.bpm;
    if (musicMood === "fright" && frightenedMax > 0) {
      const life = Math.max(0, frightenedTimer / frightenedMax);
      bpm = 100 + life * 100;
    }

    const stepDur = 60 / bpm / 2;
    musicAcc += dt;
    const tone = currentVlTone();
    while (musicAcc >= stepDur) {
      musicAcc -= stepDur;
      const lead = theme.lead[musicStep % theme.lead.length];
      const bass = theme.bass[musicStep % theme.bass.length];
      const noteLen = stepDur * 0.9;
      if (lead) playVlTone(lead, noteLen, tone, 0.58);
      if (bass) playVlBass(bass, noteLen * 1.15, 0.42);
      if (theme.rhythm) playVlRhythmHit(musicStep);
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
      const dur = 0.38;
      // Low noisy "brrrp" — filtered noise + sliding square
      const buf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      let reg = 0xb00b;
      for (let i = 0; i < data.length; i++) {
        const env = Math.sin((i / data.length) * Math.PI) * (1 - i / data.length * 0.35);
        reg ^= reg << 7;
        reg ^= reg >>> 9;
        reg ^= reg << 8;
        const flutter = 0.55 + 0.45 * Math.sin(i * 0.09);
        data[i] = ((reg & 0xffff) / 0x8000 - 1) * env * flutter;
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(180, t0);
      filter.frequency.exponentialRampToValueAtTime(90, t0 + 0.12);
      filter.frequency.exponentialRampToValueAtTime(220, t0 + 0.28);
      filter.frequency.exponentialRampToValueAtTime(70, t0 + dur);
      const ng = audioCtx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(0.55, t0 + 0.02);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      const osc = audioCtx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(95, t0);
      osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.2);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + dur);
      const og = audioCtx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.9);

      noise.connect(filter);
      filter.connect(ng);
      ng.connect(audioCtx.destination);
      osc.connect(og);
      og.connect(audioCtx.destination);
      noise.start(t0);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
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
    if (tripActive) restoreSceneColors();
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
      state = "won";
      showOverlay("YOU WIN!", "Enter / Tap for next level", "win");
      setMusicMood("win");
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
          setMusicMood("gameover");
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
    moveActor(pacman, dt, false);
    eatAtPacman();
    if (state !== "playing") return;

    ghosts.forEach((g) => moveActor(g, dt, true));
    collideGhosts();
  }

  function loop(ts, frame) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts || performance.now();
    if (state === "ready" || state === "paused" || state === "won" || state === "gameover") {
      flashTimer += dt;
    }
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
    if (state === "ready") beginPlay();
    else if (state === "gameover") startLevel(true);
    else if (state === "won") {
      level += 1;
      startLevel(false);
    }
  }

  window.addEventListener(
    "keydown",
    (e) => {
      ensureAudio();
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
      } else if (e.key === "Escape") {
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
  updateToneHud();
  setupToneHud();
  resize();
  setupArButton();
  startLevel(true);
  lastTs = performance.now();
  renderer.setAnimationLoop(loop);
})();
