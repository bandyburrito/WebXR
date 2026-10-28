// Sort It Out: game logic
// Step 0: find the real floor and place a test cube with a tap.
//
// Two ways to play:
//   - AR mode (phone):   real camera, real floor.
//   - PC test mode:      a fake grey floor, mouse = finger, keys to move.

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
// Lives on <a-scene>. Shows/hides the screens and reacts to taps.
AFRAME.registerComponent('game', {
  init() {
    this.reticle = document.querySelector('#reticle');
    this.message = document.querySelector('#message');
    this.overlay = document.querySelector('#overlay');
    const startScreen = document.querySelector('#start-screen');

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

    // A tap anywhere on the screen (the overlay covers the whole screen in AR)
    this.overlay.addEventListener('pointerup', () => this.onTap());
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

  onTap() {
    if (!this.reticle.object3D.visible) return; // no floor found yet

    // Step 0 test: drop a small cube where the ring is
    const p = this.reticle.object3D.position;
    const cube = document.createElement('a-box');
    cube.setAttribute('width', 0.2);
    cube.setAttribute('height', 0.2);
    cube.setAttribute('depth', 0.2);
    cube.setAttribute('color', '#4ade80');
    cube.setAttribute('position', `${p.x} ${p.y + 0.1} ${p.z}`); // +0.1 = half its height, so it sits on the floor
    this.el.appendChild(cube);
  },

  tick() {
    // Keep the help text up to date
    const pc = this.el.is('pc-mode');
    let text;
    if (this.reticle.object3D.visible) text = pc ? 'Click to place a cube' : 'Tap to place a cube';
    else text = pc ? 'Arrow keys: look at the floor' : 'Move your phone slowly to find the floor';
    if (this.message.textContent !== text) this.message.textContent = text;
  }
});
