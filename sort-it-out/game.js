// Sort It Out: game logic
//
// How a game goes:
//   start screen → place the bins → round 1 → round screen → round 2 → round screen → round 3
//
// Two ways to play:
//   - AR mode (phone):   real camera, real floor.
//   - PC test mode:      a fake room with a grey floor and a table. Mouse = finger, keys to move.
//
// Other files: items.js (bins, trash, rounds) and sounds.js (sound effects).

// ---------- Settings (change these to tune the game) ----------
const ROUND_TIME = 120;          // seconds per round
const POINTS_RIGHT = 10;         // points for the right bin
const STREAK_BONUS = 5;          // extra points from the 3rd right throw in a row
const WRONG_PENALTY = 5;         // seconds lost for the wrong bin
const GRAVITY = 7;               // m/s². Real gravity is 9.8; a bit less makes throws easier to follow.
const THROW_ANGLE = 40;          // degrees upward
const THROW_POWER = 1.2;         // how much swipe speed turns into throw speed
const MIN_THROW_SPEED = 1;       // m/s
const MAX_THROW_SPEED = 7;       // m/s
const AIM_AMOUNT = 0.6;          // how much a sideways swipe turns the throw (0 = not at all)
const AIM_ASSIST_ANGLE = 9;      // aim assist: helps if you aim within this many degrees of an opening (0 = off)
const AIM_ASSIST_DISTANCE = 0.3; // ...and your throw is within 30% of the right distance
const PICK_RADIUS = 0.25;        // metres: how close to trash a tap has to be
const SPAWN_MIN = 1;             // trash appears between 1 m...
const SPAWN_MAX = 2.3;           // ...and 2.3 m from the player
const TABLE_CHANCE = 0.3;        // chance that new trash appears on a table (if we found one)
const ROLL_DELAY = 7;            // seconds before trash rolls away (rounds 2 and 3)
const ROLL_SPEED = 0.5;          // m/s when it starts rolling
const DEBUG = location.search.includes('debug'); // add ?debug to the link to see floor-detection numbers

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---------- Floor finder ----------
// Moves the white ring to the floor spot in the middle of the screen.
// AR: uses WebXR "hit test". The phone shoots an invisible ray from the middle of the
//     screen and reports real surfaces. We only accept surfaces that face up (not walls)
//     and are at least 30 cm below the phone.
// PC: there is no real floor, so we pretend the floor is the flat plane at height 0.
// After the bins are placed, the ring is hidden but it keeps looking (the game uses it to find tables).
AFRAME.registerComponent('floor-finder', {
  init() {
    this.hitSource = null;
    this.status = 'off';     // 'starting' → 'searching' / 'not-floor' / 'found', or 'error'
    this.error = '';
    this.found = false;      // is the ring on the floor right now?
    this.showRing = true;    // the game hides the ring once the bins are placed
    this.searchTime = 0;     // seconds spent looking without finding the floor
    this.lostTime = 0;       // seconds since we last saw the floor (stops the ring from flickering)
    this.point = new THREE.Vector3();  // where the ring is (smoothed)
    this.raw = new THREE.Vector3();    // the latest floor-like hit (not smoothed)
    this.rawValid = false;
    this.debugText = '';
    // Reused helpers
    this.target = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.up = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.ray = new THREE.Ray();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.el.object3D.visible = false;

    const scene = this.el.sceneEl;
    scene.addEventListener('enter-vr', () => { if (scene.is('ar-mode')) this.startHitTest(); });
    scene.addEventListener('exit-vr', () => {
      if (this.hitSource) this.hitSource.cancel();
      this.hitSource = null;
    });
  },

  startHitTest() {
    const session = this.el.sceneEl.renderer.xr.getSession();
    this.status = 'starting';
    if (!session || !session.requestHitTestSource) {
      this.fail('surface detection is not available');
      return;
    }
    session.requestReferenceSpace('viewer')
      // Ask for planes AND single feature points: points show up faster on plain floors.
      // If the phone doesn't support points, ask again with the default (planes only).
      .then(space => session.requestHitTestSource({ space, entityTypes: ['plane', 'point'] })
        .catch(() => session.requestHitTestSource({ space })))
      .then(source => { this.hitSource = source; this.status = 'searching'; })
      .catch(err => this.fail(err && err.message ? err.message : String(err)));
  },

  fail(message) {
    this.status = 'error';
    this.error = message;
  },

  tick(time, delta) {
    const scene = this.el.sceneEl;
    const seconds = delta / 1000;
    let hit = null;
    if (scene.is('ar-mode')) hit = this.findFloorAR();
    else if (scene.is('pc-mode')) hit = this.findFloorPC();
    else return;

    this.rawValid = !!hit;
    if (hit) {
      this.raw.copy(hit);
      if (this.found) this.point.lerp(hit, 0.4); // glide to the new spot...
      else this.point.copy(hit);                  // ...but jump there the first time
      this.found = true;
      this.lostTime = 0;
    } else {
      this.lostTime += seconds;
      if (this.lostTime > 0.4) this.found = false;
      if (this.status !== 'starting') this.searchTime += seconds;
    }
    if (DEBUG && !this.hitSource && scene.is('ar-mode')) this.debugText = `${this.status} ${this.error}`;

    const obj = this.el.object3D;
    obj.visible = this.showRing && this.found;
    if (obj.visible) {
      obj.position.copy(this.point);
      // Turn the ring and the row preview to face the player
      scene.camera.getWorldPosition(this.camPos);
      obj.rotation.y = Math.atan2(this.camPos.x - this.point.x, this.camPos.z - this.point.z);
    }
  },

  findFloorPC() {
    this.status = 'searching';
    const cam = this.el.sceneEl.camera;
    cam.getWorldPosition(this.ray.origin);
    cam.getWorldDirection(this.ray.direction);
    const hit = this.ray.intersectPlane(this.floorPlane, this.target);
    if (!hit || this.ray.origin.distanceTo(hit) > 15) return null;
    this.status = 'found';
    return hit;
  },

  findFloorAR() {
    const xr = this.el.sceneEl.renderer.xr;
    const frame = xr.getFrame();
    if (!this.hitSource || !frame) return null;

    const results = frame.getHitTestResults(this.hitSource);
    const refSpace = xr.getReferenceSpace();
    this.el.sceneEl.camera.getWorldPosition(this.camPos);
    let floor = null, upY = null, hitY = null;
    for (const result of results) {
      const pose = result.getPose(refSpace);
      if (!pose) continue;
      const { position, orientation } = pose.transform;
      // Which way does the surface face? A floor's "up" is close to (0, 1, 0).
      this.quat.set(orientation.x, orientation.y, orientation.z, orientation.w);
      upY = this.up.set(0, 1, 0).applyQuaternion(this.quat).y;
      hitY = position.y;
      if (upY > 0.8 && position.y < this.camPos.y - 0.3) {
        floor = this.target.set(position.x, position.y, position.z);
        break;
      }
    }
    this.status = floor ? 'found' : (results.length ? 'not-floor' : 'searching');
    if (DEBUG) {
      this.debugText = `hits ${results.length} · up ${upY === null ? '-' : upY.toFixed(2)}` +
        ` · hit y ${hitY === null ? '-' : hitY.toFixed(2)} · phone y ${this.camPos.y.toFixed(2)} · ${this.status}`;
    }
    return floor;
  },
});

// ---------- PC test mode controls ----------
// On the camera. Only does something in PC mode (on the phone you just move the phone).
// Arrow keys = look around, WASD = walk. The mouse is kept free for tapping/swiping.
AFRAME.registerComponent('pc-controls', {
  init() {
    this.keys = {}; // which keys are held down right now
    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    this.el.object3D.rotation.order = 'YXZ'; // turn left/right first, then tilt up/down
  },

  tick(time, delta) {
    if (!this.el.sceneEl.is('pc-mode')) return;
    const k = this.keys;
    const obj = this.el.object3D;
    const seconds = delta / 1000;

    // Look around (1.5 radians per second), tilt is limited so you can't flip over
    const turn = 1.5 * seconds;
    if (k.ArrowLeft) obj.rotation.y += turn;
    if (k.ArrowRight) obj.rotation.y -= turn;
    if (k.ArrowUp) obj.rotation.x = Math.min(obj.rotation.x + turn, 1.4);
    if (k.ArrowDown) obj.rotation.x = Math.max(obj.rotation.x - turn, -1.4);

    // Walk along the floor in the direction we're facing (2 metres per second)
    const forward = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const right = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const yaw = obj.rotation.y;
    const step = 2 * seconds;
    obj.position.x += (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * step;
    obj.position.z += (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * step;
  },
});

// ---------- Best scores (saved in the browser) ----------
function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('sortItOut.best')) || {};
  } catch (e) {
    return {}; // private mode or blocked storage: just start fresh
  }
}
function saveBest(best) {
  try {
    localStorage.setItem('sortItOut.best', JSON.stringify(best));
  } catch (e) {
    // can't save, that's fine
  }
}

// ---------- Game ----------
// Lives on <a-scene>. Runs the screens, rounds, finger input, trash physics and scoring.
AFRAME.registerComponent('game', {
  init() {
    const $ = id => document.getElementById(id);
    this.ui = {
      start: $('start-screen'), overlay: $('overlay'), hud: $('hud'), message: $('message'),
      timer: $('timer'), round: $('round-label'), score: $('score'), popup: $('popup'),
      crosshair: $('crosshair'), fallback: $('fallback-button'), debug: $('debug'),
      roundScreen: $('round-screen'), nextButton: $('next-button'), restartButton: $('restart-button'),
    };
    this.reticle = $('reticle');

    this.state = 'menu';     // 'menu' → 'place' → 'countdown' → 'play' → 'round-over' → 'countdown' …
    this.roundNumber = 0;
    this.round = null;       // the current round's settings (ROUNDS in items.js)
    this.score = 0;          // points this round
    this.totalScore = 0;     // points over all rounds
    this.timeLeft = ROUND_TIME;
    this.items = [];         // trash in the room right now
    this.held = null;        // the item in the player's hand
    this.openings = [];      // bin openings: { type, name, radius, pos, el }
    this.tables = [];        // spots on tables where trash can appear
    this.floorY = 0;
    this.tip = { text: '', time: 0 }; // a tip that stays on screen for a moment after a mistake
    this.best = loadBest();

    // Reused helper objects (making new ones every frame is slow)
    this.raycaster = new THREE.Raycaster();
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.holdOffset = new THREE.Vector3(0, -0.3, -0.75); // where a held item floats: below the aim circle
    this.holdPoint = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.axis = new THREE.Vector3();
    this.q1 = new THREE.Quaternion();
    this.q2 = new THREE.Quaternion();

    // Can this browser do AR? If not (like a PC), offer PC test mode instead.
    if (!navigator.xr) {
      this.offerPCMode();
    } else {
      navigator.xr.isSessionSupported('immersive-ar')
        .then(ok => { if (!ok) this.offerPCMode(); })
        .catch(() => this.offerPCMode());
    }

    // Buttons
    $('start-button').addEventListener('click', () => Sound.init()); // A-Frame starts AR on this click
    $('pc-button').addEventListener('click', () => { Sound.init(); this.startPCMode(); });
    $('quit-button').addEventListener('click', () => this.quit());
    this.ui.fallback.addEventListener('click', () => this.useEstimatedFloor());
    this.ui.nextButton.addEventListener('click', () => {
      this.startRound(this.roundNumber < ROUNDS.length ? this.roundNumber + 1 : 1);
    });
    this.ui.restartButton.addEventListener('click', () => this.startRound(1));

    // Entering AR: show the game screen and start placing the bins.
    // Leaving AR (back button): reload the page, so everything starts fresh.
    this.el.addEventListener('enter-vr', () => {
      if (!this.el.is('ar-mode')) return;
      this.showGameScreen();
      this.beginPlacing();
    });
    this.el.addEventListener('exit-vr', () => location.reload());

    // Finger input on the overlay (it covers the whole screen).
    // We remember where the finger went, then on release decide: tap or swipe?
    // Touches on buttons and on the round screen are ignored here.
    this.touch = null;
    const overlay = this.ui.overlay;
    overlay.addEventListener('pointerdown', e => {
      if (e.target.closest('button, #round-screen')) return;
      this.touch = { startX: e.clientX, startY: e.clientY, points: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    });
    overlay.addEventListener('pointermove', e => {
      if (this.touch) this.touch.points.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    });
    overlay.addEventListener('pointerup', e => {
      if (this.touch) this.onFingerUp(e);
      this.touch = null;
    });
    overlay.addEventListener('pointercancel', () => { this.touch = null; });

    if (this.best.total) $('best-score').textContent = `Your best: ${this.best.total} points`;
  },

  // ----- Screens -----

  offerPCMode() {
    document.getElementById('pc-button').hidden = false;
    document.getElementById('ar-warning').textContent = 'No AR on this device. You can still test the game on a PC.';
  },

  showGameScreen() {
    this.ui.start.style.display = 'none';
    this.ui.overlay.classList.add('active');
  },

  // PC test mode: a fake room so we can test the game without a phone
  startPCMode() {
    this.el.addState('pc-mode');
    this.showGameScreen();
    // Sky colour, a big grey floor and a table (so trash can also appear on a table)
    this.el.setAttribute('background', 'color: #a8cbe6');
    this.el.insertAdjacentHTML('beforeend', `
      <a-plane rotation="-90 0 0" width="30" height="30" color="#8d9196"></a-plane>
      <a-box position="1.7 0.37 0.3" width="1.2" height="0.74" depth="0.6" color="#a0754b"></a-box>`);
    this.tables = [1.4, 1.7, 2.0].map(x => new THREE.Vector3(x, 0.74, 0.3));
    // Camera at eye height (1.6 m), tilted a bit down at the floor
    const cam = document.querySelector('[camera]').object3D;
    cam.position.set(0, 1.6, 0);
    cam.rotation.x = -0.6;
    this.beginPlacing();
  },

  quit() {
    if (this.el.is('ar-mode')) this.el.exitVR(); // leaving AR reloads the page (see 'exit-vr')
    else location.reload();
  },

  finder() {
    return this.reticle.components['floor-finder'];
  },

  // ----- Placing the bins -----

  beginPlacing() {
    this.state = 'place';
    this.finder().showRing = true;
  },

  // Put the row of bins on the floor at "center", turned to face the player
  placeBins(center) {
    this.el.camera.getWorldPosition(this.camPos);
    const angle = Math.atan2(this.camPos.x - center.x, this.camPos.z - center.z); // in radians
    const { row, openings } = buildBinRow();
    row.setAttribute('position', `${center.x} ${center.y} ${center.z}`);
    row.setAttribute('rotation', `0 ${THREE.MathUtils.radToDeg(angle)} 0`);
    this.el.appendChild(row);

    // Where is each opening in the world? (x along the turned row)
    this.openings = openings.map(o => ({
      ...o,
      pos: new THREE.Vector3(center.x + o.x * Math.cos(angle), center.y, center.z - o.x * Math.sin(angle)),
    }));
    this.rowCenter = center.clone();
    this.floorY = center.y;
    this.finder().showRing = false; // it keeps looking for tables, but without the ring
    Sound.place();
    this.startRound(1);
  },

  // No floor found: use the phone's own floor estimate (height 0), 1.5 m in front of the player
  useEstimatedFloor() {
    this.el.camera.getWorldPosition(this.camPos);
    const yaw = this.getCameraYaw();
    this.placeBins(new THREE.Vector3(this.camPos.x - Math.sin(yaw) * 1.5, 0, this.camPos.z - Math.cos(yaw) * 1.5));
  },

  // ----- Rounds -----

  startRound(number) {
    this.clearItems();
    this.roundNumber = number;
    this.round = ROUNDS[number - 1];
    if (number === 1) this.totalScore = 0;
    this.score = 0;
    this.timeLeft = ROUND_TIME;
    this.stats = { right: 0, wrong: 0, streak: 0, bestStreak: 0, mistakes: [] };
    this.spawnCooldown = 0;
    this.lastName = '';
    this.countdown = 4;    // 1 s for the round title, then 3, 2, 1
    this.lastCount = null;
    this.lastWholeSecond = null;
    this.state = 'countdown';
    this.ui.roundScreen.hidden = true;
    this.showPopup(this.round.title.replace(': ', '\n'), '#ffffff');
  },

  updateCountdown(seconds) {
    this.countdown -= seconds;
    const count = Math.ceil(this.countdown);
    if (count <= 3 && count > 0 && count !== this.lastCount) {
      this.showPopup(String(count), '#ffffff');
      Sound.count();
    }
    this.lastCount = count;
    if (this.countdown <= 0) {
      this.state = 'play';
      this.showPopup('Go!', '#4ade80');
      Sound.go();
    }
  },

  updatePlay(seconds) {
    this.timeLeft -= seconds;
    const whole = Math.ceil(this.timeLeft);
    if (whole <= 10 && whole > 0 && whole !== this.lastWholeSecond) Sound.tick(); // last 10 seconds
    this.lastWholeSecond = whole;
    if (this.timeLeft <= 0) {
      this.endRound();
      return;
    }
    // Keep enough trash in the room (new trash every 0.8 s until there's enough)
    this.spawnCooldown -= seconds;
    if (this.items.length < this.round.maxItems && this.spawnCooldown <= 0) {
      this.spawnTrash();
      this.spawnCooldown = 0.8;
    }
    this.lookForTables();
  },

  endRound() {
    this.timeLeft = 0;
    this.state = 'round-over';
    this.clearItems();
    this.totalScore += this.score;
    Sound.roundEnd();

    // Best scores
    const key = 'round' + this.roundNumber;
    this.newBest = this.score > (this.best[key] || 0);
    if (this.newBest) this.best[key] = this.score;
    const lastRound = this.roundNumber === ROUNDS.length;
    this.newBestTotal = lastRound && this.totalScore > (this.best.total || 0);
    if (this.newBestTotal) this.best.total = this.totalScore;
    saveBest(this.best);
    this.showRoundScreen();
  },

  showRoundScreen() {
    const $ = id => document.getElementById(id);
    const s = this.stats;
    const lastRound = this.roundNumber === ROUNDS.length;
    const thrown = s.right + s.wrong;
    $('rs-title').textContent = lastRound ? 'All rounds done!' : `${this.round.title} done!`;
    $('rs-score').textContent = this.score;
    $('rs-best').textContent = this.newBest ? 'New best for this round!' : `Best: ${this.best['round' + this.roundNumber] || 0}`;
    $('rs-right').textContent = s.right;
    $('rs-wrong').textContent = s.wrong;
    $('rs-accuracy').textContent = thrown ? `${Math.round((100 * s.right) / thrown)}%` : '–';
    $('rs-streak').textContent = s.bestStreak;
    $('rs-total').textContent = lastRound
      ? `Total: ${this.totalScore} points${this.newBestTotal ? ' (new best!)' : ''}`
      : '';

    // Mistakes with the right answer, so the player learns the rules
    const list = $('rs-mistakes');
    list.innerHTML = '';
    if (!s.mistakes.length) {
      list.innerHTML = '<li class="perfect">No mistakes. Perfect sorting!</li>';
    }
    s.mistakes.forEach(m => {
      const li = document.createElement('li');
      li.innerHTML = '<b></b> goes into <b></b><small></small>';
      li.children[0].textContent = m.name;
      li.children[1].textContent = m.right;
      li.children[2].textContent = m.tip;
      list.appendChild(li);
    });

    this.ui.nextButton.textContent = lastRound ? 'Play again' : 'Next round';
    this.ui.restartButton.hidden = lastRound; // after the last round, "Play again" already restarts
    this.ui.roundScreen.hidden = false;
  },

  // ----- Trash -----

  spawnTrash() {
    const kind = pickTrash(this.roundNumber, this.lastName);
    this.lastName = kind.name;
    const built = buildTrash(kind);
    const spot = this.findSpawnSpot();

    const item = {
      kind,
      name: kind.name,
      bin: kind.bin,
      el: built.el,
      height: built.height,
      radius: built.radius,
      shape: built.shape,       // 'upright', 'flat' or 'ball'
      state: 'ground',          // 'ground' → 'held' → 'flying' → 'ground'/'rolling' (miss) or gone (bin)
      lying: false,             // bottles and cans lie on their side after a throw
      surfaceY: spot.y,         // height of what it stands on (floor or table)
      onTable: spot.onTable,
      velocity: new THREE.Vector3(),
      rollDir: new THREE.Vector3(),
      rollSpeed: 0,
      rollFriction: 0,
      groundTime: 0,            // seconds lying around (for rolling away)
      missed: false,
    };
    built.el.setAttribute('position', `${spot.x} ${spot.y + this.restHeight(item)} ${spot.z}`);
    built.el.setAttribute('rotation', `0 ${Math.random() * 360} 0`);
    built.el.setAttribute('animation', 'property: scale; from: 0.01 0.01 0.01; to: 1 1 1; dur: 350; easing: easeOutBack');
    this.el.appendChild(built.el);

    // A small yellow marker that bobs above the trash, so it's easy to spot in a real room
    item.marker = make('a-cone', {
      'radius-bottom': 0.035, 'radius-top': 0, height: 0.07, rotation: '180 0 0',
      material: 'color: #ffd93d; shader: flat',
    });
    this.el.appendChild(item.marker);
    this.items.push(item);
  },

  // Where can new trash go? Sometimes on a table, otherwise on the floor around the player.
  findSpawnSpot() {
    if (this.tables.length && Math.random() < TABLE_CHANCE) {
      const free = this.tables.filter(t => this.isFree(t.x, t.z, 0.35));
      if (free.length) {
        const t = free[Math.floor(Math.random() * free.length)];
        return { x: t.x, y: t.y, z: t.z, onTable: true };
      }
    }
    this.el.camera.getWorldPosition(this.camPos);
    let spot = null;
    for (let tries = 0; tries < 30; tries++) {
      const angle = Math.random() * Math.PI * 2; // any direction, also behind the player
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      spot = {
        x: this.camPos.x + Math.cos(angle) * dist,
        y: this.floorY,
        z: this.camPos.z + Math.sin(angle) * dist,
        onTable: false,
      };
      if (this.isFree(spot.x, spot.z, 0.4) && this.awayFromBins(spot.x, spot.z, 0.4)) break;
    }
    return spot;
  },

  isFree(x, z, minDist) {
    return this.items.every(i => {
      const p = i.el.object3D.position;
      return Math.hypot(p.x - x, p.z - z) > minDist;
    });
  },

  awayFromBins(x, z, margin) {
    return this.openings.every(o => Math.hypot(o.pos.x - x, o.pos.z - z) > o.radius + margin);
  },

  // How high an item's centre is above what it stands on
  restHeight(item) {
    return item.lying ? item.radius : item.height / 2;
  },

  removeItem(item) {
    item.el.remove();
    item.marker.remove();
    this.items = this.items.filter(i => i !== item);
    if (this.held === item) this.held = null;
  },

  clearItems() {
    this.items.slice().forEach(item => this.removeItem(item));
  },

  // While playing in AR, remember flat spots that are higher than the floor (tables)
  lookForTables() {
    const finder = this.finder();
    if (!this.el.is('ar-mode') || !finder.rawValid || this.tables.length >= 12) return;
    const p = finder.raw;
    const height = p.y - this.floorY;
    if (height < 0.4 || height > 1.2) return; // too low or too high for a table
    if (this.tables.some(t => t.distanceTo(p) < 0.3)) return; // we already know this spot
    if (!this.awayFromBins(p.x, p.z, 0.3)) return;
    this.tables.push(p.clone());
  },

  // ----- Input -----

  onFingerUp(e) {
    const touch = this.touch;
    const moved = Math.hypot(e.clientX - touch.startX, e.clientY - touch.startY);
    if (moved < 20) { // barely moved = a tap
      this.onTap(e.clientX, e.clientY);
      return;
    }
    // A swipe. Its speed = how far the finger moved in the last 100 ms.
    // We measure in "screen heights per second" so it feels the same on every phone size.
    const recent = touch.points.filter(p => e.timeStamp - p.t < 100);
    const from = recent[0] || touch.points[0];
    const seconds = Math.max(e.timeStamp - from.t, 16) / 1000;
    const speedX = (e.clientX - from.x) / innerHeight / seconds; // + = to the right
    const speedY = (e.clientY - from.y) / innerHeight / seconds; // - = up the screen
    if (this.held && speedY < 0) this.throwItem(this.held, speedX, speedY);
  },

  onTap(x, y) {
    if (this.state === 'place') {
      if (this.finder().found) this.placeBins(this.finder().point.clone());
      return;
    }
    if (this.state !== 'play' || this.held) return;

    // Shoot a ray from the camera through the finger and pick the trash closest to it
    const cam = this.el.camera;
    // In phone AR, three.js forgets to update this "inverse lens" matrix, and the ray
    // needs it. Without this line, taps away from the screen centre would miss.
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.raycaster.setFromCamera({ x: (x / innerWidth) * 2 - 1, y: -(y / innerHeight) * 2 + 1 }, cam);
    const ray = this.raycaster.ray;
    let best = null, bestOffset = Infinity;
    for (const item of this.items) {
      if (item.state !== 'ground' && item.state !== 'rolling') continue;
      const p = item.el.object3D.position;
      const along = this.tmp.copy(p).sub(ray.origin).dot(ray.direction);
      if (along < 0 || along > 6) continue; // behind the camera or too far away
      // Small things are hard to hit with a finger, so "close to the ray" counts
      const offset = ray.distanceToPoint(p);
      if (offset < PICK_RADIUS + item.radius && offset < bestOffset) {
        best = item;
        bestOffset = offset;
      }
    }
    if (best) this.pickUp(best);
  },

  pickUp(item) {
    item.state = 'held';
    item.lying = false;
    item.missed = false;
    item.el.removeAttribute('animation'); // stop the pop-in animation if it's still running
    this.held = item;
    Sound.pickUp();
    Sound.vibrate(15);
  },

  throwItem(item, speedX, speedY) {
    // The throw starts from the hand, even if the item is still gliding there
    this.updateHoldPoint();
    item.el.object3D.position.copy(this.holdPoint);

    // Faster swipe = faster throw. Direction: where the phone points, turned by a sideways swipe.
    let speed = THREE.MathUtils.clamp(Math.hypot(speedX, speedY) * THROW_POWER, MIN_THROW_SPEED, MAX_THROW_SPEED);
    let yaw = this.getCameraYaw() - Math.atan2(speedX, -speedY) * AIM_AMOUNT;
    const assist = this.aimAssist(this.holdPoint, yaw, speed);
    if (assist) ({ yaw, speed } = assist);

    const up = THREE.MathUtils.degToRad(THROW_ANGLE);
    const flat = speed * Math.cos(up); // the part of the speed going forward
    item.velocity.set(-Math.sin(yaw) * flat, speed * Math.sin(up), -Math.cos(yaw) * flat);
    item.spin = 6 + Math.random() * 6; // tumble while flying, looks more like a throw
    item.state = 'flying';
    this.held = null;
    Sound.throw();
  },

  // Aim assist: if a throw is almost right for one of the openings, nudge it so it lands in.
  // This makes throwing feel good on a small screen. Set AIM_ASSIST_ANGLE to 0 to turn it off.
  aimAssist(start, yaw, speed) {
    if (!AIM_ASSIST_ANGLE) return null;
    const up = THREE.MathUtils.degToRad(THROW_ANGLE);
    const h = start.y - (this.floorY + BIN_HEIGHT); // how far above the rims we throw from
    const vy = speed * Math.sin(up);
    const timeToRim = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(h, 0))) / GRAVITY;
    const throwDist = speed * Math.cos(up) * timeToRim; // where this throw comes down to rim height

    let best = null;
    for (const o of this.openings) {
      const dx = o.pos.x - start.x, dz = o.pos.z - start.z;
      const dist = Math.hypot(dx, dz);
      const yawToBin = Math.atan2(-dx, -dz);
      const angleOff = Math.abs(Math.atan2(Math.sin(yawToBin - yaw), Math.cos(yawToBin - yaw)));
      if (angleOff > THREE.MathUtils.degToRad(AIM_ASSIST_ANGLE)) continue;
      if (Math.abs(throwDist - dist) / dist > AIM_ASSIST_DISTANCE) continue;
      if (!best || angleOff < best.angleOff) best = { yaw: yawToBin, dist, angleOff };
    }
    if (!best) return null;
    // The speed that lands exactly in the middle of that opening (from the throw formula)
    const d = best.dist;
    const v = Math.sqrt((GRAVITY / 2) * d * d / (Math.cos(up) ** 2 * (h + d * Math.tan(up))));
    return v > 0 ? { yaw: best.yaw, speed: v } : null;
  },

  // ----- Every frame -----

  tick(time, delta) {
    // Real time since the last frame. Capped, so a pause (e.g. switching apps) doesn't jump ahead.
    const seconds = Math.min(delta / 1000, 0.25);
    if (this.state === 'countdown') this.updateCountdown(seconds);
    else if (this.state === 'play') this.updatePlay(seconds);

    // Move the trash in small steps (max 20 ms), so a fast throw can't skip through a bin
    const steps = Math.ceil(seconds / 0.02);
    for (let i = 0; i < steps; i++) {
      for (const item of this.items.slice()) {
        if (item.state === 'held') this.followCamera(item, seconds / steps);
        else if (item.state === 'flying') this.updateFlying(item, seconds / steps);
        else if (item.state === 'rolling') this.updateRolling(item, seconds / steps);
        else this.updateGround(item, seconds / steps);
      }
    }
    this.items.forEach(item => this.updateMarker(item, time));
    if (this.tip.time > 0) this.tip.time -= seconds;
    this.updateHud();
  },

  updateHoldPoint() {
    this.holdPoint.copy(this.holdOffset);
    this.el.camera.localToWorld(this.holdPoint);
  },

  // A held item floats in front of the phone (it glides there, not jumps)
  followCamera(item, seconds) {
    this.updateHoldPoint();
    item.el.object3D.position.lerp(this.holdPoint, Math.min(1, seconds * 15));
    item.el.object3D.quaternion.copy(this.el.camera.getWorldQuaternion(this.camQuat));
  },

  // Simple physics: gravity, bins, floor
  updateFlying(item, seconds) {
    const obj = item.el.object3D;
    const pos = obj.position;
    const vel = item.velocity;
    const prevY = pos.y;

    vel.y -= GRAVITY * seconds;
    pos.addScaledVector(vel, seconds);
    obj.rotation.x += item.spin * seconds;

    const rimY = this.floorY + BIN_HEIGHT;
    for (const o of this.openings) {
      const dx = pos.x - o.pos.x, dz = pos.z - o.pos.z;
      const dist = Math.hypot(dx, dz);
      // Fell in through the top?
      if (prevY >= rimY && pos.y < rimY && dist < o.radius) {
        this.landInBin(item, o);
        return;
      }
      // Hit the outside of a bin? Push it out and bounce it back (with 40% of the speed).
      const minDist = o.radius + 0.03;
      if (pos.y < rimY && dist < minDist && dist > 0) {
        const nx = dx / dist, nz = dz / dist; // direction pointing away from the bin
        pos.x = o.pos.x + nx * minDist;
        pos.z = o.pos.z + nz * minDist;
        const towardsBin = vel.x * nx + vel.z * nz;
        if (towardsBin < 0) {
          vel.x -= 1.4 * towardsBin * nx;
          vel.z -= 1.4 * towardsBin * nz;
          Sound.bounce();
        }
      }
    }

    // Hit the floor: a small bounce, then it settles
    const offset = item.shape === 'upright' ? item.radius : item.height / 2;
    if (pos.y <= this.floorY + offset) {
      pos.y = this.floorY + offset;
      if (!item.missed) {
        item.missed = true;
        this.stats.streak = 0;
        this.showPopup('Missed!', '#ffd34d');
        Sound.land();
      }
      if (vel.y < -1.2) { // still fast: bounce (and lose most of the speed)
        vel.y *= -0.3;
        vel.x *= 0.55;
        vel.z *= 0.55;
      } else {
        this.settle(item);
      }
    }

    // Flew far away (out of the room)? It's gone.
    if (this.rowCenter && Math.hypot(pos.x - this.rowCenter.x, pos.z - this.rowCenter.z) > 7) {
      this.removeItem(item);
      this.stats.streak = 0;
      this.showPopup('Too far!', '#ffd34d');
    }
  },

  // The item stops on the floor: bottles and cans lie down, flat things lie flat.
  // If it still has some speed, it rolls on a bit.
  settle(item) {
    const obj = item.el.object3D;
    const vel = item.velocity;
    const speed = Math.hypot(vel.x, vel.z);
    const heading = speed > 0.01 ? Math.atan2(vel.x, vel.z) : Math.random() * Math.PI * 2;
    item.surfaceY = this.floorY;
    item.onTable = false;
    if (item.shape === 'upright') this.layDown(item, heading);
    if (item.shape === 'flat') obj.rotation.set(0, obj.rotation.y, 0);
    obj.position.y = this.floorY + this.restHeight(item);
    vel.set(0, 0, 0);
    item.groundTime = 0;
    if (item.shape !== 'flat' && speed > 0.2) this.startRolling(item, heading, Math.min(speed * 0.5, 0.8), 0.8);
    else item.state = 'ground';
  },

  // Lay a bottle or can on its side, across the direction it will roll
  layDown(item, heading) {
    item.lying = true;
    this.q1.setFromAxisAngle(Y_AXIS, heading);
    this.q2.setFromAxisAngle(Z_AXIS, Math.PI / 2);
    item.el.object3D.quaternion.copy(this.q1).multiply(this.q2);
  },

  startRolling(item, heading, speed, friction) {
    if (item.shape === 'upright' && !item.lying) {
      this.layDown(item, heading); // tip over first
      item.el.object3D.position.y = item.surfaceY + this.restHeight(item);
    }
    item.rollDir.set(Math.sin(heading), 0, Math.cos(heading));
    item.rollSpeed = speed;
    item.rollFriction = friction;
    item.state = 'rolling';
  },

  updateRolling(item, seconds) {
    const obj = item.el.object3D;
    obj.position.addScaledVector(item.rollDir, item.rollSpeed * seconds);
    // Spin around the axis lying across the rolling direction (up × direction)
    this.axis.set(item.rollDir.z, 0, -item.rollDir.x);
    this.q1.setFromAxisAngle(this.axis, (item.rollSpeed * seconds) / item.radius);
    obj.quaternion.premultiply(this.q1);
    item.rollSpeed -= item.rollFriction * seconds;
    // Stop when it's slow or would roll into a bin
    const p = obj.position;
    if (item.rollSpeed <= 0 || !this.awayFromBins(p.x, p.z, item.radius)) {
      item.rollSpeed = 0;
      item.state = 'ground';
      item.groundTime = 0;
    }
  },

  // Trash lying around too long rolls away (rounds 2 and 3), away from the player
  updateGround(item, seconds) {
    if (this.state !== 'play' || !this.round.rolling || item.onTable || item.shape === 'flat') return;
    item.groundTime += seconds;
    if (item.groundTime < ROLL_DELAY) return;
    const p = item.el.object3D.position;
    this.el.camera.getWorldPosition(this.camPos);
    // Away from the player, a bit random. If it's already far from the bins, roll back towards them.
    let heading = Math.atan2(p.x - this.camPos.x, p.z - this.camPos.z) + (Math.random() - 0.5) * 1.4;
    if (Math.hypot(p.x - this.rowCenter.x, p.z - this.rowCenter.z) > 3.5) {
      heading = Math.atan2(this.rowCenter.x - p.x, this.rowCenter.z - p.z);
    }
    this.startRolling(item, heading, ROLL_SPEED, 0.15);
    Sound.roll();
  },

  // The yellow marker bobs above trash that can be picked up
  updateMarker(item, time) {
    const marker = item.marker.object3D;
    marker.visible = item.state === 'ground' || item.state === 'rolling';
    if (!marker.visible) return;
    const p = item.el.object3D.position;
    marker.position.set(p.x, p.y + this.restHeight(item) + 0.1 + Math.sin(time / 250) * 0.025, p.z);
  },

  // ----- Scoring -----

  landInBin(item, opening) {
    this.removeItem(item);
    // The bin does a little "gulp"
    opening.el.removeAttribute('animation__gulp');
    opening.el.setAttribute('animation__gulp', 'property: scale; from: 1.2 0.85 1.2; to: 1 1 1; dur: 350; easing: easeOutBack');

    const s = this.stats;
    if (opening.type === item.bin) {
      s.right++;
      s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      const bonus = s.streak >= 3 ? STREAK_BONUS : 0;
      this.score += POINTS_RIGHT + bonus;
      this.showPopup(`+${POINTS_RIGHT + bonus} ✓${bonus ? `\nStreak x${s.streak}!` : ''}`, '#4ade80');
      Sound.correct();
      if (opening.type.startsWith('glass')) Sound.clink();
      Sound.vibrate(40);
    } else {
      s.wrong++;
      s.streak = 0;
      this.timeLeft = Math.max(0, this.timeLeft - WRONG_PENALTY);
      const right = binName(item.bin);
      const tip = item.kind.tip || BIN_TIPS[item.bin];
      if (!s.mistakes.some(m => m.name === item.name)) s.mistakes.push({ name: item.name, right, tip });
      this.showPopup(`Wrong bin ✗ −${WRONG_PENALTY} s\n${item.name} → ${right}`, '#ff5a5a');
      this.tip = { text: tip, time: 4 };
      Sound.wrong();
      Sound.vibrate([80, 60, 80]);
    }
  },

  // ----- Screen text -----

  updateHud() {
    const ui = this.ui;
    const playing = this.state === 'countdown' || this.state === 'play' || this.state === 'round-over';
    setVisible(ui.hud, playing);
    if (playing) {
      const t = Math.ceil(this.timeLeft);
      setText(ui.timer, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      ui.timer.classList.toggle('low', this.state === 'play' && t <= 10);
      setText(ui.score, String(this.score));
      setText(ui.round, `Round ${this.roundNumber}/${ROUNDS.length}`);
    }
    ui.crosshair.classList.toggle('show', !!this.held);
    const finder = this.finder();
    const stuck = this.el.is('ar-mode') && (finder.status === 'error' || finder.searchTime > 10);
    ui.fallback.hidden = !(this.state === 'place' && stuck);
    const text = this.currentMessage();
    setText(ui.message, text);
    setVisible(ui.message, !!text);
    setText(ui.debug, DEBUG ? finder.debugText : '');
  },

  // The help text at the top: tells the player what to do next
  currentMessage() {
    if (this.tip.time > 0) return this.tip.text;
    const pc = this.el.is('pc-mode');
    if (this.state === 'place') {
      const finder = this.finder();
      if (finder.found) return `${pc ? 'Click' : 'Tap'} to place the bins here`;
      if (pc) return 'Arrow keys: look down at the floor';
      if (finder.status === 'error') return 'Can\'t detect the floor on this phone. Use the button below.';
      if (finder.status === 'starting') return 'Starting the camera…';
      if (finder.status === 'not-floor') return 'Point your phone down at the floor';
      if (finder.searchTime > 10) return 'Still looking… Bright light and a floor with some pattern help.';
      return 'Point at the floor and slowly move your phone from side to side';
    }
    if (this.state === 'countdown') return this.round.hint;
    if (this.state !== 'play') return '';
    if (this.held) return `${this.held.name}: aim at the right bin and ${pc ? 'drag the mouse' : 'swipe'} up!`;
    return this.directionHint();
  },

  // Points the player to the trash, which can be anywhere around them
  directionHint() {
    const free = this.items.filter(i => i.state === 'ground' || i.state === 'rolling');
    if (!free.length) return '';
    this.el.camera.getWorldPosition(this.camPos);
    const camYaw = this.getCameraYaw();
    let closest = null;
    for (const item of free) {
      const p = item.el.object3D.position;
      const itemYaw = Math.atan2(-(p.x - this.camPos.x), -(p.z - this.camPos.z));
      const diff = THREE.MathUtils.radToDeg(Math.atan2(Math.sin(itemYaw - camYaw), Math.cos(itemYaw - camYaw)));
      if (!closest || Math.abs(diff) < Math.abs(closest)) closest = diff;
    }
    if (Math.abs(closest) < 30) return 'Tap the trash to pick it up';
    if (Math.abs(closest) > 140) return '↓ Trash behind you ↓';
    return closest > 0 ? '← Trash to your left' : 'Trash to your right →';
  },

  // Big text in the middle that pops up and fades away ("\n" = new line)
  showPopup(text, color) {
    const popup = this.ui.popup;
    popup.textContent = text;
    popup.style.color = color;
    popup.classList.remove('show');
    void popup.offsetWidth; // trick: forces the browser to restart the CSS animation
    popup.classList.add('show');
  },

  // Which way is the camera turned (left/right only, ignoring up/down)? In radians.
  getCameraYaw() {
    this.el.camera.getWorldQuaternion(this.camQuat);
    return this.euler.setFromQuaternion(this.camQuat, 'YXZ').y;
  },
});

// Only touch the page when something changed (faster)
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}
function setVisible(element, visible) {
  const value = visible ? '' : 'hidden';
  if (element.style.visibility !== value) element.style.visibility = value;
}
