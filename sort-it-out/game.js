// Sort It Out: game logic
// Smallest playable version:
//   place bins → trash appears around you → tap it to pick up → swipe up to throw → score
//
// Two ways to play:
//   - AR mode (phone):   real camera, real floor.
//   - PC test mode:      a fake grey floor, mouse = finger, keys to move.

// ---------- Settings (change these to tune the game feel) ----------
const GRAVITY = 7;           // m/s². Real gravity is 9.8. A bit less makes throws easier to follow.
const THROW_ANGLE = 40;      // degrees upward
const THROW_POWER = 1.2;     // how much swipe speed turns into throw speed
const MIN_THROW_SPEED = 1;   // m/s
const MAX_THROW_SPEED = 7;   // m/s
const AIM_AMOUNT = 0.6;      // how much a sideways swipe turns the throw (0 = not at all)
const POINTS_RIGHT = 10;     // points for the right bin

// ---------- Floor finder ----------
// Moves the white ring to the floor spot in the middle of the screen.
// AR: uses WebXR "hit-test". The phone shoots an invisible ray from the middle of
//     the screen and tells us where it hits a real surface. We only accept
//     flat surfaces (a floor or table, not a wall).
// PC: there is no real floor, so we pretend the floor is the flat plane at height 0.
AFRAME.registerComponent('floor-finder', {
  init() {
    this.hitSource = null; // made when AR starts
    this.quat = new THREE.Quaternion();
    this.up = new THREE.Vector3();
    this.ray = new THREE.Ray();
    this.point = new THREE.Vector3();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // flat, at height 0
    this.el.object3D.visible = false;

    const scene = this.el.sceneEl;
    scene.addEventListener('enter-vr', () => {
      if (!scene.is('ar-mode')) return;
      const session = scene.renderer.xr.getSession();
      // "viewer" space = the ray starts at the phone and points out of the screen centre
      session.requestReferenceSpace('viewer')
        .then(viewerSpace => session.requestHitTestSource({ space: viewerSpace }))
        .then(source => { this.hitSource = source; });
    });
    scene.addEventListener('exit-vr', () => {
      this.hitSource = null;
      this.el.object3D.visible = false;
    });
  },

  tick() {
    const scene = this.el.sceneEl;
    if (scene.is('ar-mode')) this.findFloorAR();
    else if (scene.is('pc-mode')) this.findFloorPC();
  },

  findFloorPC() {
    // Ray from the camera, straight ahead, until it hits the fake floor
    const cam = this.el.sceneEl.camera;
    cam.getWorldPosition(this.ray.origin);
    cam.getWorldDirection(this.ray.direction);
    const hitPoint = this.ray.intersectPlane(this.floorPlane, this.point);
    const onFloor = hitPoint !== null && this.ray.origin.distanceTo(hitPoint) < 15;
    if (onFloor) this.el.object3D.position.copy(hitPoint);
    this.el.object3D.visible = onFloor;
  },

  findFloorAR() {
    const xr = this.el.sceneEl.renderer.xr;
    const frame = xr.getFrame();
    if (!this.hitSource || !frame) return;

    const hit = frame.getHitTestResults(this.hitSource)[0];
    const pose = hit && hit.getPose(xr.getReferenceSpace());
    let onFloor = false;

    if (pose) {
      const { position, orientation } = pose.transform;
      // Which way does the surface face? A floor faces up, so its "up" is close to (0, 1, 0).
      this.quat.set(orientation.x, orientation.y, orientation.z, orientation.w);
      this.up.set(0, 1, 0).applyQuaternion(this.quat);
      onFloor = this.up.y > 0.9;
      if (onFloor) this.el.object3D.position.set(position.x, position.y, position.z);
    }
    this.el.object3D.visible = onFloor;
  }
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
  }
});

// ---------- Game ----------
// Lives on <a-scene>. Handles screens, finger input, the trash item and scoring.
AFRAME.registerComponent('game', {
  init() {
    this.reticle = document.querySelector('#reticle');
    this.message = document.querySelector('#message');
    this.overlay = document.querySelector('#overlay');
    this.scoreText = document.querySelector('#score');
    this.popup = document.querySelector('#popup');
    const startScreen = document.querySelector('#start-screen');

    this.state = 'place'; // 'place' = waiting for the player to place the bins, 'play' = game running
    this.score = 0;
    this.bins = [];       // filled in placeBins(): { el, type, label, pos }
    this.item = null;     // the one trash item right now (see spawnTrash)

    // Reused helper objects (making new ones every frame is slow)
    this.raycaster = new THREE.Raycaster();
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.holdOffset = new THREE.Vector3(0, -0.2, -0.6); // where a held item sits: a bit below and in front of the camera
    this.holdPoint = new THREE.Vector3();

    // Can this browser do AR? If not (like a PC), offer PC test mode instead.
    if (!navigator.xr) {
      this.offerPCMode();
    } else {
      navigator.xr.isSessionSupported('immersive-ar').then(ok => {
        if (!ok) this.offerPCMode();
      });
    }
    document.querySelector('#pc-button').addEventListener('click', () => this.startPCMode());

    // Swap between start screen and AR overlay
    this.el.addEventListener('enter-vr', () => {
      startScreen.style.display = 'none';
      this.overlay.classList.add('active');
    });
    this.el.addEventListener('exit-vr', () => {
      startScreen.style.display = '';
      this.overlay.classList.remove('active');
    });

    // Finger input on the overlay (it covers the whole screen).
    // We remember where the finger went, then on release decide: tap or swipe?
    // A touch only counts if it started on the overlay. Otherwise the click on
    // the start button would also count as a tap.
    this.touch = null;
    this.overlay.addEventListener('pointerdown', e => {
      this.touch = { startX: e.clientX, startY: e.clientY, points: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    });
    this.overlay.addEventListener('pointermove', e => {
      if (this.touch) this.touch.points.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    });
    this.overlay.addEventListener('pointerup', e => {
      if (this.touch) this.onFingerUp(e);
      this.touch = null;
    });
    this.overlay.addEventListener('pointercancel', () => { this.touch = null; });
  },

  offerPCMode() {
    document.querySelector('#pc-button').hidden = false;
    document.querySelector('#ar-warning').textContent = 'No AR on this device. You can still test on PC.';
  },

  // PC test mode: a fake room so we can test the game without a phone
  startPCMode() {
    this.el.addState('pc-mode');
    document.querySelector('#start-screen').style.display = 'none';
    this.overlay.classList.add('active');

    // Sky colour + grey floor (in AR the real world is the background instead)
    this.el.setAttribute('background', 'color: #a8cbe6');
    const floor = document.createElement('a-plane');
    floor.setAttribute('rotation', '-90 0 0');
    floor.setAttribute('width', 20);
    floor.setAttribute('height', 20);
    floor.setAttribute('color', '#8d9196');
    this.el.appendChild(floor);

    // Put the camera at eye height (1.6 m), tilted a bit down at the floor
    const cam = document.querySelector('[camera]').object3D;
    cam.position.set(0, 1.6, 0);
    cam.rotation.x = -0.6;
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
    this.onSwipe(speedX, speedY);
  },

  onTap(x, y) {
    if (this.state === 'place') {
      if (this.reticle.object3D.visible) this.placeBins();
      return;
    }
    // Did we tap the trash? Shoot a ray from the camera through the finger.
    const item = this.item;
    if (!item || item.state !== 'ground') return;
    const screenPoint = { x: (x / innerWidth) * 2 - 1, y: -(y / innerHeight) * 2 + 1 }; // -1..1
    const cam = this.el.camera;
    // In phone AR, three.js forgets to update this "inverse lens" matrix, and the ray
    // needs it. Without this line, taps away from the screen centre would miss.
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.raycaster.setFromCamera(screenPoint, cam);
    // Small things are hard to hit with a finger, so "close to the ray" (25 cm) counts
    if (this.raycaster.ray.distanceToPoint(item.el.object3D.position) < 0.25) this.pickUp(item);
  },

  onSwipe(speedX, speedY) {
    if (this.item && this.item.state === 'held' && speedY < 0) this.throwItem(this.item, speedX, speedY);
  },

  // ----- Bins -----

  // Put the 4 bins in a row on the ring, turned to face the player
  placeBins() {
    const center = this.reticle.object3D.position.clone();
    this.el.camera.getWorldPosition(this.camPos);

    // One parent entity for the whole row. Turn it so its front (+Z) points at the camera.
    const row = document.createElement('a-entity');
    row.setAttribute('position', `${center.x} ${center.y} ${center.z}`);
    const angle = Math.atan2(this.camPos.x - center.x, this.camPos.z - center.z); // in radians
    row.setAttribute('rotation', `0 ${THREE.MathUtils.radToDeg(angle)} 0`);

    BINS.forEach((bin, i) => {
      const x = (i - 1.5) * BIN_SPACING; // -0.75, -0.25, 0.25, 0.75 → centred on the ring
      const el = makeBin(bin, x);
      row.appendChild(el);
      // Where is this bin in the world? (x along the turned row)
      const pos = new THREE.Vector3(center.x + x * Math.cos(angle), center.y, center.z - x * Math.sin(angle));
      this.bins.push({ el, type: bin.type, label: bin.label, pos });
    });
    this.el.appendChild(row);

    this.floorY = center.y; // remember the floor height (for trash and physics)
    this.state = 'play';

    // We don't need the ring anymore: stop it and hide it
    this.reticle.pause();
    this.reticle.object3D.visible = false;

    setTimeout(() => this.spawnTrash(), 600);
  },

  // ----- Trash -----

  // Make one random trash item somewhere around the player (also behind them!)
  spawnTrash() {
    const kind = TRASH[Math.floor(Math.random() * TRASH.length)];
    this.el.camera.getWorldPosition(this.camPos);

    // Pick a random spot 1 to 2 m away, in any direction. Try again if it's on top of a bin.
    let x, z;
    for (let tries = 0; tries < 20; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 1 + Math.random();
      x = this.camPos.x + Math.cos(angle) * dist;
      z = this.camPos.z + Math.sin(angle) * dist;
      if (this.bins.every(b => Math.hypot(x - b.pos.x, z - b.pos.z) > 0.5)) break;
    }

    const el = makeTrash(kind);
    el.setAttribute('position', `${x} ${this.floorY + kind.height / 2} ${z}`);
    this.el.appendChild(el);

    this.item = {
      el,
      type: kind.type,
      name: kind.name,
      halfHeight: kind.height / 2,
      state: 'ground',           // 'ground' → 'held' → 'flying' → back to 'ground' (miss) or gone (in a bin)
      velocity: new THREE.Vector3(),
    };
  },

  pickUp(item) {
    item.state = 'held';
    item.el.removeAttribute('animation'); // stop the pop-in animation if it's still running
  },

  throwItem(item, speedX, speedY) {
    // Faster swipe = faster throw (but not too slow or too fast)
    const speed = THREE.MathUtils.clamp(Math.hypot(speedX, speedY) * THROW_POWER, MIN_THROW_SPEED, MAX_THROW_SPEED);

    // Direction: where the camera looks (flat along the floor),
    // turned a bit left/right if the swipe went sideways
    const aim = Math.atan2(speedX, -speedY) * AIM_AMOUNT; // 0 = straight up the screen
    const yaw = this.getCameraYaw() - aim;
    const up = THREE.MathUtils.degToRad(THROW_ANGLE);
    const flat = speed * Math.cos(up); // the part of the speed going forward

    item.velocity.set(-Math.sin(yaw) * flat, speed * Math.sin(up), -Math.cos(yaw) * flat);
    item.spin = 6 + Math.random() * 6; // tumble while flying, looks more like a throw
    item.state = 'flying';
  },

  // ----- Every frame -----

  tick(time, delta) {
    const seconds = Math.min(delta / 1000, 0.05); // cap it, so a lag spike doesn't teleport things
    const item = this.item;
    if (item && item.state === 'held') this.followCamera(item, seconds);
    if (item && item.state === 'flying') this.updateFlying(item, seconds);
    this.updateMessage();
  },

  // A held item floats in front of the phone (it glides there, not jumps)
  followCamera(item, seconds) {
    const cam = this.el.camera;
    this.holdPoint.copy(this.holdOffset);
    cam.localToWorld(this.holdPoint);
    item.el.object3D.position.lerp(this.holdPoint, Math.min(1, seconds * 15));
    item.el.object3D.quaternion.copy(cam.getWorldQuaternion(this.camQuat));
  },

  // Simple physics: gravity pulls down, check bins, bounce on the floor
  updateFlying(item, seconds) {
    const obj = item.el.object3D;
    const pos = obj.position;
    const vel = item.velocity;
    const prevY = pos.y;

    vel.y -= GRAVITY * seconds;
    pos.addScaledVector(vel, seconds);
    obj.rotation.x += item.spin * seconds;

    const rimY = this.floorY + BIN_HEIGHT;
    for (const bin of this.bins) {
      const dx = pos.x - bin.pos.x;
      const dz = pos.z - bin.pos.z;
      const dist = Math.hypot(dx, dz);

      // Fell in through the top of the bin?
      if (prevY >= rimY && pos.y < rimY && dist < BIN_RADIUS) {
        this.landInBin(item, bin);
        return;
      }
      // Hit the outside wall of the bin? Push it out and bounce it back.
      const minDist = BIN_RADIUS + 0.04;
      if (pos.y < rimY && dist < minDist && dist > 0) {
        const nx = dx / dist, nz = dz / dist; // direction pointing away from the bin
        pos.x = bin.pos.x + nx * minDist;
        pos.z = bin.pos.z + nz * minDist;
        const towardsBin = vel.x * nx + vel.z * nz;
        if (towardsBin < 0) { // bounce back with 40% of the speed
          vel.x -= 1.4 * towardsBin * nx;
          vel.z -= 1.4 * towardsBin * nz;
        }
      }
    }

    // Floor: small bounce, then stop
    const groundY = this.floorY + item.halfHeight;
    if (pos.y <= groundY) {
      pos.y = groundY;
      if (vel.y < -1.2) { // still fast → bounce (loses most of its speed)
        vel.y *= -0.35;
        vel.x *= 0.5;
        vel.z *= 0.5;
      } else { // slow → lie still, stand it upright, it can be picked up again
        vel.set(0, 0, 0);
        obj.rotation.set(0, obj.rotation.y, 0);
        item.state = 'ground';
        this.showPopup('Missed!', '#ffd34d');
      }
    }
  },

  landInBin(item, bin) {
    item.el.remove(); // it's in the bin now
    this.item = null;

    // Bin does a little "gulp" bounce
    bin.el.removeAttribute('animation__gulp');
    bin.el.setAttribute('animation__gulp', 'property: scale; from: 1.2 0.85 1.2; to: 1 1 1; dur: 350; easing: easeOutBack');

    if (bin.type === item.type) {
      this.score += POINTS_RIGHT;
      this.scoreText.textContent = `Score: ${this.score}`;
      this.showPopup(`+${POINTS_RIGHT} ✓`, '#4ade80');
    } else {
      // Show where it should have gone. (Later, when we have a timer: wrong bin = lose time)
      const rightBin = BINS.find(b => b.type === item.type);
      this.showPopup(`Wrong bin ✗\n${item.name} → ${rightBin.label}`, '#ff5a5a');
    }
    setTimeout(() => this.spawnTrash(), 700);
  },

  // ----- Screen text -----

  // Big text in the middle that pops up and fades away
  showPopup(text, color) {
    this.popup.textContent = text;
    this.popup.style.color = color;
    this.popup.classList.remove('show');
    void this.popup.offsetWidth; // trick: forces the browser to restart the CSS animation
    this.popup.classList.add('show');
  },

  // Help text at the top: tells the player what to do next
  updateMessage() {
    const pc = this.el.is('pc-mode');
    const item = this.item;
    let text = '';
    if (this.state === 'place') {
      if (this.reticle.object3D.visible) text = (pc ? 'Click' : 'Tap') + ' to place the bins';
      else text = pc ? 'Arrow keys: look at the floor' : 'Move your phone slowly to find the floor';
    } else if (item && item.state === 'held') {
      text = `${item.name}: ${pc ? 'drag the mouse' : 'swipe'} up to throw!`;
    } else if (item && item.state === 'ground') {
      text = this.directionHint(item);
    }
    if (this.message.textContent !== text) {
      this.message.textContent = text;
      this.message.style.visibility = text ? 'visible' : 'hidden';
    }
  },

  // "Trash is to your left" etc., so you can find trash that spawned behind you
  directionHint(item) {
    this.el.camera.getWorldPosition(this.camPos);
    const p = item.el.object3D.position;
    const itemYaw = Math.atan2(-(p.x - this.camPos.x), -(p.z - this.camPos.z));
    let diff = itemYaw - this.getCameraYaw();
    diff = THREE.MathUtils.radToDeg(Math.atan2(Math.sin(diff), Math.cos(diff))); // -180..180
    if (Math.abs(diff) < 35) return `Tap the ${item.name.toLowerCase()} to pick it up`;
    if (Math.abs(diff) > 140) return '↓ Trash is behind you ↓';
    return diff > 0 ? '← Trash is to your left' : 'Trash is to your right →';
  },

  // Which way is the camera turned (left/right only, ignoring up/down)? In radians.
  getCameraYaw() {
    this.el.camera.getWorldQuaternion(this.camQuat);
    return this.euler.setFromQuaternion(this.camQuat, 'YXZ').y;
  }
});

// ---------- Bins ----------
// One entry per bin. "type" must match the trash "type" for points.
const BINS = [
  { type: 'pet',   label: 'PET',   color: '#2f7de1' },
  { type: 'alu',   label: 'ALU',   color: '#8f9aa5' },
  { type: 'glass', label: 'GLASS', color: '#2e9e4f' },
  { type: 'paper', label: 'PAPER', color: '#e0a526' },
];
const BIN_RADIUS = 0.2;   // metres (a bin is 40 cm wide)
const BIN_HEIGHT = 0.45;  // metres
const BIN_SPACING = 0.5;  // metres between bin centres

// Builds one bin: open tube + bottom + white rim + name sign. x = its spot in the row.
function makeBin(bin, x) {
  const el = document.createElement('a-entity');
  el.setAttribute('position', `${x} 0 0`);
  // Little "pop" when it appears (easeOutBack overshoots a bit, then settles)
  el.setAttribute('animation', 'property: scale; from: 0.01 0.01 0.01; to: 1 1 1; dur: 400; easing: easeOutBack');
  el.innerHTML = `
    <a-cylinder radius="${BIN_RADIUS}" height="${BIN_HEIGHT}" position="0 ${BIN_HEIGHT / 2} 0"
      open-ended="true" material="color: ${bin.color}; side: double"></a-cylinder>
    <a-circle radius="${BIN_RADIUS}" rotation="-90 0 0" position="0 0.005 0" color="#333"></a-circle>
    <a-torus radius="${BIN_RADIUS}" radius-tubular="0.012" rotation="90 0 0"
      position="0 ${BIN_HEIGHT} 0" color="#ffffff"></a-torus>
    <a-plane width="0.36" height="0.12" position="0 ${BIN_HEIGHT + 0.15} 0" color="${bin.color}"
      material="shader: flat"></a-plane>
    <a-text value="${bin.label}" align="center" width="1.6" color="#ffffff"
      position="0 ${BIN_HEIGHT + 0.15} 0.005"></a-text>`;
  return el;
}

// ---------- Trash ----------
// Placeholder shapes until we have real models. "type" says which bin is right.
const TRASH = [
  { type: 'pet',   name: 'PET bottle',   shape: 'cylinder', radius: 0.045, height: 0.24, color: '#9ad8ff', opacity: 0.75 },
  { type: 'alu',   name: 'Drink can',    shape: 'cylinder', radius: 0.04,  height: 0.13, color: '#d4d9de', metal: true },
  { type: 'glass', name: 'Glass bottle', shape: 'cylinder', radius: 0.045, height: 0.26, color: '#1f7a3a' },
  { type: 'paper', name: 'Newspaper',    shape: 'box', width: 0.22, height: 0.04, depth: 0.16, color: '#f1ede4' },
];

// Builds one trash item from an entry in TRASH
function makeTrash(kind) {
  const el = document.createElement(kind.shape === 'box' ? 'a-box' : 'a-cylinder');
  if (kind.shape === 'box') {
    el.setAttribute('width', kind.width);
    el.setAttribute('depth', kind.depth);
  } else {
    el.setAttribute('radius', kind.radius);
  }
  el.setAttribute('height', kind.height);
  el.setAttribute('material', {
    color: kind.color,
    opacity: kind.opacity || 1,
    transparent: !!kind.opacity,
    metalness: kind.metal ? 0.8 : 0,
    roughness: kind.metal ? 0.3 : 0.7,
  });
  el.setAttribute('animation', 'property: scale; from: 0.01 0.01 0.01; to: 1 1 1; dur: 350; easing: easeOutBack');
  return el;
}
