// Sort It Out: the bins, the trash and the rounds.
//
// Swiss recycling rules (a bit simplified for the game):
//   PET   = drink bottles only, in any colour
//   ALU   = aluminium cans, trays and foil
//   GLASS = bottles and jars, sorted by colour: clear, brown, green.
//           Other colours (blue, red…) go into green.
//   PAPER = newspapers, magazines, office paper
//   TRASH = household waste, for things that look recyclable but aren't
//
// All trash is built from simple A-Frame shapes, so there are no model files to download.
// To use a real 3D model instead, see "Adding 3D models" in the README.

// Makes an A-Frame element, e.g. make('a-box', { width: 1, color: 'red' })
function make(tag, attributes = {}) {
  const element = document.createElement(tag);
  for (const name in attributes) element.setAttribute(name, attributes[name]);
  return element;
}

// ---------- Bins ----------
const BIN_RADIUS = 0.16;    // a normal bin is 32 cm wide
const GLASS_RADIUS = 0.12;  // each glass opening is 24 cm wide
const BIN_HEIGHT = 0.45;    // all bins are 45 cm high
const STATION_GAP = 0.1;    // space between two stations
const GLASS_GAP = 0.02;     // space between the three glass openings

// A "station" is one spot in the row. The glass station has three openings, the others have one.
// "type" is what we compare with the trash's "bin" to see if a throw was right.
const STATIONS = [
  { label: 'PET',   color: '#2f7de1', openings: [{ type: 'pet',   name: 'PET' }] },
  { label: 'ALU',   color: '#8f9aa5', openings: [{ type: 'alu',   name: 'ALU' }] },
  { label: 'GLASS', color: '#3a7d6b', openings: [
    { type: 'glass-clear', name: 'GLASS (clear)', label: 'CLEAR', color: '#dfe9ee' },
    { type: 'glass-brown', name: 'GLASS (brown)', label: 'BROWN', color: '#7a4a21' },
    { type: 'glass-green', name: 'GLASS (green)', label: 'GREEN', color: '#2e8b47' },
  ] },
  { label: 'PAPER', color: '#e0a526', openings: [{ type: 'paper', name: 'PAPER' }] },
  { label: 'TRASH', color: '#4a4a4a', openings: [{ type: 'trash', name: 'TRASH' }] },
];

// Works out where every opening and sign stands in the row (x in metres, row centred on 0)
function layoutRow() {
  const openings = [];
  const signs = [];
  let x = 0;
  STATIONS.forEach(station => {
    const radius = station.openings.length > 1 ? GLASS_RADIUS : BIN_RADIUS;
    const start = x;
    station.openings.forEach((opening, i) => {
      if (i > 0) x += GLASS_GAP;
      openings.push({ ...opening, radius, x: x + radius, color: opening.color || station.color });
      x += 2 * radius;
    });
    signs.push({ label: station.label, color: station.color, x: (start + x) / 2, width: x - start });
    x += STATION_GAP;
  });
  const width = x - STATION_GAP;
  openings.forEach(o => { o.x -= width / 2; });
  signs.forEach(s => { s.x -= width / 2; });
  return { openings, signs, width };
}
const ROW = layoutRow();

// Name of the opening where an item belongs, e.g. 'GLASS (brown)'
function binName(type) {
  return ROW.openings.find(o => o.type === type).name;
}

// Builds the whole row of bins. Returns the row entity and its openings (each with its own entity).
function buildBinRow() {
  const row = make('a-entity');
  const popIn = 'property: scale; from: 0.01 0.01 0.01; to: 1 1 1; dur: 400; easing: easeOutBack';

  const openings = ROW.openings.map(o => {
    const glass = o.type.startsWith('glass');
    const bin = make('a-entity', { position: `${o.x} 0 0`, animation: popIn });
    // Open tube + dark bottom + rim (white, or the glass colour) + for glass a small colour label
    bin.innerHTML = `
      <a-cylinder radius="${o.radius}" height="${BIN_HEIGHT}" position="0 ${BIN_HEIGHT / 2} 0"
        open-ended="true" material="color: ${o.color}; side: double; roughness: 0.6"></a-cylinder>
      <a-circle radius="${o.radius}" rotation="-90 0 0" position="0 0.005 0" color="#2b2b2b"></a-circle>
      <a-torus radius="${o.radius}" radius-tubular="0.012" rotation="90 0 0" position="0 ${BIN_HEIGHT} 0"
        color="${glass ? o.color : '#ffffff'}"></a-torus>
      ${glass ? `
      <a-plane width="${o.radius * 1.6}" height="0.07" position="0 ${BIN_HEIGHT * 0.62} ${o.radius + 0.004}"
        material="color: #ffffff; shader: flat"></a-plane>
      <a-text value="${o.label}" align="center" width="0.9" color="#222222"
        position="0 ${BIN_HEIGHT * 0.62} ${o.radius + 0.006}"></a-text>` : ''}`;
    row.appendChild(bin);
    return { ...o, el: bin };
  });

  // One sign per station (the glass station gets one big "GLASS" sign over its three openings)
  ROW.signs.forEach(s => {
    const sign = make('a-entity', { position: `${s.x} ${BIN_HEIGHT + 0.16} 0`, animation: popIn });
    sign.innerHTML = `
      <a-plane width="${Math.max(0.34, s.width * 0.55)}" height="0.12" material="color: ${s.color}; shader: flat"></a-plane>
      <a-text value="${s.label}" align="center" width="1.6" color="#ffffff" position="0 0 0.005"></a-text>`;
    row.appendChild(sign);
  });
  return { row, openings };
}

// ---------- Trash: what it looks like ----------
const TRASH_SCALE = 1.3; // trash is shown 30% bigger than in real life, so it's easier to see and tap

// How surfaces look
const MAT = {
  plastic: c => `color: ${c}; opacity: 0.6; transparent: true; roughness: 0.2`,
  glass:   c => `color: ${c}; opacity: 0.8; transparent: true; roughness: 0.05; metalness: 0.1`,
  metal:   c => `color: ${c}; roughness: 0.3; metalness: 0.35`,
  shiny:   c => `color: ${c}; roughness: 0.35`,
  matte:   c => `color: ${c}; roughness: 0.9`,
  print:   c => `color: ${c}; shader: flat`, // printed on paper, not affected by light
};

// Shape helpers. Parts are stacked from the bottom: y0 = bottom of the part, y1 = top.
function cylinder(radius, y0, y1, material) {
  return make('a-cylinder', { radius, height: y1 - y0, position: `0 ${(y0 + y1) / 2} 0`, material });
}
function cone(radiusBottom, radiusTop, y0, y1, material) {
  return make('a-cone', {
    'radius-bottom': radiusBottom, 'radius-top': radiusTop,
    height: y1 - y0, position: `0 ${(y0 + y1) / 2} 0`, material,
  });
}
function box(width, depth, y0, y1, material) {
  return make('a-box', { width, depth, height: y1 - y0, position: `0 ${(y0 + y1) / 2} 0`, material });
}
// Something flat printed on top of an object (headlines, grease spots…) at height y
function decal(width, depth, y, material, x = 0, z = 0) {
  return make('a-plane', { width, height: depth, rotation: '-90 0 0', position: `${x} ${y} ${z}`, material });
}

// Every shape returns its parts plus its size: height, radius (for rolling) and kind:
//   'upright' = bottles, cans… (stand up, lie down after a throw, can roll)
//   'flat'    = paper, boxes… (always lie flat, never roll)
//   'ball'    = crumpled things (can roll)
const SHAPES = {
  // Plastic drink bottle: body, shoulder, neck, cap and a label
  petBottle(t) {
    const H = (t.slim ? 0.27 : 0.24) * TRASH_SCALE;
    const R = (t.slim ? 0.033 : 0.04) * TRASH_SCALE;
    const body = MAT.plastic(t.color);
    return { height: H, radius: R, kind: 'upright', parts: [
      cylinder(R, 0, 0.62 * H, body),
      cone(R, 0.36 * R, 0.62 * H, 0.82 * H, body),
      cylinder(0.36 * R, 0.82 * H, 0.92 * H, body),
      cylinder(0.44 * R, 0.92 * H, H, MAT.shiny(t.cap)),
      cylinder(1.03 * R, 0.25 * H, 0.47 * H, MAT.matte(t.label)),
    ] };
  },

  // Glass bottle with a long neck (wine), or shorter (beer)
  glassBottle(t) {
    const H = (t.short ? 0.23 : 0.3) * TRASH_SCALE;
    const R = (t.short ? 0.034 : 0.038) * TRASH_SCALE;
    const glass = MAT.glass(t.color);
    const shoulder = t.short ? 0.6 : 0.55; // where the neck starts (part of the height)
    const parts = [
      cylinder(R, 0, shoulder * H, glass),
      cone(R, 0.32 * R, shoulder * H, (shoulder + 0.15) * H, glass),
      cylinder(0.32 * R, (shoulder + 0.15) * H, 0.96 * H, glass),
      cylinder(0.4 * R, 0.96 * H, H, glass),
    ];
    if (t.label) parts.push(cylinder(1.02 * R, 0.2 * H, 0.42 * H, MAT.matte(t.label)));
    return { height: H, radius: R, kind: 'upright', parts };
  },

  // Glass jar without a lid
  jar(t) {
    const H = 0.12 * TRASH_SCALE, R = 0.045 * TRASH_SCALE;
    const glass = MAT.glass(t.color);
    return { height: H, radius: R, kind: 'upright', parts: [
      cylinder(R, 0, 0.88 * H, glass),
      cylinder(0.86 * R, 0.88 * H, H, glass), // the screw thread at the top
    ] };
  },

  // Drink can: coloured body, silver top and bottom, optional stripe
  can(t) {
    const H = (t.tall ? 0.168 : 0.122) * TRASH_SCALE;
    const R = (t.tall ? 0.029 : 0.033) * TRASH_SCALE;
    const silver = MAT.metal('#d9dee3');
    const parts = [
      cylinder(0.9 * R, 0, 0.04 * H, silver),
      cylinder(R, 0.04 * H, 0.93 * H, MAT.metal(t.color)),
      cylinder(0.88 * R, 0.93 * H, H, silver),
    ];
    if (t.stripe) parts.push(cylinder(1.01 * R, 0.45 * H, 0.6 * H, MAT.shiny(t.stripe)));
    return { height: H, radius: R, kind: 'upright', parts };
  },

  // Aluminium food tray
  tray() {
    const W = 0.2 * TRASH_SCALE, D = 0.14 * TRASH_SCALE, H = 0.035 * TRASH_SCALE;
    return { height: H, radius: H / 2, kind: 'flat', parts: [
      box(W, D, 0, H, MAT.metal('#cfd5da')),
      decal(W * 0.84, D * 0.8, H + 0.001, MAT.matte('#a9b1b8')), // the inside of the tray
    ] };
  },

  // Crumpled ball (aluminium foil, used tissue). Few faces + flat shading = crumpled look.
  crumple(t) {
    const R = 0.045 * TRASH_SCALE;
    const look = t.metal ? MAT.metal(t.color) : MAT.matte(t.color);
    return { height: 1.6 * R, radius: 0.8 * R, kind: 'ball', parts: [
      make('a-sphere', {
        radius: R, 'segments-width': 7, 'segments-height': 5, scale: '1 0.8 1',
        position: `0 ${0.8 * R} 0`, material: `${look}; flatShading: true`,
      }),
    ] };
  },

  // Folded newspaper with a headline, a photo and text lines
  newspaper() {
    const W = 0.26 * TRASH_SCALE, D = 0.18 * TRASH_SCALE, H = 0.025 * TRASH_SCALE;
    const top = H + 0.001, ink = MAT.print('#3a3a3a');
    return { height: H, radius: H / 2, kind: 'flat', parts: [
      box(W, D, 0, H, MAT.matte('#efece4')),
      decal(W * 0.8, D * 0.14, top, ink, 0, -D * 0.3),                       // headline
      decal(W * 0.36, D * 0.42, top, MAT.print('#9a9a9a'), -W * 0.2, D * 0.1), // photo
      decal(W * 0.36, D * 0.05, top, ink, W * 0.2, -D * 0.04),                 // text lines
      decal(W * 0.36, D * 0.05, top, ink, W * 0.2, D * 0.08),
      decal(W * 0.36, D * 0.05, top, ink, W * 0.2, D * 0.2),
    ] };
  },

  // Glossy magazine with a title and a cover photo
  magazine(t) {
    const W = 0.21 * TRASH_SCALE, D = 0.28 * TRASH_SCALE, H = 0.012 * TRASH_SCALE;
    return { height: H, radius: H / 2, kind: 'flat', parts: [
      box(W, D, 0, H, MAT.shiny(t.color)),
      decal(W * 0.84, D * 0.13, H + 0.001, MAT.print('#ffffff'), 0, -D * 0.36),
      decal(W * 0.6, D * 0.45, H + 0.001, MAT.print(t.accent), 0, D * 0.1),
    ] };
  },

  // A small stack of printer paper
  paperStack() {
    const W = 0.21 * TRASH_SCALE, D = 0.297 * TRASH_SCALE, H = 0.03 * TRASH_SCALE;
    const line = MAT.print('#b5b5b5');
    return { height: H, radius: H / 2, kind: 'flat', parts: [
      box(W, D, 0, H, MAT.matte('#fbfbfb')),
      decal(W * 0.7, D * 0.03, H + 0.001, line, 0, -D * 0.25),
      decal(W * 0.7, D * 0.03, H + 0.001, line, 0, -D * 0.15),
      decal(W * 0.7, D * 0.03, H + 0.001, line, 0, -D * 0.05),
    ] };
  },

  // Cardboard pizza box with a logo and grease spots
  pizzaBox() {
    const W = 0.32 * TRASH_SCALE, H = 0.045 * TRASH_SCALE;
    const grease = 'color: #5a3a1a; opacity: 0.55; transparent: true; shader: flat';
    const spot = (radius, x, z, y, material) =>
      make('a-circle', { radius, rotation: '-90 0 0', position: `${x} ${y} ${z}`, material });
    return { height: H, radius: H / 2, kind: 'flat', parts: [
      box(W, W, 0, H, MAT.matte('#c9a26b')),
      spot(0.05 * TRASH_SCALE, 0, 0, H + 0.001, MAT.print('#d23b2a')),               // logo
      spot(0.05 * TRASH_SCALE, -0.07 * TRASH_SCALE, 0.07 * TRASH_SCALE, H + 0.002, grease),
      spot(0.035 * TRASH_SCALE, 0.08 * TRASH_SCALE, -0.06 * TRASH_SCALE, H + 0.002, grease),
    ] };
  },

  // Drinking glass: open on top, thick bottom
  tumbler() {
    const H = 0.1 * TRASH_SCALE, R = 0.037 * TRASH_SCALE;
    return { height: H, radius: R, kind: 'upright', parts: [
      make('a-cylinder', {
        radius: R, height: H, position: `0 ${H / 2} 0`, 'open-ended': true,
        material: `${MAT.glass('#e6f2f7')}; side: double`,
      }),
      cylinder(0.96 * R, 0, 0.12 * H, MAT.glass('#cfe3ea')),
    ] };
  },

  // Shampoo bottle: flat oval body, flip cap, label
  shampoo(t) {
    const H = 0.19 * TRASH_SCALE, R = 0.042 * TRASH_SCALE;
    return { height: H, radius: R, kind: 'upright', parts: [
      make('a-cylinder', {
        radius: R, height: 0.84 * H, position: `0 ${0.42 * H} 0`, scale: '1 1 0.55', material: MAT.shiny(t.color),
      }),
      cylinder(0.5 * R, 0.84 * H, H, MAT.shiny('#ffffff')),
      make('a-plane', {
        width: 1.1 * R, height: 0.3 * H, position: `0 ${0.45 * H} ${0.56 * R}`, material: MAT.print('#ffffff'),
      }),
    ] };
  },

  // Ceramic mug with a handle and a coffee stain inside
  mug(t) {
    const H = 0.095 * TRASH_SCALE, R = 0.04 * TRASH_SCALE;
    return { height: H, radius: R, kind: 'upright', parts: [
      cylinder(R, 0, H, MAT.shiny(t.color)),
      make('a-circle', { radius: 0.85 * R, rotation: '-90 0 0', position: `0 ${H + 0.001} 0`, material: MAT.matte('#5b3b25') }),
      make('a-torus', { radius: 0.3 * H, 'radius-tubular': 0.05 * H, position: `${R} ${H / 2} 0`, material: MAT.shiny(t.color) }),
    ] };
  },
};

// ---------- Trash: the list ----------
// bin    = where it belongs (an opening "type" from STATIONS)
// round  = first round it shows up in
// tricky = looks like it goes somewhere else (only in round 3)
// tip    = shown when it lands in the wrong bin
// model  = optional: path to a .glb file to use instead of the simple shapes
const TRASH = [
  // PET: drink bottles in every colour
  { name: 'Water bottle', bin: 'pet', round: 1, shape: 'petBottle', color: '#cfe8ff', cap: '#2f7de1', label: '#2f7de1' },
  { name: 'Iced tea bottle', bin: 'pet', round: 1, shape: 'petBottle', color: '#f2a93b', cap: '#ffffff', label: '#c2410c' },
  { name: 'Lemon soda bottle', bin: 'pet', round: 1, shape: 'petBottle', color: '#7bd389', cap: '#1e7b34', label: '#fde047' },
  { name: 'Cola bottle', bin: 'pet', round: 2, shape: 'petBottle', color: '#3b1d0e', cap: '#d62828', label: '#d62828' },
  { name: 'Sports drink bottle', bin: 'pet', round: 2, shape: 'petBottle', color: '#3fa7f5', cap: '#f97316', label: '#f97316', slim: true },

  // ALU: cans, trays, foil
  { name: 'Drink can', bin: 'alu', round: 1, shape: 'can', color: '#d62828', stripe: '#ffffff' },
  { name: 'Energy drink can', bin: 'alu', round: 2, shape: 'can', color: '#1d4ed8', stripe: '#a3e635', tall: true },
  { name: 'Aluminium tray', bin: 'alu', round: 2, shape: 'tray' },
  { name: 'Aluminium foil', bin: 'alu', round: 2, shape: 'crumple', color: '#d5dbe0', metal: true },

  // GLASS: sorted by colour
  { name: 'Jam jar', bin: 'glass-clear', round: 1, shape: 'jar', color: '#e8f3f7' },
  { name: 'Clear glass bottle', bin: 'glass-clear', round: 2, shape: 'glassBottle', color: '#e8f3f7', label: '#2f7de1' },
  { name: 'Beer bottle', bin: 'glass-brown', round: 1, shape: 'glassBottle', color: '#7a3e10', label: '#f2c94c', short: true },
  { name: 'Wine bottle', bin: 'glass-green', round: 1, shape: 'glassBottle', color: '#1f6b2e', label: '#f5ecd7' },

  // PAPER
  { name: 'Newspaper', bin: 'paper', round: 1, shape: 'newspaper' },
  { name: 'Magazine', bin: 'paper', round: 2, shape: 'magazine', color: '#e85d75', accent: '#3b82f6' },
  { name: 'Printer paper', bin: 'paper', round: 2, shape: 'paperStack' },

  // Tricky items (round 3)
  { name: 'Blue glass bottle', bin: 'glass-green', round: 3, tricky: true, shape: 'glassBottle', color: '#2456b8',
    tip: 'Glass in other colours, like blue, goes into the GREEN opening.' },
  { name: 'Shampoo bottle', bin: 'trash', round: 3, tricky: true, shape: 'shampoo', color: '#f472b6',
    tip: 'Only drink bottles go into PET. Shampoo bottles are household waste.' },
  { name: 'Cooking oil bottle', bin: 'trash', round: 3, tricky: true, shape: 'petBottle', color: '#e8c547', cap: '#15803d', label: '#15803d', slim: true,
    tip: 'Oil bottles are not drink bottles, so they don\'t go into PET.' },
  { name: 'Drinking glass', bin: 'trash', round: 3, tricky: true, shape: 'tumbler',
    tip: 'Drinking glasses melt differently than bottles. They are household waste.' },
  { name: 'Greasy pizza box', bin: 'trash', round: 3, tricky: true, shape: 'pizzaBox',
    tip: 'Greasy cardboard can\'t be recycled. It is household waste.' },
  { name: 'Used tissue', bin: 'trash', round: 3, tricky: true, shape: 'crumple', color: '#f5f5f5',
    tip: 'Used tissues are not recycled with paper. They are household waste.' },
  { name: 'Ceramic mug', bin: 'trash', round: 3, tricky: true, shape: 'mug', color: '#f8fafc',
    tip: 'Ceramics don\'t belong in the glass container. They are household waste.' },
];

// Tip for a wrong throw when the item has no tip of its own
const BIN_TIPS = {
  'pet': 'All drink bottles go into PET, whatever their colour.',
  'alu': 'Cans, trays and foil go into ALU.',
  'glass-clear': 'Clear glass goes into the CLEAR glass opening.',
  'glass-brown': 'Brown glass goes into the BROWN glass opening.',
  'glass-green': 'Green glass goes into the GREEN glass opening.',
  'paper': 'Newspapers, magazines and office paper go into PAPER.',
  'trash': 'Not everything that looks recyclable is.',
};

// ---------- Rounds ----------
const ROUNDS = [
  { title: 'Round 1: The basics', hint: 'Sort the trash before time runs out!', maxItems: 3, rolling: false, trickyChance: 0 },
  { title: 'Round 2: Rush hour', hint: 'Hurry: trash rolls away if you leave it!', maxItems: 4, rolling: true, trickyChance: 0 },
  { title: 'Round 3: Tricky trash', hint: 'Careful: not everything is what it looks like!', maxItems: 5, rolling: true, trickyChance: 0.45 },
];

// Picks a random trash item for a round (not the same one as last time)
function pickTrash(roundNumber, lastName) {
  const tricky = Math.random() < ROUNDS[roundNumber - 1].trickyChance;
  const pool = TRASH.filter(t => t.round <= roundNumber && !!t.tricky === tricky && t.name !== lastName);
  return pool[Math.floor(Math.random() * pool.length)];
}

// Builds one trash item. Returns its entity and its size (the physics needs the size).
function buildTrash(kind) {
  const shape = SHAPES[kind.shape](kind);
  const item = make('a-entity');
  // The parts are stacked from the bottom. Move them down by half the height,
  // so the item's centre is its middle (then it spins nicely when thrown).
  const inner = make('a-entity', { position: `0 ${-shape.height / 2} 0` });
  if (kind.model) inner.appendChild(make('a-entity', { 'gltf-model': `url(${kind.model})` }));
  else shape.parts.forEach(part => inner.appendChild(part));
  item.appendChild(inner);
  return { el: item, height: shape.height, radius: shape.radius, shape: shape.kind };
}
