/* ============================================================
   CLIENTS GALLERY — the island's first sub-environment.
   A curved gallery wall of client pieces sharing the island's
   staging: the avatar stays put, the arc rotates. Loaded only
   when someone steps into the clients pavilion.

   The createGallery(ctx) → controller interface is the pattern
   future sub-environments (e.g. a case-study museum) should
   follow: { group, enter, exit, update, pick, keyInteract,
   chip, applyTheme }.
   ============================================================ */

export function createGallery({ THREE, C, items, label, makeTextSprite, stdMat, glowMat, rng, reduced }) {
  /* Depth order seen from the camera (at z≈+37 looking at the origin):
     walkway/avatar arc (r 24) → art pieces (r 20.5) → back wall (r 17.5).
     Bigger radius = closer to the camera on this side — the wall must have
     the SMALLEST radius or it stands in front of the art. */
  const GAL_R = 20.5;          // pieces sit on this radius, facing the camera
  const SPACING = 0.19;        // radians between pieces
  const NEAR = 0.085;

  const group = new THREE.Group();
  group.visible = false;

  const arc = new THREE.Group(); // rotates like the island world does
  group.add(arc);

  /* the room needs its own light — the island's night is too dark for reading art */
  group.add(new THREE.AmbientLight(0x2a3f66, 1.5));

  const span = (items.length - 1) * SPACING;
  const minA = -span / 2 - 0.12, maxA = span / 2 + 0.12;

  /* ── Room ── */
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(34, 34, 0.3, 48),
    stdMat(0x0a1a3a)
  );
  floor.position.y = -0.15;
  arc.add(floor);

  /* soft walkway band along the arc */
  const band = new THREE.Mesh(
    new THREE.RingGeometry(22.6, 25.2, 64, 1, Math.PI - span / 2 - 0.25, span + 0.5),
    new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
  );
  band.rotation.x = -Math.PI / 2;
  band.rotation.z = Math.PI;      // ring theta 0 sits on +x; rotate so the band faces the camera side
  band.position.y = 0.02;
  arc.add(band);

  /* curved back wall behind the pieces (smaller radius = farther from camera) */
  const WALL_R = 17.5;
  const wallSegs = items.length * 2 + 3;
  for (let i = 0; i < wallSegs; i++) {
    const a = minA - 0.1 + ((span + 0.2 + 0.24) / (wallSegs - 1)) * i;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(2.6, 7.4, 0.4), stdMat(0x11244e));
    seg.position.set(Math.sin(a) * WALL_R, 3.55, Math.cos(a) * WALL_R);
    seg.rotation.y = a;
    arc.add(seg);
  }
  /* columns at both ends, just in front of the wall */
  for (const a of [minA - 0.14, maxA + 0.14]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 6.8, 8), stdMat(0x16305e));
    col.position.set(Math.sin(a) * (WALL_R + 1), 3.4, Math.cos(a) * (WALL_R + 1));
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.8), glowMat(C.gold, 0.6));
    cap.position.set(Math.sin(a) * (WALL_R + 1), 6.9, Math.cos(a) * (WALL_R + 1));
    arc.add(col, cap);
  }

  /* gallery label floating above the centre */
  const labelSprite = (() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 96;
    const g = c.getContext('2d');
    g.font = "700 34px 'Maven Pro', sans-serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(224,166,20,.92)';
    g.fillText(label.toUpperCase(), 512, 50, 990);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
    s.scale.set(12.5, 1.15, 1);
    s.position.set(0, 5.9, 18.4);
    return s;
  })();
  /* In the static group, NOT the rotating arc: walking used to swing the
     banner sideways where the curved wall depth-clipped its ends. Fixed
     above the pieces it reads as room signage and can never clip. */
  group.add(labelSprite);

  /* ── Pieces ── */
  function plaqueTexture(name, sector) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 384;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 384);
    bg.addColorStop(0, '#1a3464');
    bg.addColorStop(1, '#101f45');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 384);
    g.strokeStyle = 'rgba(224,166,20,.8)';
    g.lineWidth = 4;
    g.strokeRect(18, 18, 476, 348);
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = "800 52px 'Maven Pro', sans-serif";
    g.fillText(name, 256, 185, 440);
    g.fillStyle = 'rgba(224,166,20,.9)';
    g.font = "600 24px 'Maven Pro', sans-serif";
    const sp = sector.toUpperCase().split('').join(' ');
    g.fillText(sp, 256, 238, 440);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function namePlateTexture(name, sector) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(7,19,58,.92)';
    g.fillRect(0, 0, 512, 128);
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = "700 40px 'Maven Pro', sans-serif";
    g.fillText(name, 256, 52, 470);
    g.fillStyle = 'rgba(224,166,20,.9)';
    g.font = "600 21px 'Maven Pro', sans-serif";
    g.fillText(sector.toUpperCase(), 256, 96, 470);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const texLoader = new THREE.TextureLoader();
  const pieces = items.map((item, i) => {
    const a = minA + 0.12 + i * SPACING;
    const p = new THREE.Group();
    p.position.set(Math.sin(a) * GAL_R, 0, Math.cos(a) * GAL_R);
    p.rotation.y = a;                    // +z faces the camera
    p.userData.itemIndex = i;

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.5, 0.9), stdMat(0x102246));
    plinth.position.y = 0.25;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.85, 2.15, 0.14), stdMat(0xc9971f, { roughness: 0.55 }));
    frame.position.y = 2.35;

    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.9),
      new THREE.MeshBasicMaterial({ map: plaqueTexture(item.name, item.sector) })
    );
    art.position.set(0, 2.35, 0.09);
    if (item.image) {
      texLoader.load(item.image, t => {
        t.colorSpace = THREE.SRGBColorSpace;
        art.material.map = t;
        art.material.needsUpdate = true;
      });
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 0.4),
        new THREE.MeshBasicMaterial({ map: namePlateTexture(item.name, item.sector), transparent: true })
      );
      plate.position.set(0, 0.9, 0.48);
      plate.rotation.x = -0.25;
      p.add(plate);
    }

    /* picture light */
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.14), glowMat(C.lamp, 1.3));
    bar.position.set(0, 3.75, 0.25);
    const spot = new THREE.PointLight(C.lamp, 7, 9, 1.5);
    spot.position.set(0, 3.4, 1.1);

    /* selection ring on the floor */
    const sel = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.07, 6, 40),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    sel.rotation.x = Math.PI / 2;
    sel.position.y = 0.06;

    p.add(plinth, frame, art, bar, spot, sel);
    arc.add(p);
    return { item, group: p, angle: a, sel, spot };
  });
  const hitList = pieces.map(p => p.group);

  /* ── Controller state ── */
  let galAngle = 0;
  let autoTarget = null;
  let selected = null;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function angTo(a, b) { return b - a; } // small arc, no wrapping needed

  function nearest() {
    let best = null, bestD = Infinity;
    for (const p of pieces) {
      const d = Math.abs(p.angle - galAngle);
      if (d < bestD) { bestD = d; best = p; }
    }
    return { p: best, d: bestD };
  }

  function select(p) {
    selected = p;
    autoTarget = clamp(p.angle, minA, maxA);
  }

  return {
    group,

    enter() {
      group.visible = true;
      galAngle = 0;
      arc.rotation.y = 0;
      autoTarget = null;
      selected = null;
    },
    exit() {
      group.visible = false;
      selected = null;
      autoTarget = null;
    },

    update(dt, vel, t) {
      if (Math.abs(vel) > 0.0004) {
        galAngle = clamp(galAngle + vel * dt, minA, maxA);
        if (galAngle === minA || galAngle === maxA) vel = 0;
        autoTarget = null;
      } else if (autoTarget != null) {
        const d = angTo(galAngle, autoTarget);
        if (Math.abs(d) < 0.01) { galAngle = autoTarget; autoTarget = null; }
        else galAngle += Math.sign(d) * Math.min(Math.abs(d), dt * 0.5);
      }
      arc.rotation.y = -galAngle;

      for (const p of pieces) {
        const target = p === selected ? 0.5 + (reduced ? 0 : Math.sin(t * 3) * 0.18) : 0;
        p.sel.material.opacity = p.sel.material.opacity + (target - p.sel.material.opacity) * 0.12;
      }
    },

    pick(raycaster, openItem) {
      const hits = raycaster.intersectObjects(hitList, true);
      if (!hits.length) return false;
      let obj = hits[0].object;
      while (obj && obj.userData.itemIndex == null) obj = obj.parent;
      if (!obj) return false;
      const p = pieces[obj.userData.itemIndex];
      if (selected === p && Math.abs(p.angle - galAngle) < NEAR) openItem(p.item);
      else select(p);
      return true;
    },

    keyInteract(openItem) {
      const { p, d } = nearest();
      if (d < NEAR) { selected = p; openItem(p.item); }
      else if (selected) select(selected);
    },

    chip() {
      const coarse = matchMedia('(pointer: coarse)').matches;
      const { p, d } = nearest();
      if (selected && Math.abs(selected.angle - galAngle) < NEAR) {
        return { title: selected.item.name, hint: coarse ? 'tap again to view' : 'click again or press E to view' };
      }
      if (selected && autoTarget != null) return { title: selected.item.name, hint: 'walking there…' };
      if (d < NEAR) return { title: p.item.name, hint: `${p.item.sector} — ${coarse ? 'tap' : 'E'} to view` };
      return { title: 'The Clients Gallery', hint: 'Esc returns to the island' };
    },

    applyTheme(light) {
      for (const p of pieces) p.spot.intensity = light ? 2.5 : 7;
      labelSprite.material.opacity = light ? 0.75 : 1;
    },
  };
}
