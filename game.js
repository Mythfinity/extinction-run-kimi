(() => {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const WORLD_WIDTH = 4700;
  const keys = new Set();
  const pressed = new Set();
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const random = (min, max) => min + Math.random() * (max - min);
  const padScore = (score) => Math.floor(score).toString().padStart(6, "0");

  const ui = {
    start: $("start-screen"),
    pause: $("pause-screen"),
    end: $("end-screen"),
    highScore: $("menu-high-score"),
    finalScore: $("final-score"),
    finalCombo: $("final-combo"),
    endTitle: $("end-title"),
    endEyebrow: $("end-eyebrow"),
    endMessage: $("end-message")
  };

  const fighterStats = {
    jack: { name: "JACK TENREC", color: "#e8e2cd", accent: "#a63e32", skin: "#d89c6d", hair: "#e9daba", speed: 225, power: 22, maxHealth: 110 },
    hannah: { name: "HANNAH DUNDEE", color: "#b94436", accent: "#263e45", skin: "#e2a277", hair: "#dbaa45", speed: 255, power: 18, maxHealth: 100 },
    mustapha: { name: "MUSTAPHA CAIRO", color: "#d0ae43", accent: "#eee5cc", skin: "#9d603d", hair: "#25221c", speed: 275, power: 17, maxHealth: 95 },
    mess: { name: "MESS O'BRADOVICH", color: "#517d69", accent: "#d5cfb7", skin: "#825039", hair: "#1d1c18", speed: 195, power: 28, maxHealth: 125 }
  };

  const encounters = [
    { trigger: 430, gate: 1190, name: "CITY OUTSKIRTS", objective: "BREAK THE BLOCKADE", enemies: ["thug", "thug", "raptor", "thug"] },
    { trigger: 1740, gate: 2530, name: "JUNGLE PASS", objective: "SURVIVE THE AMBUSH", enemies: ["raptor", "biker", "raptor", "biker", "thug"] },
    { trigger: 3230, gate: 4440, name: "THE OLD GARAGE", objective: "RESTORE THE BALANCE", enemies: ["boss"] }
  ];

  let mode = "menu";
  let selectedFighter = "jack";
  let player = null;
  let enemies = [];
  let crates = [];
  let pickups = [];
  let particles = [];
  let floaters = [];
  let decor = [];
  let camera = 0;
  let elapsed = 0;
  let runTime = 0;
  let score = 0;
  let combo = 0;
  let bestCombo = 0;
  let comboTimer = 0;
  let encounterIndex = 0;
  let encounterActive = false;
  let encounterDelay = 0;
  let screenShake = 0;
  let flash = 0;
  let banner = null;
  let highScore = Number(localStorage.getItem("cd-extinction-high-score") || 0);
  let lastTime = performance.now();
  let muted = localStorage.getItem("cd-extinction-muted") === "true";
  let audioContext = null;
  let musicTimer = null;
  let musicStep = 0;
  let endTimer = null;

  ui.highScore.textContent = padScore(highScore);
  $("audio-button").setAttribute("aria-pressed", String(muted));
  $("audio-button").setAttribute("aria-label", muted ? "Enable sound" : "Mute sound");

  function buildDecor() {
    decor = [];
    let seed = 173;
    const seeded = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let x = 80; x < WORLD_WIDTH; x += 90 + seeded() * 110) {
      decor.push({ x, type: seeded() > 0.56 ? "fern" : "grass", y: 305 + seeded() * 175, size: 0.6 + seeded() * 0.8, shade: seeded() });
    }
  }
  buildDecor();

  function createPlayer() {
    const stats = fighterStats[selectedFighter];
    return {
      kind: "player", x: 180, y: 407, z: 0, vz: 0, facing: 1,
      health: stats.maxHealth, maxHealth: stats.maxHealth, speed: stats.speed, power: stats.power,
      state: "idle", timer: 0, attackStep: 0, attackQueued: false, attackHit: false,
      invulnerable: 0, hurtTimer: 0, walkTime: 0, dead: false, color: stats.color,
      accent: stats.accent, skin: stats.skin, hair: stats.hair, name: stats.name
    };
  }

  function createEnemy(kind, x, y) {
    const templates = {
      thug: { health: 55, speed: 82, power: 9, color: "#885447", accent: "#282f32", skin: "#bd815b", points: 500, scale: 1 },
      biker: { health: 85, speed: 70, power: 13, color: "#4c526b", accent: "#b9983f", skin: "#b87850", points: 800, scale: 1.08 },
      raptor: { health: 60, speed: 124, power: 10, color: "#9ea944", accent: "#415a36", skin: "#9ea944", points: 700, scale: 1 },
      boss: { health: 480, speed: 77, power: 18, color: "#a95d38", accent: "#e6bc62", skin: "#a95d38", points: 5000, scale: 1.8 }
    };
    const t = templates[kind];
    return {
      kind, x, y, z: 0, vz: 0, facing: x > player.x ? -1 : 1,
      health: t.health, maxHealth: t.health, speed: t.speed, power: t.power,
      color: t.color, accent: t.accent, skin: t.skin, points: t.points, scale: t.scale,
      state: "enter", timer: 0.5, attackHit: false, cooldown: random(1.2, 2.1),
      hurtTimer: 0, dead: false, removeTimer: 0, walkTime: random(0, 5), phase: 1
    };
  }

  function resetGame() {
    clearTimeout(endTimer);
    player = createPlayer();
    enemies = [];
    pickups = [];
    particles = [];
    floaters = [];
    crates = [
      { x: 710, y: 376, health: 45, dead: false },
      { x: 1060, y: 438, health: 45, dead: false },
      { x: 1560, y: 392, health: 45, dead: false },
      { x: 2200, y: 352, health: 45, dead: false },
      { x: 2890, y: 430, health: 45, dead: false },
      { x: 3810, y: 374, health: 45, dead: false }
    ];
    camera = 0;
    runTime = 0;
    score = 0;
    combo = 0;
    bestCombo = 0;
    comboTimer = 0;
    encounterIndex = 0;
    encounterActive = false;
    encounterDelay = 0;
    screenShake = 0;
    flash = 0;
    banner = { title: "CHAPTER 1", subtitle: "THE OLD HIGHWAY", timer: 2.8, max: 2.8 };
  }

  function startGame() {
    initAudio();
    resetGame();
    mode = "playing";
    ui.start.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.end.classList.add("hidden");
    canvas.focus({ preventScroll: true });
    playSound("start");
    startMusic();
  }

  function showMenu() {
    clearTimeout(endTimer);
    mode = "menu";
    stopMusic();
    ui.end.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.start.classList.remove("hidden");
    ui.highScore.textContent = padScore(highScore);
    keys.clear();
    pressed.clear();
  }

  function togglePause(forceResume = false) {
    if (mode !== "playing" && mode !== "paused") return;
    const resume = forceResume || mode === "paused";
    mode = resume ? "playing" : "paused";
    ui.pause.classList.toggle("hidden", resume);
    keys.clear();
    pressed.clear();
    if (resume) {
      canvas.focus({ preventScroll: true });
      lastTime = performance.now();
      startMusic();
    } else {
      stopMusic();
    }
  }

  function finishGame(victory) {
    if (mode !== "playing") return;
    mode = victory ? "victory" : "gameover";
    stopMusic();
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("cd-extinction-high-score", String(highScore));
    }
    ui.endEyebrow.textContent = victory ? "THE HIGHWAY IS SAFE" : "THE JUNGLE CLAIMS ANOTHER";
    ui.endTitle.textContent = victory ? "RUN COMPLETE" : "GAME OVER";
    ui.endMessage.textContent = victory ? "The Tyrant has fallen. For now, the balance is restored." : "The poachers won this round. Get back up and take back the road.";
    ui.finalScore.textContent = padScore(score);
    ui.finalCombo.textContent = `${bestCombo}×`;
    ui.end.classList.remove("hidden");
    playSound(victory ? "victory" : "gameover");
  }

  function startEncounter() {
    const encounter = encounters[encounterIndex];
    encounterActive = true;
    banner = { title: encounter.name, subtitle: encounter.objective, timer: 2.6, max: 2.6 };
    encounter.enemies.forEach((kind, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const x = side === 1 ? encounter.gate - 100 - (i % 3) * 80 : player.x + 70 + i * 30;
      const y = 350 + (i % 3) * 52;
      enemies.push(createEnemy(kind, kind === "boss" ? encounter.gate - 310 : x, y));
    });
    playSound(encounterIndex === 2 ? "boss" : "alert");
  }

  function completeEncounter() {
    encounterActive = false;
    const bossDefeated = encounterIndex === encounters.length - 1;
    score += bossDefeated ? 5000 : 1500;
    if (!bossDefeated) {
      banner = { title: "AREA CLEAR", subtitle: "THE ROAD IS OPEN  →", timer: 2.6, max: 2.6 };
      pickups.push({ kind: "food", x: player.x + 95, y: player.y, z: 0, life: 20 });
      encounterIndex++;
      playSound("clear");
    } else {
      banner = { title: "BALANCE RESTORED", subtitle: "THE TYRANT HAS FALLEN", timer: 3, max: 3 };
      endTimer = setTimeout(() => finishGame(true), 2600);
    }
  }

  function spawnParticles(x, y, color, count = 8, force = 1) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y, z: random(15, 65), vx: random(-150, 150) * force, vz: random(60, 220) * force,
        vy: random(-25, 25), life: random(0.25, 0.65), maxLife: 0.65, color, size: random(2, 6), gravity: 420
      });
    }
  }

  function addFloater(x, y, text, color = "#f5efcf", size = 18) {
    floaters.push({ x, y, text, color, size, life: 0.85 });
  }

  function registerHit(points) {
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    comboTimer = 2.1;
    score += Math.round(points * (1 + Math.min(combo, 20) * 0.04));
  }

  function hitEnemy(enemy, damage, knockback, heavy = false) {
    if (enemy.dead || enemy.state === "enter") return;
    enemy.health -= damage;
    enemy.hurtTimer = heavy ? 0.48 : 0.25;
    enemy.state = enemy.health <= 0 ? "dead" : "hurt";
    enemy.timer = enemy.health <= 0 ? 1.1 : enemy.hurtTimer;
    enemy.x += player.facing * knockback * 0.25;
    enemy.vx = player.facing * knockback;
    enemy.vz = heavy ? (enemy.kind === "boss" ? 80 : 190) : 60;
    enemy.dead = enemy.health <= 0;
    enemy.removeTimer = enemy.kind === "boss" ? 3.5 : 1.4;
    registerHit(enemy.points / 8);
    spawnParticles(enemy.x, enemy.y, heavy ? "#f2d35e" : "#e9e2b7", heavy ? 14 : 7, heavy ? 1.4 : 1);
    addFloater(enemy.x, enemy.y - 75, `+${Math.round(enemy.points / 8)}`, "#f0df77", 15);
    screenShake = Math.max(screenShake, heavy ? 10 : 4);
    playSound(heavy ? "heavy" : "hit");
    if (enemy.dead) {
      score += enemy.points;
      addFloater(enemy.x, enemy.y - 100, enemy.kind === "boss" ? "TYRANT DOWN!" : "K.O.", "#d9f24b", 22);
      if (enemy.kind !== "boss" && Math.random() < 0.15) pickups.push({ kind: "food", x: enemy.x, y: enemy.y, z: 20, life: 15 });
    }
  }

  function hurtPlayer(damage, sourceX) {
    if (player.invulnerable > 0 || player.z > 45 || player.dead || mode !== "playing") return;
    player.health = Math.max(0, player.health - damage);
    player.invulnerable = 1;
    player.state = "hurt";
    player.hurtTimer = 0.38;
    player.vx = sourceX < player.x ? 170 : -170;
    combo = 0;
    screenShake = 9;
    flash = 0.12;
    spawnParticles(player.x, player.y, "#ed8352", 9);
    playSound("hurt");
    if (player.health <= 0) {
      player.dead = true;
      player.state = "dead";
      player.timer = 1.5;
      endTimer = setTimeout(() => finishGame(false), 1300);
    }
  }

  function attackCrate(crate, damage) {
    if (crate.dead) return;
    crate.health -= damage;
    spawnParticles(crate.x, crate.y, "#b8864c", 6);
    if (crate.health <= 0) {
      crate.dead = true;
      score += 150;
      spawnParticles(crate.x, crate.y, "#d3a45f", 20, 1.5);
      pickups.push({ kind: Math.random() > 0.35 ? "food" : "coin", x: crate.x, y: crate.y, z: 35, life: 18 });
      playSound("break");
    } else {
      playSound("hit");
    }
  }

  function performPlayerHit(heavy = false, special = false) {
    const range = special ? 155 : 76 + player.attackStep * 10;
    let connected = false;
    enemies.forEach((enemy) => {
      const dx = enemy.x - player.x;
      const dy = Math.abs(enemy.y - player.y);
      const inFront = special || Math.sign(dx || player.facing) === player.facing;
      const sizeBonus = enemy.kind === "boss" ? 65 : enemy.kind === "raptor" ? 20 : 0;
      if (!enemy.dead && Math.abs(dx) < range + sizeBonus && dy < (special ? 85 : 45) && inFront) {
        hitEnemy(enemy, player.power * (special ? 1.5 : heavy ? 1.45 : 1), special ? 270 : heavy ? 240 : 100, heavy || special);
        connected = true;
      }
    });
    crates.forEach((crate) => {
      const dx = crate.x - player.x;
      if (!crate.dead && Math.abs(dx) < range && Math.abs(crate.y - player.y) < 45 && (special || Math.sign(dx || player.facing) === player.facing)) {
        attackCrate(crate, player.power * (heavy ? 1.5 : 1));
        connected = true;
      }
    });
    if (!connected && !special) playSound("swing");
  }

  function startSpecial() {
    if (player.health <= 12 || player.state === "special" || player.state === "hurt" || player.dead) return;
    player.state = "special";
    player.timer = 0.7;
    player.attackHit = false;
    player.invulnerable = 0.85;
    player.health -= 6;
    combo = 0;
    playSound("special");
  }

  function updatePlayer(dt) {
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.walkTime += dt;
    if (player.dead) {
      player.timer -= dt;
      return;
    }

    if (player.state === "hurt") {
      player.hurtTimer -= dt;
      player.x += player.vx * dt;
      player.vx *= Math.pow(0.03, dt);
      if (player.hurtTimer <= 0) player.state = "idle";
    } else if (player.state === "special") {
      player.timer -= dt;
      if (!player.attackHit && player.timer < 0.46) {
        player.attackHit = true;
        performPlayerHit(true, true);
        spawnParticles(player.x, player.y, "#d9f24b", 30, 2);
        screenShake = 13;
      }
      if (player.timer <= 0) player.state = "idle";
    } else if (player.state === "attack") {
      player.timer -= dt;
      const hitMoment = player.attackStep === 3 ? 0.27 : 0.19;
      if (!player.attackHit && player.timer <= hitMoment) {
        player.attackHit = true;
        performPlayerHit(player.attackStep === 3);
        player.x += player.facing * (player.attackStep === 3 ? 13 : 7);
      }
      if (pressed.has("KeyJ")) player.attackQueued = true;
      if (player.timer <= 0) {
        if (player.attackQueued && player.attackStep < 3) {
          player.attackStep++;
          player.timer = player.attackStep === 3 ? 0.49 : 0.34;
          player.attackHit = false;
          player.attackQueued = false;
        } else {
          player.state = "idle";
          player.attackStep = 0;
          player.attackQueued = false;
        }
      }
    } else {
      if (pressed.has("KeyL")) {
        startSpecial();
      } else if (pressed.has("KeyJ")) {
        const nearest = enemies.filter((enemy) => !enemy.dead && Math.abs(enemy.x - player.x) < 105 && Math.abs(enemy.y - player.y) < 55).sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
        if (nearest) player.facing = nearest.x >= player.x ? 1 : -1;
        player.state = "attack";
        player.attackStep = 1;
        player.timer = 0.34;
        player.attackHit = false;
        player.attackQueued = false;
      } else if (pressed.has("KeyK") && player.z === 0) {
        player.vz = 390;
        playSound("jump");
      }
    }

    const canMove = player.state === "idle" || player.state === "walk" || player.state === "attack";
    if (canMove && !player.dead) {
      let dx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
      let dy = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
      const length = Math.hypot(dx, dy) || 1;
      dx /= length;
      dy /= length;
      const moveScale = player.state === "attack" ? 0.25 : 1;
      if (dx || dy) {
        player.x += dx * player.speed * moveScale * dt;
        player.y += dy * player.speed * 0.6 * moveScale * dt;
        if (dx) player.facing = Math.sign(dx);
        if (player.state !== "attack") player.state = "walk";
      } else if (player.state === "walk") {
        player.state = "idle";
      }
    }

    if (player.z > 0 || player.vz > 0) {
      player.z += player.vz * dt;
      player.vz -= 930 * dt;
      if (player.z <= 0) {
        player.z = 0;
        player.vz = 0;
        spawnParticles(player.x, player.y, "#a59c74", 4, 0.5);
      }
    }

    const leftBound = encounterActive ? camera + 35 : Math.max(30, camera - 40);
    const rightBound = encounterActive ? encounters[encounterIndex].gate - 35 : WORLD_WIDTH - 70;
    player.x = clamp(player.x, leftBound, rightBound);
    player.y = clamp(player.y, 329, 466);
  }

  function updateEnemy(enemy, dt) {
    enemy.walkTime += dt;
    enemy.cooldown -= dt;
    if (enemy.dead) {
      enemy.removeTimer -= dt;
      enemy.z = Math.max(0, enemy.z + enemy.vz * dt);
      enemy.vz -= 700 * dt;
      enemy.x += (enemy.vx || 0) * dt;
      enemy.vx *= Math.pow(0.06, dt);
      return;
    }
    if (enemy.state === "enter") {
      enemy.timer -= dt;
      if (enemy.timer <= 0) enemy.state = "idle";
      return;
    }
    if (enemy.state === "hurt") {
      enemy.hurtTimer -= dt;
      enemy.x += (enemy.vx || 0) * dt;
      enemy.vx *= Math.pow(0.02, dt);
      enemy.z = Math.max(0, enemy.z + enemy.vz * dt);
      enemy.vz -= 700 * dt;
      if (enemy.hurtTimer <= 0) enemy.state = "idle";
      return;
    }
    if (enemy.state === "attack") {
      enemy.timer -= dt;
      const hitAt = enemy.kind === "boss" ? 0.42 : 0.28;
      if (!enemy.attackHit && enemy.timer <= hitAt) {
        enemy.attackHit = true;
        const range = enemy.kind === "boss" ? 135 : enemy.kind === "raptor" ? 85 : 70;
        if (Math.abs(player.x - enemy.x) < range && Math.abs(player.y - enemy.y) < 43) hurtPlayer(enemy.power, enemy.x);
        if (enemy.kind === "boss") {
          screenShake = 8;
          spawnParticles(enemy.x + enemy.facing * 65, enemy.y, "#c5aa6c", 10);
        }
      }
      if (enemy.timer <= 0) {
        enemy.state = "idle";
        enemy.cooldown = enemy.kind === "boss" ? random(0.55, 0.95) : random(0.8, 1.55);
      }
      return;
    }

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    enemy.facing = dx >= 0 ? 1 : -1;
    const attackRange = enemy.kind === "boss" ? 125 : enemy.kind === "raptor" ? 74 : 58;
    const playerTargetable = !player.dead && player.z < 55;
    const anotherEnemyAttacking = enemies.some((other) => other !== enemy && !other.dead && other.state === "attack");
    if (Math.abs(dx) < attackRange && Math.abs(dy) < 35 && enemy.cooldown <= 0 && playerTargetable && (!anotherEnemyAttacking || enemy.kind === "boss")) {
      enemy.state = "attack";
      enemy.timer = enemy.kind === "boss" ? 0.85 : enemy.kind === "raptor" ? 0.48 : 0.6;
      enemy.attackHit = false;
      if (enemy.kind === "boss") playSound("roar");
    } else {
      const phaseBoost = enemy.kind === "boss" && enemy.health < enemy.maxHealth * 0.5 ? 1.35 : 1;
      const length = Math.hypot(dx, dy * 1.5) || 1;
      let moveX = dx / length;
      let moveY = (dy * 1.5) / length;
      if (Math.abs(dx) < attackRange * 0.75) moveX = 0;
      enemy.x += moveX * enemy.speed * phaseBoost * dt;
      enemy.y += moveY * enemy.speed * 0.48 * phaseBoost * dt;
      enemy.y = clamp(enemy.y, 330, 465);
      enemy.state = "walk";
    }
  }

  function updateWorld(dt) {
    runTime += dt;
    if (banner) {
      banner.timer -= dt;
      if (banner.timer <= 0) banner = null;
    }
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }
    screenShake = Math.max(0, screenShake - dt * 28);
    flash = Math.max(0, flash - dt);

    updatePlayer(dt);
    enemies.forEach((enemy) => updateEnemy(enemy, dt));
    enemies = enemies.filter((enemy) => !enemy.dead || enemy.removeTimer > 0);

    pickups.forEach((pickup) => {
      pickup.life -= dt;
      if (pickup.z > 0) pickup.z = Math.max(0, pickup.z - 100 * dt);
      if (Math.abs(player.x - pickup.x) < 34 && Math.abs(player.y - pickup.y) < 32 && !player.dead) {
        if (pickup.kind === "food") {
          const healed = Math.min(28, player.maxHealth - player.health);
          player.health += healed;
          addFloater(player.x, player.y - 100, healed > 0 ? `HEALTH +${healed}` : "+500", "#d9f24b");
          score += healed > 0 ? 100 : 500;
        } else {
          score += 750;
          addFloater(player.x, player.y - 100, "+750", "#f1cf53");
        }
        pickup.life = 0;
        playSound("pickup");
      }
    });
    pickups = pickups.filter((pickup) => pickup.life > 0);

    particles.forEach((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= p.gravity * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.25; p.vx *= 0.6; }
    });
    particles = particles.filter((p) => p.life > 0);
    floaters.forEach((f) => { f.life -= dt; f.y -= 30 * dt; });
    floaters = floaters.filter((f) => f.life > 0);

    const encounter = encounters[encounterIndex];
    if (!encounterActive && encounter && player.x >= encounter.trigger && encounterDelay <= 0) startEncounter();
    if (encounterActive && enemies.every((enemy) => enemy.dead)) {
      encounterDelay += dt;
      if (encounterDelay > 1.2) {
        encounterDelay = 0;
        completeEncounter();
      }
    } else {
      encounterDelay = 0;
    }

    const targetCamera = clamp(player.x - 280, 0, WORLD_WIDTH - W);
    camera = lerp(camera, targetCamera, 1 - Math.pow(0.0005, dt));
    if (encounterActive) camera = clamp(camera, Math.max(0, encounter.trigger - 430), encounter.gate - W + 80);
  }

  function update(dt) {
    elapsed += dt;
    if (mode === "playing") updateWorld(dt);
    else if (mode === "menu") camera = (Math.sin(elapsed * 0.08) + 1) * 110;
    pressed.clear();
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function text(value, x, y, size, color = "#fff", align = "left", font = "Barlow Condensed") {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px "${font}", Impact, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(value, Math.round(x), Math.round(y));
  }

  function drawBackground() {
    const zone = camera < 1350 ? 0 : camera < 2800 ? 1 : 2;
    const skyTop = zone === 2 ? "#243335" : zone === 1 ? "#466b65" : "#68877a";
    const skyBottom = zone === 2 ? "#a47c54" : "#c6b877";
    const gradient = ctx.createLinearGradient(0, 0, 0, 330);
    gradient.addColorStop(0, skyTop);
    gradient.addColorStop(1, skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(235,220,157,.22)";
    ctx.beginPath();
    ctx.arc(zone === 2 ? 735 : 710, 100, 52, 0, Math.PI * 2);
    ctx.fill();

    const farOffset = -(camera * 0.12) % 480;
    ctx.fillStyle = zone === 1 ? "#294f47" : "#405e51";
    for (let i = -1; i < 4; i++) {
      const x = farOffset + i * 480;
      ctx.beginPath();
      ctx.moveTo(x, 270);
      ctx.lineTo(x + 85, 140);
      ctx.lineTo(x + 145, 205);
      ctx.lineTo(x + 255, 92);
      ctx.lineTo(x + 355, 210);
      ctx.lineTo(x + 480, 145);
      ctx.lineTo(x + 520, 280);
      ctx.closePath();
      ctx.fill();
    }

    const midOffset = -(camera * 0.28) % 620;
    for (let i = -1; i < 3; i++) {
      const x = midOffset + i * 620;
      if (zone === 0) drawCity(x);
      else if (zone === 1) drawJungle(x);
      else drawGarageBack(x);
    }

    rect(0, 275, W, 265, "#5f6851");
    rect(0, 300, W, 240, "#8a8769");
    rect(0, 315, W, 225, "#999174");
    rect(0, 321, W, 3, "rgba(229,215,164,.28)");
    for (let i = 0; i < 30; i++) {
      const worldX = Math.floor((camera + i * 83) / 83) * 83;
      const sx = worldX - camera;
      const sy = 340 + ((worldX * 13) % 175);
      rect(sx, sy, 18 + (worldX % 26), 2, "rgba(73,70,53,.18)");
    }
    rect(0, 499, W, 41, "#454c3d");
    rect(0, 499, W, 4, "#b2a77c");
    for (let x = -((camera * 1.1) % 150); x < W; x += 150) rect(x, 518, 75, 3, "#73765a");
  }

  function drawCity(x) {
    rect(x + 15, 170, 140, 115, "#56685a");
    rect(x + 28, 150, 95, 135, "#607263");
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) rect(x + 38 + i * 21, 168 + j * 28, 9, 14, "#303f36");
    rect(x + 200, 205, 170, 80, "#455a4e");
    rect(x + 215, 187, 115, 14, "#394b41");
    text("GAS", x + 250, 225, 21, "#a5aa79", "center");
    rect(x + 400, 162, 13, 123, "#34493e");
    rect(x + 386, 163, 42, 9, "#3d5144");
    ctx.strokeStyle = "#33483d";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 405, 166); ctx.lineTo(x + 610, 200); ctx.stroke();
    drawPalm(x + 520, 277, 0.9);
  }

  function drawJungle(x) {
    for (let i = 0; i < 5; i++) drawPalm(x + 40 + i * 135, 290, 0.85 + (i % 2) * 0.25);
    rect(x, 275, 620, 18, "#244538");
  }

  function drawGarageBack(x) {
    rect(x + 35, 155, 440, 135, "#3c4942");
    rect(x + 48, 177, 416, 113, "#4b5548");
    for (let i = 0; i < 6; i++) rect(x + 52, 187 + i * 17, 407, 3, "#303b35");
    rect(x + 115, 126, 230, 42, "#28372f");
    text("OLD HIGHWAY GARAGE", x + 230, 147, 18, "#c1b477", "center");
    drawPalm(x + 535, 286, 1.1);
  }

  function drawPalm(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = "#344a36";
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-12, -65, 3, -120); ctx.stroke();
    ctx.strokeStyle = "#2b4938";
    ctx.lineWidth = 9;
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(3, -120); ctx.quadraticCurveTo(Math.cos(angle) * 38, -128 + Math.sin(angle) * 20, Math.cos(angle) * 63, -109 + Math.sin(angle) * 38); ctx.stroke();
    }
    ctx.restore();
  }

  function drawDecor() {
    decor.forEach((item) => {
      const x = item.x - camera;
      if (x < -50 || x > W + 50) return;
      ctx.save();
      ctx.translate(x, item.y);
      ctx.scale(item.size, item.size);
      if (item.type === "fern") {
        ctx.strokeStyle = item.shade > 0.5 ? "#425a35" : "#55643b";
        ctx.lineWidth = 4;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo((i - 2) * 11, -18, (i - 2) * 17, -28 + Math.abs(i - 2) * 6); ctx.stroke();
        }
      } else {
        rect(-9, -4, 19, 4, "#66704a");
        rect(-4, -10, 4, 10, "#66704a");
        rect(4, -7, 3, 7, "#66704a");
      }
      ctx.restore();
    });
  }

  function drawShadow(entity, width) {
    ctx.fillStyle = `rgba(27,31,22,${entity.z > 0 ? 0.17 : 0.28})`;
    ctx.beginPath();
    ctx.ellipse(entity.x - camera, entity.y + 3, width * (1 - Math.min(entity.z, 200) / 500), width * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHumanoid(e, isPlayer = false) {
    const scale = e.scale || 1;
    const x = e.x - camera;
    const y = e.y - e.z;
    const walk = e.state === "walk" ? Math.sin(e.walkTime * 13) : 0;
    const attacking = e.state === "attack";
    const special = e.state === "special";
    const dead = e.dead || e.state === "dead";
    const hurt = e.state === "hurt";
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(e.facing * scale, scale);
    if (dead) { ctx.rotate(-Math.PI / 2); ctx.translate(-15, -25); }
    if (hurt) ctx.rotate(-0.12);
    if (special) ctx.rotate((0.7 - e.timer) * 18);

    const alpha = isPlayer && e.invulnerable > 0 && Math.floor(e.invulnerable * 14) % 2 === 0 ? 0.45 : 1;
    ctx.globalAlpha = alpha;
    const skin = e.skin;
    const shirt = e.color;
    const pants = isPlayer ? (selectedFighter === "hannah" ? "#334c51" : "#3d4a48") : e.accent;
    const boot = "#282923";
    const step = walk * 7;
    rect(-19 + step, -42, 15, 39, pants);
    rect(5 - step, -42, 15, 39, pants);
    rect(-22 + step, -10, 20, 9, boot);
    rect(4 - step, -10, 21, 9, boot);
    rect(-22, -83, 43, 46, shirt);
    rect(-19, -43, 38, 7, "#292e27");
    rect(-3, -44, 8, 7, "#b49a54");
    if (isPlayer && selectedFighter === "jack") {
      rect(-22, -81, 11, 37, "#a54034");
      rect(11, -81, 11, 37, "#a54034");
    }
    if (isPlayer && selectedFighter === "mustapha") rect(-22, -83, 43, 8, e.accent);
    rect(-25, -104, 35, 30, skin);
    rect(-24, -110, 35, 12, e.hair);
    rect(6, -96, 4, 4, "#24231d");
    rect(8, -85, 8, 3, "#6f4532");
    if (isPlayer && selectedFighter === "hannah") {
      rect(-30, -108, 11, 38, e.hair);
      rect(-29, -78, 8, 19, e.hair);
    }

    if (attacking) {
      const attackDuration = isPlayer ? (e.attackStep === 3 ? 0.49 : 0.34) : (e.kind === "biker" ? 0.6 : 0.6);
      const progress = 1 - e.timer / attackDuration;
      const extension = Math.sin(clamp(progress, 0, 1) * Math.PI) * (isPlayer && e.attackStep === 3 ? 53 : 43);
      rect(12, -77, 22 + extension, 13, shirt);
      rect(30 + extension, -76, 14, 13, skin);
      rect(-28, -73, 13, 33, shirt);
      if (isPlayer && e.attackStep === 3) {
        rect(25 + extension, -82, 22, 23, "rgba(231,235,185,.35)");
      }
    } else {
      rect(-33, -78 + walk * 2, 13, 38, shirt);
      rect(20, -78 - walk * 2, 13, 38, shirt);
      rect(-32, -46 + walk * 2, 12, 12, skin);
      rect(21, -46 - walk * 2, 12, 12, skin);
    }
    if (!isPlayer && e.kind === "thug") {
      rect(-26, -111, 38, 7, "#2a2b25");
      rect(8, -102, 12, 4, "#2a2b25");
    }
    if (!isPlayer && e.kind === "biker") {
      rect(-28, -110, 43, 10, "#b7a149");
      rect(-26, -79, 48, 8, "#b7a149");
    }
    ctx.restore();
  }

  function drawRaptor(e) {
    const x = e.x - camera;
    const y = e.y - e.z;
    const walk = Math.sin(e.walkTime * 16) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(e.facing * 1.12, 1.12);
    if (e.dead) { ctx.rotate(-1.25); ctx.translate(0, -20); }
    if (e.state === "hurt") ctx.rotate(-0.15);
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = 13;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-18, -43); ctx.quadraticCurveTo(-58, -53, -91, -27); ctx.stroke();
    rect(-30, -67, 65, 37, e.color);
    rect(19, -90, 25, 50, e.color);
    rect(28, -104, 52, 26, e.color);
    rect(63, -87, 21, 9, e.accent);
    rect(63, -97, 5, 5, "#eee09b");
    rect(67, -96, 3, 3, "#19241b");
    for (let i = 0; i < 4; i++) rect(43 + i * 8, -80, 4, 6, "#ede1b5");
    rect(-18 + walk, -37, 13, 34, e.accent);
    rect(11 - walk, -37, 13, 34, e.accent);
    rect(-22 + walk, -9, 28, 8, "#394932");
    rect(8 - walk, -9, 28, 8, "#394932");
    if (e.state === "attack") {
      rect(30, -58, 40, 9, e.color);
      rect(62, -55, 9, 7, "#e5d8a2");
    }
    ctx.restore();
  }

  function drawBoss(e) {
    const x = e.x - camera;
    const y = e.y - e.z;
    const walk = Math.sin(e.walkTime * 9) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(e.facing * 1.3, 1.3);
    if (e.dead) { ctx.rotate(-1.15); ctx.translate(-20, -20); }
    if (e.state === "hurt") ctx.rotate(-0.06);
    ctx.strokeStyle = "#75442f";
    ctx.lineWidth = 25;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-45, -73); ctx.quadraticCurveTo(-110, -85, -155, -38); ctx.stroke();
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.ellipse(-8, -77, 68, 52, 0, 0, Math.PI * 2); ctx.fill();
    rect(22, -135, 42, 73, e.color);
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.moveTo(34, -145); ctx.lineTo(113, -137); ctx.lineTo(124, -108); ctx.lineTo(52, -91); ctx.closePath(); ctx.fill();
    rect(70, -113, 58, 16, "#6f3e2d");
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = "#eadca9";
      ctx.beginPath(); ctx.moveTo(68 + i * 9, -111); ctx.lineTo(73 + i * 9, -99); ctx.lineTo(77 + i * 9, -111); ctx.fill();
    }
    rect(86, -132, 9, 8, "#f1ce54");
    rect(90, -131, 4, 5, "#171c16");
    rect(-43 + walk, -51, 26, 48, "#854c33");
    rect(12 - walk, -51, 27, 48, "#854c33");
    rect(-51 + walk, -10, 47, 10, "#503b2c");
    rect(7 - walk, -10, 48, 10, "#503b2c");
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = e.accent;
      ctx.beginPath(); ctx.moveTo(-52 + i * 20, -119 + Math.abs(i - 2) * 6); ctx.lineTo(-43 + i * 20, -139 + Math.abs(i - 2) * 5); ctx.lineTo(-32 + i * 20, -119 + Math.abs(i - 2) * 6); ctx.fill();
    }
    if (e.state === "attack") {
      ctx.strokeStyle = "#b87545";
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(30, -86); ctx.lineTo(75, -57); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCrate(crate) {
    if (crate.dead) return;
    const x = crate.x - camera;
    drawShadow(crate, 28);
    rect(x - 25, crate.y - 50, 50, 49, "#87643e");
    rect(x - 22, crate.y - 47, 44, 41, "#aa7e47");
    rect(x - 25, crate.y - 50, 50, 6, "#c09355");
    rect(x - 25, crate.y - 9, 50, 7, "#664b32");
    ctx.strokeStyle = "#6f4e30";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x - 19, crate.y - 42); ctx.lineTo(x + 19, crate.y - 12); ctx.moveTo(x + 19, crate.y - 42); ctx.lineTo(x - 19, crate.y - 12); ctx.stroke();
  }

  function drawPickup(pickup) {
    const x = pickup.x - camera;
    const bob = Math.sin(elapsed * 5 + pickup.x) * 4;
    const y = pickup.y - pickup.z - 13 + bob;
    ctx.save();
    ctx.shadowColor = pickup.kind === "food" ? "#d9f24b" : "#f3ce4e";
    ctx.shadowBlur = 15;
    if (pickup.kind === "food") {
      rect(x - 17, y - 8, 29, 18, "#d47d45");
      rect(x - 11, y - 12, 24, 18, "#e7a052");
      rect(x + 10, y - 3, 16, 7, "#e7dfc1");
      rect(x + 22, y - 7, 7, 14, "#e7dfc1");
    } else {
      ctx.fillStyle = "#e9c64e";
      ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
      text("$", x, y + 1, 15, "#725a20", "center");
    }
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      rect(p.x - camera, p.y - p.z, p.size, p.size, p.color);
    });
    ctx.globalAlpha = 1;
    floaters.forEach((f) => {
      ctx.globalAlpha = clamp(f.life * 2, 0, 1);
      text(f.text, f.x - camera, f.y - 85, f.size, f.color, "center");
    });
    ctx.globalAlpha = 1;
  }

  function drawWorld() {
    drawBackground();
    drawDecor();
    if (mode === "menu") {
      drawCar(690 - camera * 0.3, 380);
      const demoRaptor = { x: 850 + camera, y: 440, z: 0, facing: -1, state: "idle", walkTime: elapsed, color: "#879640", accent: "#3d5537", dead: false };
      drawShadow(demoRaptor, 47);
      drawRaptor(demoRaptor);
      return;
    }

    const renderables = [];
    crates.forEach((crate) => { if (!crate.dead) renderables.push({ y: crate.y, draw: () => drawCrate(crate) }); });
    pickups.forEach((pickup) => renderables.push({ y: pickup.y, draw: () => drawPickup(pickup) }));
    enemies.forEach((enemy) => renderables.push({ y: enemy.y, draw: () => {
      drawShadow(enemy, enemy.kind === "boss" ? 85 : enemy.kind === "raptor" ? 45 : 24);
      if (enemy.kind === "raptor") drawRaptor(enemy);
      else if (enemy.kind === "boss") drawBoss(enemy);
      else drawHumanoid(enemy);
    } }));
    renderables.push({ y: player.y, draw: () => { drawShadow(player, 25); drawHumanoid(player, true); } });
    renderables.sort((a, b) => a.y - b.y).forEach((item) => item.draw());
    drawParticles();

    if (encounterActive) drawGate(encounters[encounterIndex].gate);
  }

  function drawCar(x, y) {
    ctx.save();
    ctx.translate(x, y);
    drawShadow({ x: x + camera, y, z: 0 }, 112);
    ctx.fillStyle = "#a83d31";
    ctx.beginPath(); ctx.moveTo(-110, -27); ctx.lineTo(-72, -62); ctx.lineTo(15, -72); ctx.lineTo(61, -45); ctx.lineTo(105, -35); ctx.lineTo(112, -5); ctx.lineTo(-110, -5); ctx.closePath(); ctx.fill();
    rect(-60, -60, 55, 27, "#263e3e");
    rect(3, -61, 37, 29, "#2d4442");
    rect(-102, -30, 202, 10, "#c55642");
    rect(80, -25, 25, 8, "#e8d58c");
    ctx.fillStyle = "#20241f";
    ctx.beginPath(); ctx.arc(-66, -4, 22, 0, Math.PI * 2); ctx.arc(68, -4, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#a9a88b";
    ctx.beginPath(); ctx.arc(-66, -4, 9, 0, Math.PI * 2); ctx.arc(68, -4, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawGate(worldX) {
    const x = worldX - camera;
    if (x < -50 || x > W + 50) return;
    rect(x - 6, 245, 12, 267, "#3d4738");
    rect(x - 16, 261, 32, 13, "#b8a84f");
    for (let y = 290; y < 492; y += 27) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(-0.5); rect(-20, -4, 40, 8, "#b85e38"); ctx.restore();
    }
    ctx.fillStyle = "rgba(221,100,55,.18)";
    ctx.fillRect(x - 3, 275, 6, 224);
  }

  function drawHUD() {
    if (!player) return;
    ctx.save();
    ctx.fillStyle = "rgba(12,18,13,.86)";
    ctx.beginPath(); ctx.moveTo(15, 14); ctx.lineTo(327, 14); ctx.lineTo(315, 79); ctx.lineTo(15, 79); ctx.closePath(); ctx.fill();
    rect(25, 24, 42, 43, player.color);
    rect(30, 28, 30, 27, player.skin);
    rect(29, 26, 32, 8, player.hair);
    text("1P", 46, 62, 10, "#1c2813", "center");
    text(player.name, 78, 29, 15, "#f2edda");
    rect(78, 43, 217, 15, "#3b2924");
    const healthWidth = 213 * (player.health / player.maxHealth);
    const healthColor = player.health / player.maxHealth < 0.28 ? "#e25639" : "#d6ed4c";
    rect(80, 45, Math.max(0, healthWidth), 11, healthColor);
    rect(80, 45, Math.max(0, healthWidth), 3, "rgba(255,255,255,.25)");
    text(`${Math.ceil(player.health)}`, 297, 51, 9, "#f1eedb", "right", "Inter");
    text("SCORE", 78, 69, 9, "#9ca68c");
    text(padScore(score), 119, 69, 13, "#f1edcf");

    ctx.fillStyle = "rgba(12,18,13,.78)";
    ctx.fillRect(W - 190, 14, 175, 47);
    text(encounterActive ? encounters[encounterIndex].name : encounters[encounterIndex]?.name || "HIGHWAY CLEAR", W - 30, 29, 12, "#d6dfbd", "right");
    text(encounterActive ? `${enemies.filter((e) => !e.dead).length} THREATS REMAIN` : "FOLLOW THE HIGHWAY  →", W - 30, 48, 10, encounterActive ? "#edaa63" : "#d8f24a", "right");

    if (combo > 1 && comboTimer > 0) {
      text(`${combo} HIT`, W - 35, 103, 32, "#f3e8ba", "right");
      text(combo >= 10 ? "UNSTOPPABLE!" : combo >= 5 ? "WILD COMBO!" : "COMBO", W - 35, 129, 12, "#d8f24a", "right");
    }

    const boss = enemies.find((e) => e.kind === "boss" && !e.dead);
    if (boss) {
      ctx.fillStyle = "rgba(11,15,11,.85)";
      ctx.fillRect(230, H - 42, 500, 27);
      text("TYRANT KING", 244, H - 28, 12, "#eee2bd");
      rect(355, H - 34, 354, 12, "#492c26");
      rect(357, H - 32, 350 * (boss.health / boss.maxHealth), 8, "#ce6840");
    }
    ctx.restore();
  }

  function drawBanner() {
    if (!banner || mode !== "playing") return;
    const alpha = Math.min(1, (banner.max - banner.timer) * 3, banner.timer * 2);
    ctx.globalAlpha = clamp(alpha, 0, 1);
    const y = 137;
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0, "rgba(10,16,11,0)");
    gradient.addColorStop(0.25, "rgba(10,16,11,.8)");
    gradient.addColorStop(0.75, "rgba(10,16,11,.8)");
    gradient.addColorStop(1, "rgba(10,16,11,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y - 31, W, 66);
    text(banner.title, W / 2, y - 8, 28, "#f1ecd5", "center");
    text(banner.subtitle, W / 2, y + 19, 11, "#d8f24a", "center");
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.save();
    const shakeX = screenShake > 0 ? random(-screenShake, screenShake) : 0;
    const shakeY = screenShake > 0 ? random(-screenShake * 0.5, screenShake * 0.5) : 0;
    ctx.translate(shakeX, shakeY);
    drawWorld();
    ctx.restore();
    if (mode !== "menu") drawHUD();
    drawBanner();
    if (flash > 0) {
      ctx.fillStyle = `rgba(237,91,53,${flash * 1.8})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (mode === "playing" && !encounterActive && encounterIndex < encounters.length && !banner) {
      const arrowX = 825 + Math.sin(elapsed * 6) * 8;
      text("GO", arrowX - 35, 245, 13, "#eff3c8", "right");
      text("→", arrowX, 245, 36, "#d8f24a", "center");
    }
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function initAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
  }

  function tone(frequency, duration, type = "square", volume = 0.035, slide = 0, delay = 0) {
    if (muted || !audioContext) return;
    const start = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function noise(duration = 0.08, volume = 0.035) {
    if (muted || !audioContext) return;
    const length = Math.floor(audioContext.sampleRate * duration);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start();
  }

  function playSound(name) {
    if (muted || !audioContext) return;
    switch (name) {
      case "hit": noise(0.07, 0.05); tone(105, 0.08, "square", 0.04, -45); break;
      case "heavy": noise(0.13, 0.07); tone(85, 0.17, "sawtooth", 0.06, -45); break;
      case "swing": tone(180, 0.06, "sine", 0.02, 180); break;
      case "hurt": tone(130, 0.2, "sawtooth", 0.05, -80); break;
      case "jump": tone(190, 0.12, "square", 0.025, 170); break;
      case "pickup": tone(440, 0.09, "square", 0.035); tone(660, 0.13, "square", 0.035, 0, 0.08); break;
      case "break": noise(0.2, 0.065); break;
      case "special": tone(140, 0.42, "sawtooth", 0.05, 550); break;
      case "alert": tone(220, 0.15, "square", 0.03); tone(220, 0.15, "square", 0.03, 0, 0.23); break;
      case "boss": tone(70, 0.8, "sawtooth", 0.06, -25); break;
      case "roar": tone(75, 0.35, "sawtooth", 0.055, -30); noise(0.3, 0.025); break;
      case "clear": [330, 440, 550].forEach((n, i) => tone(n, 0.18, "square", 0.035, 0, i * 0.12)); break;
      case "start": [220, 330, 440].forEach((n, i) => tone(n, 0.12, "square", 0.03, 0, i * 0.08)); break;
      case "victory": [330, 440, 550, 660, 880].forEach((n, i) => tone(n, 0.25, "square", 0.035, 0, i * 0.14)); break;
      case "gameover": [250, 210, 160].forEach((n, i) => tone(n, 0.35, "sawtooth", 0.035, -30, i * 0.24)); break;
    }
  }

  function startMusic() {
    if (muted || musicTimer || mode !== "playing") return;
    const bass = [55, 55, 65.4, 55, 73.4, 65.4, 55, 49];
    musicTimer = setInterval(() => {
      if (mode !== "playing" || muted) return;
      const note = bass[musicStep % bass.length];
      tone(note, 0.17, "triangle", 0.025);
      if (musicStep % 2 === 0) tone(note * 2, 0.06, "square", 0.008);
      musicStep++;
    }, 220);
  }

  function stopMusic() {
    clearInterval(musicTimer);
    musicTimer = null;
  }

  const controlledKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyJ", "KeyK", "KeyL", "KeyP", "Enter", "Space"]);
  window.addEventListener("keydown", (event) => {
    if (controlledKeys.has(event.code) && (mode !== "menu" || event.code === "Enter")) event.preventDefault();
    if (event.repeat && ["KeyJ", "KeyK", "KeyL", "KeyP", "Enter"].includes(event.code)) return;
    if (!keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);
    if (event.code === "Enter") {
      if (mode === "menu") startGame();
      else if (mode === "gameover" || mode === "victory") startGame();
    }
    if (event.code === "KeyP" || event.code === "Escape") togglePause();
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => {
    keys.clear();
    pressed.clear();
    if (mode === "playing") togglePause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "playing") togglePause();
  });

  document.querySelectorAll("[data-key]").forEach((button) => {
    const code = button.dataset.key;
    const down = (event) => {
      event.preventDefault();
      if (mode !== "playing") return;
      initAudio();
      if (!keys.has(code)) pressed.add(code);
      keys.add(code);
      button.classList.add("pressed");
      button.setPointerCapture?.(event.pointerId);
    };
    const up = (event) => {
      event.preventDefault();
      keys.delete(code);
      button.classList.remove("pressed");
    };
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("lostpointercapture", up);
  });

  document.querySelectorAll(".character-card").forEach((button) => {
    button.addEventListener("click", () => {
      selectedFighter = button.dataset.character;
      document.querySelectorAll(".character-card").forEach((card) => {
        const selected = card === button;
        card.classList.toggle("selected", selected);
        card.setAttribute("aria-checked", String(selected));
      });
      initAudio();
      playSound("pickup");
    });
  });

  $("start-button").addEventListener("click", startGame);
  $("resume-button").addEventListener("click", () => togglePause(true));
  $("restart-pause-button").addEventListener("click", startGame);
  $("restart-button").addEventListener("click", startGame);
  $("character-button").addEventListener("click", showMenu);
  canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));

  $("audio-button").addEventListener("click", () => {
    muted = !muted;
    localStorage.setItem("cd-extinction-muted", String(muted));
    $("audio-button").setAttribute("aria-pressed", String(muted));
    $("audio-button").setAttribute("aria-label", muted ? "Enable sound" : "Mute sound");
    if (!muted) {
      initAudio();
      playSound("pickup");
      startMusic();
    } else stopMusic();
  });

  const preferredTheme = localStorage.getItem("cd-extinction-theme") || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cd-extinction-theme", theme);
    $("theme-button").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#111510" : "#eeeae0";
  }
  setTheme(preferredTheme);
  $("theme-button").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  const helpDialog = $("help-dialog");
  $("help-button").addEventListener("click", () => {
    if (mode === "playing") togglePause();
    helpDialog.showModal();
  });
  $("close-help").addEventListener("click", () => helpDialog.close());
  $("help-ready").addEventListener("click", () => helpDialog.close());
  helpDialog.addEventListener("click", (event) => {
    const bounds = helpDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) helpDialog.close();
  });

  $("fullscreen-button").addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await $("game-frame").requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) {
      $("fullscreen-button").textContent = "FULLSCREEN UNAVAILABLE";
    }
  });
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen-button").setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen");
  });

  resetGame();
  mode = "menu";
  requestAnimationFrame(frame);
})();
