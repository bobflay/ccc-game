/* ============================================
   CACAO TRAÇABILITÉ — Système National de Traçabilité (SNT)
   Conseil du Café-Cacao (Côte d'Ivoire)

   Parcours gamifié (3 stations) :
     1. Géolocaliser sa parcelle (bornes) → enregistrement EUDR
     2. Retirer la Carte du Producteur au Guichet CCC
     3. Récolter le cacao (remplir les sacs)
     4. Vente tracée à la coopérative :
        scan carte → pesée → scellés → prix officiel → paiement Carte
     + Cash-out de la Carte vers Mobile Money au PUSH POS

   Chaque station a une dalle d'action : se placer dessus
   déclenche automatiquement l'action (pas de bouton).
   ============================================ */

import * as THREE from 'three';

/* ---------- Constantes ---------- */
const OFFICIAL_PRICE   = 1800;  // FCFA / kg — prix bord-champ officiel (paramétrable)
const TRUCK_CAPACITY   = 40;    // sacs par camion
const TRUCK_SPEED      = 10;    // u/s
const LOAD_INTERVAL    = 0.22;  // s par sac chargé sur le camion
const HARVEST_MIN_KG   = 6;     // kg de fèves séchées par cabosse récoltée (min)
const HARVEST_MAX_KG   = 10;    // kg (max)
const HARVEST_TARGET   = 40;    // kg à récolter pour valider l'étape guidée
const INTERACT_RADIUS  = 3.2;
const HARVEST_COOLDOWN = 0.5;   // s entre deux cabosses récoltées automatiquement
const SACK_VISUAL_KG   = 12;    // kg représentés par un sac porté sur le dos
const CASH_PER_BUNDLE  = 50000; // FCFA par liasse portée
const MAX_BUNDLES      = 24;    // liasses visibles au maximum
const MAX_SACKS        = 20;    // sacs portables au maximum
const MAX_CARRY_KG     = MAX_SACKS * SACK_VISUAL_KG; // au-delà : vendre d'abord
const PAD_RADIUS       = 1.3;   // rayon de déclenchement d'une dalle d'action
const PAD_EXIT_RADIUS  = 2.0;   // il faut sortir de ce rayon pour réarmer la dalle
const BORNE_RADIUS     = 2.8;   // rayon de capture d'une borne (géoloc)
const PLAYER_SPEED     = 6.5;

const ZONES = ['DALOA', 'SAN-PÉDRO', 'SOUBRÉ', 'ABENGOUROU', 'GAGNOA',
    'DIVO', 'ABOISSO', 'DUÉKOUÉ', 'MÉAGUI', 'BONGOUANOU', 'AGBOVILLE', 'ISSIA', 'MAN'];

/* ---------- État ---------- */
const state = {
    started: false,
    step: 1,               // 1 géoloc, 2 carte, 3 récolte, 4 vente, 0 = libre
    bornesVisited: 0,
    plotRegistered: false,
    hasCard: false,
    matricule: '',
    zone: '',
    cacaoKg: 0,            // fèves récoltées, pas encore vendues
    cardBalance: 0,        // FCFA sur la Carte du Producteur
    cash: 0,               // FCFA en espèces (liasses portées, après cash-out)
    fieldsOwned: 0,        // parcelles supplémentaires achetées
    score: 0,              // score de traçabilité
    coopSacks: 0,          // sacs déposés à la coopérative (dépôt)
    shippedSacks: 0,       // sacs expédiés par camion (solde coopérative)
    firstSaleDone: false,
    busy: false,           // séquence de vente en cours
};

/* ---------- Scène ---------- */
const root = document.getElementById('game-root');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bd7ff);
scene.fog = new THREE.Fog(0x9bd7ff, 45, 85);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.appendChild(renderer.domElement);

let camera;
// Caméra orbitale : azimut + hauteur pilotés en glissant sur l'écran
const CAM_RADIUS = Math.hypot(18, 18);
let camAzimuth = Math.PI / 4;   // équivaut à l'ancien offset (18, 22, 18)
let camHeight = 22;
const camOffset = new THREE.Vector3();
function computeCamOffset() {
    camOffset.set(Math.sin(camAzimuth) * CAM_RADIUS, camHeight, Math.cos(camAzimuth) * CAM_RADIUS);
    return camOffset;
}
const VIEW_SIZE = 15;
function buildCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.OrthographicCamera(
        -VIEW_SIZE * aspect, VIEW_SIZE * aspect, VIEW_SIZE, -VIEW_SIZE, 0.1, 200);
    camera.position.copy(computeCamOffset());
    camera.lookAt(0, 0, 0);
}
buildCamera();

function resize() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -VIEW_SIZE * aspect;
    camera.right = VIEW_SIZE * aspect;
    camera.top = VIEW_SIZE;
    camera.bottom = -VIEW_SIZE;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

/* ---------- Lumières ---------- */
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8e3a, 0.85));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.1);
sun.position.set(20, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
const sc = 40;
sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
sun.shadow.bias = -0.0005;
scene.add(sun);

/* ---------- Sol ---------- */
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Parcelle (terre) où poussent les cacaoyers
const dirt = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.15, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 1 }));
dirt.position.set(-13, 0.075, -6);
dirt.receiveShadow = true;
scene.add(dirt);

/* ---------- Cacaoyers ---------- */
const cacaoTrees = [];
const podColors = [0xd97706, 0xb91c1c, 0xf59e0b];

function makeCacaoTree(x, z) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.38, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1 }));
    trunk.position.y = 1.5; trunk.castShadow = true; tree.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 1 });
    [[0, 3.4, 0, 1.6], [-0.9, 3.0, 0.5, 1.1], [0.9, 3.0, -0.4, 1.1], [0.2, 3.9, -0.6, 1.0]]
        .forEach(([px, py, pz, r]) => {
            const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), leafMat);
            leaf.position.set(px, py, pz); leaf.castShadow = true; tree.add(leaf);
        });
    const pods = [];
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const pod = new THREE.Mesh(
            new THREE.SphereGeometry(0.32, 8, 8),
            new THREE.MeshStandardMaterial({ color: podColors[i % 3], roughness: 0.7 }));
        pod.scale.set(0.7, 1.3, 0.7);
        pod.position.set(Math.cos(angle) * 0.5, 1.2 + i * 0.35, Math.sin(angle) * 0.5);
        pod.castShadow = true; tree.add(pod);
        pods.push({ mesh: pod, ripe: true, regrowAt: 0 });
    }
    scene.add(tree);
    cacaoTrees.push({ group: tree, pods, position: tree.position });
}
for (let ix = 0; ix < 3; ix++)
    for (let iz = 0; iz < 3; iz++)
        makeCacaoTree(-18 + ix * 5, -12 + iz * 5);

/* ---------- Bornes de géolocalisation (parcelle) ---------- */
const bornes = [];
const BORNE_CORNERS = [[-20.5, -14.5], [-5.5, -14.5], [-5.5, 2.5], [-20.5, 2.5]];
BORNE_CORNERS.forEach(([x, z]) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6),
        new THREE.MeshStandardMaterial({ color: 0xffffff }));
    pole.position.y = 1.1; pole.castShadow = true; g.add(pole);
    const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.6),
        new THREE.MeshStandardMaterial({ color: 0xdc2626, side: THREE.DoubleSide }));
    flag.position.set(0.5, 1.9, 0); flag.castShadow = true; g.add(flag);
    scene.add(g);
    bornes.push({ group: g, flag, position: g.position, visited: false });
});

// Ligne de la parcelle (polygone) tracée une fois toutes les bornes visitées
let plotLine = null;
function drawPlotPolygon() {
    const pts = BORNE_CORNERS.map(([x, z]) => new THREE.Vector3(x, 0.2, z));
    pts.push(pts[0].clone());
    plotLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x22d3ee }));
    scene.add(plotLine);
    // Remplissage translucide
    const shape = new THREE.Shape(BORNE_CORNERS.map(([x, z]) => new THREE.Vector2(x, z)));
    const fill = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    fill.rotation.x = Math.PI / 2;
    fill.position.y = 0.18;
    scene.add(fill);
}

/* ---------- Panneaux texte ---------- */
function makeSign(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    text.split('\n').forEach((line, i, arr) =>
        ctx.fillText(line, 128, 64 + (i - (arr.length - 1) / 2) * 40));
    const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4;
    return new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}

/* ---------- Stations ---------- */
const stations = [];

// Dalle d'action : carré propre devant la station ; s'y placer
// déclenche l'action automatiquement.
function makePad(g, px, pz, color) {
    const border = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.06, 2.6),
        new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    border.position.set(px, 0.03, pz);
    border.receiveShadow = true; g.add(border);
    const inner = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.1, 2.1),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }));
    inner.position.set(px, 0.05, pz);
    inner.receiveShadow = true; g.add(inner);
    // Position monde de la dalle (les groupes ne sont pas tournés)
    return new THREE.Vector3(g.position.x + px, 0, g.position.z + pz);
}

// Guichet CCC (orange) : délivrance de la Carte du Producteur
function makeCccDesk(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3),
        new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.9 }));
    booth.position.y = 1.5; booth.castShadow = true; booth.receiveShadow = true; g.add(booth);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.4, 3.6),
        new THREE.MeshStandardMaterial({ color: 0x111827 }));
    roof.position.y = 3.2; roof.castShadow = true; g.add(roof);
    const sign = makeSign('Guichet CCC', '#c2410c');
    sign.position.set(0, 2.2, 1.55); g.add(sign);
    const padPos = makePad(g, 0, 3.2, 0xf97316);
    scene.add(g);
    stations.push({ type: 'ccc', group: g, position: g.position, padPos, padArmed: true });
}

// Coopérative (bâtiment + TPE + sacs) : vente tracée
function makeCoop(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const build = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 3.5),
        new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.95 }));
    build.position.y = 1.5; build.castShadow = true; build.receiveShadow = true; g.add(build);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.4, 4),
        new THREE.MeshStandardMaterial({ color: 0x7f1d1d }));
    roof.position.y = 3.7; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    // Côté OUEST : achat du cacao (comptoir + TPE + dalle de vente)
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x2563eb }));
    counter.position.set(-2.85, 0.5, 0); counter.castShadow = true; g.add(counter);
    const tpe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x111827 }));
    tpe.position.set(-2.85, 1.07, 0.6); g.add(tpe);
    // Sacs de jute décoratifs près du comptoir d'achat
    const sackMat = new THREE.MeshStandardMaterial({ color: 0xcaa472, roughness: 1 });
    [[-3.0, -1.3], [-3.3, -0.9], [-3.3, -1.6]].forEach(([sx, sz]) => {
        const sack = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.5, 4, 8), sackMat);
        sack.position.set(sx, 0.5, sz); sack.castShadow = true; g.add(sack);
    });
    const sign = makeSign('Coopérative', '#1e3a8a');
    sign.position.set(0, 2.6, 1.8); g.add(sign);
    const signAchat = makeSign('Achat\nCacao', '#166534');
    signAchat.rotation.y = -Math.PI / 2;          // face ouest
    signAchat.position.set(-2.3, 2.4, 0); g.add(signAchat);
    const signQuai = makeSign('Quai\nExpédition', '#0e7490');
    signQuai.rotation.y = Math.PI / 2;            // face est, vers la route
    signQuai.position.set(2.3, 2.4, 0); g.add(signQuai);
    const padPos = makePad(g, -4.6, 0, 0x1e3a8a);
    scene.add(g);
    stations.push({ type: 'coop', group: g, position: g.position, padPos, padArmed: true });
}

// PUSH POS (kiosque vert) : cash-out Carte → Mobile Money
function makePushPos(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 2.6),
        new THREE.MeshStandardMaterial({ color: 0x0f7a3d, roughness: 0.85 }));
    kiosk.position.y = 1.4; kiosk.castShadow = true; kiosk.receiveShadow = true; g.add(kiosk);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.35, 3.2),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b }));
    roof.position.y = 2.95; roof.castShadow = true; g.add(roof);
    // Écran du terminal de paiement
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 0.4 }));
    screen.position.set(0, 1.05, 1.34); g.add(screen);
    const sign = makeSign('PUSH POS', '#0a5c2e');
    sign.position.set(0, 2.1, 1.38); g.add(sign);
    const padPos = makePad(g, 0, 3.0, 0x0f7a3d);
    scene.add(g);
    stations.push({ type: 'push', group: g, position: g.position, padPos, padArmed: true });
}

makeCccDesk(10, -4);
makeCoop(9, 7);
makePushPos(11.5, -12);   // décalé à l'ouest de la route des camions

/* ---------- Dépôt de la coopérative (sacs vendus, en attente d'expédition) ---------- */
const depotGroup = new THREE.Group();
depotGroup.position.set(9, 0, 3.4);   // côté nord, entre l'achat (ouest) et le quai (est)
scene.add(depotGroup);
const depotSackMat = new THREE.MeshStandardMaterial({ color: 0xcaa472, roughness: 1 });
const depotSacks = [];
for (let i = 0; i < 60; i++) {                    // pile 4 × 5, 3 étages (max affiché)
    const layer = Math.floor(i / 20), idx = i % 20;
    const row = Math.floor(idx / 4), col = idx % 4;
    const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 8), depotSackMat);
    s.rotation.z = Math.PI / 2;
    s.position.set((col - 1.5) * 0.52, 0.22 + layer * 0.36, (row - 2) * 0.46);
    s.castShadow = true; s.visible = false;
    depotGroup.add(s); depotSacks.push(s);
}
function updateDepotPile() {
    const n = Math.min(depotSacks.length, state.coopSacks);
    depotSacks.forEach((s, i) => { s.visible = i < n; });
}

/* ---------- Route et file continue de camions ---------- */
// Route nord-sud à l'est du village : les camions entrent par le sud,
// font la queue, chargent au quai puis passent leur chemin vers le nord.
const TRUCK_ROAD_X = 15.5;   // axe de la route
const LOAD_Z       = 7;      // créneau de chargement, face est de la coopérative
const TRUCK_GAP    = 6.5;    // espacement des camions dans la file
const TRUCK_COUNT  = 4;      // camions visibles dans la boucle
const TRUCK_EXIT_Z = -34;    // sortie au nord → retour en fin de file

const road = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.04, 72),
    new THREE.MeshStandardMaterial({ color: 0x9a8f7f, roughness: 1 }));
road.position.set(TRUCK_ROAD_X, 0.02, 0);
road.receiveShadow = true;
scene.add(road);

// Quai de chargement : dalle où se placer pour charger le camion de tête
const loadBay = new THREE.Group();
loadBay.position.set(13, 0, LOAD_Z);
scene.add(loadBay);
const LOAD_PAD_POS = makePad(loadBay, 0, 0, 0x0891b2);

// Camion (cabine + plateau + roues + chargement visible)
const trucks = [];
const truckCabColors = [0x0891b2, 0xdc2626, 0xeab308, 0x7c3aed];
function makeTruck(startZ, cabColor) {
    const g = new THREE.Group();
    g.position.set(TRUCK_ROAD_X, 0, startZ);
    g.rotation.y = Math.PI;                       // roule vers le nord (-z), cabine en tête
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 4.6),
        new THREE.MeshStandardMaterial({ color: 0x374151 }));
    chassis.position.y = 0.75; chassis.castShadow = true; g.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 1.1),
        new THREE.MeshStandardMaterial({ color: cabColor, roughness: 0.6 }));
    cab.position.set(0, 1.55, 1.75); cab.castShadow = true; g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 3.3),
        new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.9 }));
    bed.position.set(0, 0.99, -0.75); bed.castShadow = true; g.add(bed);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827 });
    [[-1.05, 1.5], [1.05, 1.5], [-1.05, -1.6], [1.05, -1.6]].forEach(([wx, wz]) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12), wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.45, wz); w.castShadow = true; g.add(w);
    });
    // 40 sacs empilés sur le plateau (2 × 4 par étage, 5 étages)
    const truckSackMat = new THREE.MeshStandardMaterial({ color: 0xcaa472, roughness: 1 });
    const sackMeshes = [];
    for (let i = 0; i < TRUCK_CAPACITY; i++) {
        const layer = Math.floor(i / 8), idx = i % 8;
        const row = Math.floor(idx / 2), col = idx % 2;
        const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 4, 8), truckSackMat);
        s.rotation.z = Math.PI / 2;
        s.position.set((col - 0.5) * 1.0, 1.3 + layer * 0.34, -2.05 + row * 0.82);
        s.castShadow = true; s.visible = false;
        g.add(s); sackMeshes.push(s);
    }
    scene.add(g);
    trucks.push({ group: g, sackMeshes, sacks: 0, state: 'queue' });
}
for (let i = 0; i < TRUCK_COUNT; i++)
    makeTruck(24 + i * TRUCK_GAP, truckCabColors[i % truckCabColors.length]);

function updateTruckLoad(t) {
    t.sackMeshes.forEach((s, i) => { s.visible = i < t.sacks; });
}
function truckQueue() {
    return trucks.filter(t => t.state === 'queue')
        .sort((a, b) => a.group.position.z - b.group.position.z);
}

/* ---------- Parcelles à vendre : un point de vente sur chaque terrain ---------- */
// Chaque terrain vide porte sa propre dalle d'achat : le producteur y dépose
// ses espèces (liasses) ; quand le prix est atteint, la parcelle est plantée
// et le panneau, le contour et la dalle disparaissent.
const FIELDS = [
    { x: -14, z: 8,   price: 500000,  fund: 0 },   // sud-ouest
    { x: -14, z: -19, price: 750000,  fund: 0 },   // nord-ouest
    { x: 2,   z: -19, price: 1000000, fund: 0 },   // nord
    { x: 2,   z: -7,  price: 1250000, fund: 0 },   // centre
    { x: -2,  z: 8.5, price: 1500000, fund: 0 },   // sud, près de la coopérative
];
const FIELD_W = 12, FIELD_D = 8;

const fieldSale = [];   // panneau + contour + dalle tant que la parcelle est à vendre
FIELDS.forEach((f, i) => {
    const grp = new THREE.Group();
    const sign = makeSign(`À VENDRE\n${formatFCFA(f.price, false)} F`, '#92400e');
    sign.position.set(f.x - 1.5, 1.6, f.z);
    grp.add(sign);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x8b5e34 }));
    pole.position.set(f.x - 1.5, 0.8, f.z); grp.add(pole);
    // Dalle d'achat sur le terrain, à côté du panneau
    const padPos = makePad(grp, f.x + 2.2, f.z, 0x7c3aed);
    stations.push({
        type: 'field', fieldIndex: i, group: grp,
        position: new THREE.Vector3(f.x, 0, f.z), padPos, padArmed: true,
    });
    const pts = [
        new THREE.Vector3(f.x - FIELD_W / 2, 0.12, f.z - FIELD_D / 2),
        new THREE.Vector3(f.x + FIELD_W / 2, 0.12, f.z - FIELD_D / 2),
        new THREE.Vector3(f.x + FIELD_W / 2, 0.12, f.z + FIELD_D / 2),
        new THREE.Vector3(f.x - FIELD_W / 2, 0.12, f.z + FIELD_D / 2),
        new THREE.Vector3(f.x - FIELD_W / 2, 0.12, f.z - FIELD_D / 2),
    ];
    grp.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xfbbf24 })));
    scene.add(grp);
    fieldSale.push(grp);
});

function unlockField(i) {
    const f = FIELDS[i];
    scene.remove(fieldSale[i]);
    const soil = new THREE.Mesh(
        new THREE.BoxGeometry(FIELD_W, 0.15, FIELD_D),
        new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 1 }));
    soil.position.set(f.x, 0.075, f.z);
    soil.receiveShadow = true;
    scene.add(soil);
    for (const dx of [-4, 0, 4])
        for (const dz of [-2, 2])
            makeCacaoTree(f.x + dx, f.z + dz);   // rejoint cacaoTrees → récolte auto
}

function fieldBuyAction(st) {
    const f = FIELDS[st.fieldIndex];
    if (state.cash <= 0) {
        showInfo('🏦', 'Parcelle à vendre',
            `Prix : ${formatFCFA(f.price)} (déposé : ${formatFCFA(f.fund)}). ` +
            "Retire tes FCFA en espèces au PUSH POS (cash-out), puis reviens les déposer ici.");
        return;
    }
    // Ne prélever que le nécessaire : la monnaie reste sur le producteur
    const deposit = Math.min(state.cash, f.price - f.fund);
    f.fund += deposit;
    state.cash -= deposit;
    updateHUD();
    if (f.fund >= f.price) {
        unlockField(st.fieldIndex);   // enlève panneau, contour et dalle
        st.disabled = true;
        state.fieldsOwned++;
        addScore(25);
        floaty('🌱 Parcelle achetée !', 0x16a34a);
        showInfo('🌱', 'Parcelle achetée !',
            'De nouveaux cacaoyers sont plantés — va les récolter ! ' +
            (state.fieldsOwned < FIELDS.length
                ? 'D\'autres terrains sont encore à vendre sur la carte.'
                : 'Tu possèdes maintenant toutes les parcelles du village.'));
    } else {
        floaty(`🏦 ${formatFCFA(f.fund, false)} / ${formatFCFA(f.price, false)}`, 0x7c3aed);
    }
}

let loadCooldown = 0, emptyHintCooldown = 0;
function updateTrucks(dt) {
    // La file avance : chaque camion roule vers son créneau
    const queue = truckQueue();
    queue.forEach((t, i) => {
        const target = LOAD_Z + i * TRUCK_GAP;
        if (t.group.position.z > target)
            t.group.position.z = Math.max(target, t.group.position.z - TRUCK_SPEED * dt);
    });
    // Camions chargés : ils passent leur chemin vers le nord puis
    // reviennent (vides) en fin de file — flux continu
    for (const t of trucks) {
        if (t.state !== 'departing') continue;
        t.group.position.z -= TRUCK_SPEED * dt;
        if (t.group.position.z <= TRUCK_EXIT_Z) {
            t.sacks = 0; updateTruckLoad(t);
            const backZ = Math.max(24, ...queue.map(q => q.group.position.z + TRUCK_GAP));
            t.group.position.z = backZ;
            t.state = 'queue';
        }
    }
    // Chargement du camion de tête (garé au quai)
    const front = queue[0];
    if (!front || front.group.position.z > LOAD_Z + 0.05) return;
    if (!state.started || state.busy) return;
    const d = Math.hypot(player.position.x - LOAD_PAD_POS.x, player.position.z - LOAD_PAD_POS.z);
    if (d >= PAD_RADIUS) return;
    loadCooldown -= dt; emptyHintCooldown -= dt;
    if (state.coopSacks <= 0) {
        if (emptyHintCooldown <= 0) { floaty('🧺 Dépôt vide — vends du cacao', 0x6b7280); emptyHintCooldown = 3; }
        return;
    }
    if (loadCooldown > 0) return;
    state.coopSacks--; front.sacks++;
    updateDepotPile(); updateTruckLoad(front); updateHUD();
    loadCooldown = LOAD_INTERVAL;
    if (front.sacks % 10 === 0) floaty(`🚚 ${front.sacks}/${TRUCK_CAPACITY} sacs`, 0x0891b2);
    if (front.sacks >= TRUCK_CAPACITY) {
        state.shippedSacks += TRUCK_CAPACITY;
        addScore(10);
        updateHUD();
        floaty('🚚 Camion complet — il passe son chemin !', 0x16a34a);
        front.state = 'departing';
    }
}

/* ---------- Décor ---------- */
function makeFencePost(x, z) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xb98a54 }));
    post.position.set(x, 0.6, z); post.castShadow = true; scene.add(post);
}
for (let i = -22; i <= 18; i += 2) {
    if (i >= 13 && i <= 17) continue;  // portails : la route des camions traverse
    makeFencePost(i, 15); makeFencePost(i, -23);
}

function makeDecoTree(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
    trunk.position.y = 1; trunk.castShadow = true; g.add(trunk);
    const fol = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0x1f6b2e }));
    fol.position.y = 3; fol.castShadow = true; g.add(fol);
    scene.add(g);
}
makeDecoTree(19.5, 13); makeDecoTree(-23, 13.5); makeDecoTree(19.5, -20);

/* ---------- Personnage ---------- */
const player = new THREE.Group();
player.position.set(2, 0, 4);
scene.add(player);
const skinMat = new THREE.MeshStandardMaterial({ color: 0x8d5524 });
const shirtMat = new THREE.MeshStandardMaterial({ color: 0xdb2777 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e40af });
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 4, 8), shirtMat);
torso.position.y = 1.1; torso.castShadow = true; player.add(torso);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), skinMat);
head.position.y = 1.85; head.castShadow = true; player.add(head);
const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xca8a04 }));
hat.position.y = 2.08; hat.castShadow = true; player.add(hat);
const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 4, 6), pantsMat);
legL.position.set(-0.16, 0.5, 0); legL.castShadow = true; player.add(legL);
const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 4, 6), pantsMat);
legR.position.set(0.16, 0.5, 0); legR.castShadow = true; player.add(legR);

// Sacs de cacao empilés sur le dos (visibles selon la récolte portée)
// 2 colonnes de 10 : remplissage colonne proche du dos puis colonne arrière
const backSacks = [];
const backSackMat = new THREE.MeshStandardMaterial({ color: 0xcaa472, roughness: 1 });
for (let i = 0; i < MAX_SACKS; i++) {
    const col = Math.floor(i / 10), row = i % 10;
    const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.32, 4, 8), backSackMat);
    s.rotation.z = Math.PI / 2;               // couché en travers du dos
    s.position.set(0, 0.55 + row * 0.32, -0.5 - col * 0.42);
    s.castShadow = true; s.visible = false;
    player.add(s); backSacks.push(s);
}
function updateBackStack() {
    const n = Math.min(backSacks.length, Math.ceil(state.cacaoKg / SACK_VISUAL_KG));
    backSacks.forEach((s, i) => { s.visible = i < n; });
}

// Liasses de billets portées devant (visibles après le cash-out PUSH POS)
const cashBundles = [];
const bundleMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.7 });
const bandMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.8 });
for (let i = 0; i < MAX_BUNDLES; i++) {
    const col = Math.floor(i / 12), row = i % 12;
    const b = new THREE.Group();
    b.position.set(0, 0.62 + row * 0.15, 0.52 + col * 0.36);
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.3), bundleMat);
    bill.castShadow = true; b.add(bill);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.31), bandMat);
    b.add(band);
    b.visible = false;
    player.add(b); cashBundles.push(b);
}
function updateMoneyStack() {
    const n = Math.min(cashBundles.length, Math.ceil(state.cash / CASH_PER_BUNDLE));
    cashBundles.forEach((b, i) => { b.visible = i < n; });
}

/* ---------- Contrôles ---------- */
const input = { x: 0, y: 0 };
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

const joystick = document.getElementById('joystick');
const knob = document.getElementById('joystickKnob');
let joyActive = false, joyId = null, joyCenter = { x: 0, y: 0 };
const JOY_RADIUS = 44;
function joyStart(cx, cy) {
    const r = joystick.getBoundingClientRect();
    joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    joyActive = true; joyMove(cx, cy);
}
function joyMove(cx, cy) {
    if (!joyActive) return;
    const dx = cx - joyCenter.x, dy = cy - joyCenter.y;
    const dist = Math.min(Math.hypot(dx, dy), JOY_RADIUS);
    const ang = Math.atan2(dy, dx);
    const kx = Math.cos(ang) * dist, ky = Math.sin(ang) * dist;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    input.x = kx / JOY_RADIUS; input.y = ky / JOY_RADIUS;
}
function joyEnd() {
    joyActive = false; joyId = null; input.x = 0; input.y = 0;
    knob.style.transform = 'translate(0px, 0px)';
}
joystick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; joyId = t.identifier; joyStart(t.clientX, t.clientY); e.preventDefault();
}, { passive: false });
joystick.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === joyId) { joyMove(t.clientX, t.clientY); e.preventDefault(); }
}, { passive: false });
window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === joyId) joyEnd();
});
joystick.addEventListener('mousedown', (e) => joyStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => { if (joyActive) joyMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { if (joyActive) joyEnd(); });

/* ---------- Caméra : glisser la main / la souris sur l'écran ---------- */
// Glisser horizontalement fait tourner la caméra autour du joueur ;
// glisser verticalement ajuste la hauteur de vue. Le joystick reste dédié
// au déplacement (il capte ses propres événements).
const gameCanvas = renderer.domElement;
gameCanvas.style.touchAction = 'none';
let camDrag = null;
gameCanvas.addEventListener('pointerdown', (e) => {
    if (camDrag) return;                       // un seul doigt pilote la caméra
    camDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { gameCanvas.setPointerCapture(e.pointerId); } catch (_) { /* pointeur déjà levé */ }
});
gameCanvas.addEventListener('pointermove', (e) => {
    if (!camDrag || e.pointerId !== camDrag.id) return;
    camAzimuth -= (e.clientX - camDrag.x) * 0.008;
    camHeight = THREE.MathUtils.clamp(camHeight + (e.clientY - camDrag.y) * 0.08, 12, 34);
    camDrag.x = e.clientX; camDrag.y = e.clientY;
});
['pointerup', 'pointercancel'].forEach(ev =>
    gameCanvas.addEventListener(ev, (e) => {
        if (camDrag && e.pointerId === camDrag.id) camDrag = null;
    }));

/* ---------- Récolte automatique ---------- */
// Près d'un cacaoyer avec cabosses mûres, la récolte se fait toute seule
// (une cabosse toutes les HARVEST_COOLDOWN secondes).
let harvestCooldown = 0;
function updateAutoHarvest(dt) {
    if (!state.started || state.busy) return;
    harvestCooldown -= dt;
    if (harvestCooldown > 0) return;
    let best = null, bestDist = INTERACT_RADIUS;
    for (const tree of cacaoTrees) {
        const d = player.position.distanceTo(tree.position);
        if (d < bestDist && tree.pods.some(p => p.ripe)) { bestDist = d; best = tree; }
    }
    if (!best) return;
    if (state.cacaoKg >= MAX_CARRY_KG) {
        // Sacs pleins : refuser la récolte tant que rien n'est vendu
        floaty('🎒 Sacs pleins ! Vends à la Coopérative', 0xdc2626);
        harvestCooldown = 2.5;
        return;
    }
    harvestFrom(best);
    harvestCooldown = HARVEST_COOLDOWN;
}

// Dalles d'action : déclenchement automatique quand le joueur se place
// sur la dalle ; il faut en sortir pour la réarmer.
function updateActionPads() {
    if (!state.started) return;
    for (const st of stations) {
        if (st.disabled) continue;    // parcelle achetée : dalle désactivée
        const d = Math.hypot(player.position.x - st.padPos.x, player.position.z - st.padPos.z);
        if (st.padArmed) {
            if (d < PAD_RADIUS && !state.busy) {
                st.padArmed = false;
                if (st.type === 'ccc') cccAction();
                else if (st.type === 'coop') tracedSale();
                else if (st.type === 'push') pushCashOut();
                else if (st.type === 'field') fieldBuyAction(st);
            }
        } else if (d > PAD_EXIT_RADIUS) {
            st.padArmed = true;
        }
    }
}

/* ---------- Récolte ---------- */
function harvestFrom(tree) {
    if (state.cacaoKg >= MAX_CARRY_KG) return; // sacs pleins : vendre d'abord
    const pod = tree.pods.find(p => p.ripe);
    if (!pod) return;
    pod.ripe = false; pod.mesh.visible = false; pod.regrowAt = clockTime + 6;
    let kg = Math.round(HARVEST_MIN_KG + Math.random() * (HARVEST_MAX_KG - HARVEST_MIN_KG));
    kg = Math.min(kg, MAX_CARRY_KG - state.cacaoKg); // ne pas dépasser la capacité
    state.cacaoKg += kg;
    updateHUD();
    floaty(`+${kg} kg 🍫`, 0x7b3f00);
    if (state.step === 3) {
        if (state.cacaoKg >= HARVEST_TARGET) advanceStep();
        else updateObjective();
    }
}

/* ---------- Guichet CCC : délivrance de la Carte ---------- */
function cccAction() {
    if (!state.hasCard) { issueCard(); return; }
    floaty('💳 Carte déjà délivrée', 0xc2410c);
}

/* ---------- PUSH POS : cash-out Carte → espèces (liasses) ---------- */
function pushCashOut() {
    if (!state.hasCard) {
        showInfo('📱', 'Carte requise',
            "Le cash-out PUSH POS exige la Carte du Producteur. Passe au Guichet CCC pour la retirer.");
        return;
    }
    if (state.cardBalance > 0) {
        const amount = state.cardBalance;
        state.cash += amount; state.cardBalance = 0;
        updateHUD();
        floaty(`💵 +${formatFCFA(amount, false)} en espèces`, 0x16a34a);
    } else {
        floaty('Solde Carte vide', 0x6b7280);
    }
}

function issueCard() {
    if (!state.plotRegistered) {
        showInfo('🛰️', 'Parcelle non enregistrée',
            "Tu dois d'abord géolocaliser ta parcelle en longeant les 4 bornes. " +
            "La Carte du Producteur est délivrée après le recensement de ton verger.");
        return;
    }
    state.hasCard = true;
    state.zone = ZONES[Math.floor(Math.random() * ZONES.length)];
    state.matricule = 'CCC-' + state.zone.slice(0, 3).toUpperCase() + '-' +
        Math.floor(100000 + Math.random() * 899999);
    renderProducerCard();
    addScore(30);
    updateHUD();
    showInfo('💳', 'Carte du Producteur délivrée',
        `Matricule unique : ${state.matricule} (zone ${state.zone}). ` +
        "Elle porte ton identité, un QR code et une puce bancaire (Visa). " +
        "Elle sécurise ton paiement au prix officiel et ouvre la CMU (santé) à 100 %. " +
        "Depuis le 1ᵉʳ septembre 2026, elle est obligatoire pour toute vente de cacao.");
    if (state.step === 2) advanceStep();
}

/* ---------- Vente tracée à la coopérative ---------- */
const salePanel = document.getElementById('salePanel');
const saleResult = document.getElementById('saleResult');

async function tracedSale() {
    if (!state.hasCard) {
        showInfo('💳', 'Carte requise',
            "La vente tracée exige la Carte du Producteur. Passe au Guichet CCC pour la retirer.");
        return;
    }
    if (state.cacaoKg <= 0) {
        showInfo('🍫', 'Aucune fève à vendre',
            "Récolte d'abord du cacao dans ta parcelle, puis reviens vendre à la coopérative.");
        return;
    }

    state.busy = true;
    const kg = state.cacaoKg;
    const seals = Math.max(1, Math.ceil(kg / SACK_VISUAL_KG));
    const amount = kg * OFFICIAL_PRICE;
    const sealNo = Math.floor(100000 + Math.random() * 899999);

    // Réinitialiser le panneau
    const items = salePanel.querySelectorAll('#saleSteps li');
    items.forEach(li => li.classList.remove('done', 'active'));
    saleResult.textContent = '';
    salePanel.classList.remove('hidden');

    const detail = {
        scan: `Carte ${state.matricule} ✓`,
        weigh: `${kg} kg pesés`,
        seal: `${seals} sac(s) · scellés n° ${sealNo}…`,
        price: `${kg} × ${OFFICIAL_PRICE} FCFA/kg`,
        pay: `+${formatFCFA(amount, false)} FCFA sur la Carte`,
        sms: `Connaissement lié à la zone ${state.zone}`,
    };

    for (const li of items) {
        li.classList.add('active');
        await wait(520);
        li.classList.remove('active'); li.classList.add('done');
        li.textContent = li.textContent.split(' — ')[0] + ' — ' + detail[li.dataset.k];
    }

    // Appliquer les effets : les sacs vendus rejoignent le dépôt de la coopérative
    state.cacaoKg = 0;
    state.cardBalance += amount;
    state.coopSacks += seals;
    updateDepotPile();
    addScore(20);
    updateHUD();
    saleResult.textContent = `✅ Vente tracée : +${formatFCFA(amount)}`;

    await wait(1400);
    salePanel.classList.add('hidden');
    // Restaurer les libellés d'étapes
    items.forEach(li => { li.textContent = li.textContent.split(' — ')[0]; });
    state.busy = false;

    if (!state.firstSaleDone) {
        state.firstSaleDone = true;
        showInfo('🤝', 'Vente 100 % tracée',
            "Ta carte a été scannée sur le TPE, les sacs pesés et scellés, le paiement calculé au prix officiel. " +
            "Un connaissement relie ta parcelle géolocalisée à l'expédition : producteur → coopérative → exportateur → usine. " +
            "C'est ainsi que le cacao ivoirien prouve son origine, de la plantation jusqu'à l'usine (conformité EUDR). " +
            "Tes sacs sont maintenant au dépôt : place-toi sur la dalle du Quai d'Expédition (côté est, face à la route) pour charger le camion (40 sacs par camion).");
    }
    if (state.step === 4) advanceStep();
}

/* ---------- Enregistrement de la parcelle ---------- */
function registerPlot() {
    state.plotRegistered = true;
    drawPlotPolygon();
    addScore(30);
    showInfo('🛰️', 'Parcelle géolocalisée',
        "Les 4 bornes tracent le polygone de ta parcelle. À l'échelle nationale, le Conseil du Café-Cacao " +
        "a géolocalisé ~3 millions d'hectares de vergers. Cette carte prouve que ton cacao est « zéro déforestation » " +
        "— exigence du règlement européen EUDR (en vigueur au 1ᵉʳ janvier 2027).");
    if (state.step === 1) advanceStep();
}

/* ---------- Objectifs guidés ---------- */
const objectiveEl = document.getElementById('objective');
const objectiveStepEl = document.getElementById('objectiveStep');
const objectiveTextEl = document.getElementById('objectiveText');
const objectiveProgressEl = document.getElementById('objectiveProgress');

function updateObjective() {
    if (state.step === 1) {
        objectiveStepEl.textContent = 'Étape 1 / 4';
        objectiveTextEl.textContent = 'Géolocalise ta parcelle 🛰️';
        objectiveProgressEl.textContent = `Longe les bornes : ${state.bornesVisited} / 4`;
    } else if (state.step === 2) {
        objectiveStepEl.textContent = 'Étape 2 / 4';
        objectiveTextEl.textContent = 'Retire ta Carte du Producteur 💳';
        objectiveProgressEl.textContent = 'Place-toi sur la dalle du Guichet CCC (orange)';
    } else if (state.step === 3) {
        objectiveStepEl.textContent = 'Étape 3 / 4';
        objectiveTextEl.textContent = 'Récolte le cacao 🌳';
        objectiveProgressEl.textContent = `${state.cacaoKg} / ${HARVEST_TARGET} kg`;
    } else if (state.step === 4) {
        objectiveStepEl.textContent = 'Étape 4 / 4';
        objectiveTextEl.textContent = 'Vente tracée à la coopérative 🤝';
        objectiveProgressEl.textContent = 'Dalle Achat Cacao, côté ouest de la Coopérative';
    } else {
        objectiveStepEl.textContent = 'Parcours terminé 🎉';
        objectiveTextEl.textContent = 'Vends, charge les camions 🚚, achète des parcelles 🌱 !';
        objectiveProgressEl.textContent = `Score de traçabilité : ${state.score}`;
    }
}

function advanceStep() {
    state.step = state.step >= 4 ? 0 : state.step + 1;
    updateObjective();
    objectiveEl.classList.remove('pop'); void objectiveEl.offsetWidth; objectiveEl.classList.add('pop');
}

/* ---------- HUD ---------- */
const cacaoValueEl = document.getElementById('cacaoValue');
const cardValueEl = document.getElementById('cardValue');
const moneyValueEl = document.getElementById('moneyValue');
const depotValueEl = document.getElementById('depotValue');
const shipValueEl = document.getElementById('shipValue');
const scoreValueEl = document.getElementById('scoreValue');

function updateHUD() {
    updateBackStack();
    updateMoneyStack();
    cacaoValueEl.textContent = state.cacaoKg;
    cardValueEl.textContent = formatFCFA(state.cardBalance, false);
    moneyValueEl.textContent = formatFCFA(state.cash, false);
    depotValueEl.textContent = state.coopSacks;
    shipValueEl.textContent = state.shippedSacks;
    scoreValueEl.textContent = state.score;
}
function addScore(n) { state.score += n; }

function formatFCFA(n, withUnit = true) {
    const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return withUnit ? `${s} FCFA` : s;
}

/* ---------- Carte du Producteur (UI) ---------- */
const producerCardEl = document.getElementById('producerCard');
function renderProducerCard() {
    document.getElementById('pcName').textContent = 'Producteur·rice';
    document.getElementById('pcZone').textContent = 'Zone : ' + state.zone;
    document.getElementById('pcMat').textContent = state.matricule;
    drawFakeQR(document.getElementById('pcQR'));
    producerCardEl.classList.remove('hidden');
}
function drawFakeQR(canvas) {
    const ctx = canvas.getContext('2d');
    const N = 16, s = canvas.width / N;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
            if (Math.random() > 0.5) ctx.fillRect(x * s, y * s, s, s);
    // 3 repères d'angle
    const marker = (mx, my) => {
        ctx.fillStyle = '#000'; ctx.fillRect(mx, my, s * 5, s * 5);
        ctx.fillStyle = '#fff'; ctx.fillRect(mx + s, my + s, s * 3, s * 3);
        ctx.fillStyle = '#000'; ctx.fillRect(mx + s * 2, my + s * 2, s, s);
    };
    marker(0, 0); marker(s * 11, 0); marker(0, s * 11);
}

/* ---------- Fiche d'information ---------- */
const infoModal = document.getElementById('infoModal');
document.getElementById('modalBtn').addEventListener('click', () => infoModal.classList.add('hidden'));
function showInfo(emoji, title, text) {
    document.getElementById('modalEmoji').textContent = emoji;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalText').textContent = text;
    infoModal.classList.remove('hidden');
}

/* ---------- Texte flottant ---------- */
function floaty(text, color = 0xffffff) {
    const el = document.createElement('div');
    el.className = 'floaty'; el.textContent = text;
    el.style.color = '#' + color.toString(16).padStart(6, '0');
    document.getElementById('hud').appendChild(el);
    const world = player.position.clone(); world.y += 2.4;
    const s = worldToScreen(world);
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    setTimeout(() => el.remove(), 1100);
}
function worldToScreen(v3) {
    const v = v3.clone().project(camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- Boucle ---------- */
const clock = new THREE.Clock();
let clockTime = 0, walkPhase = 0;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    clockTime += dt;

    let mx = input.x, my = input.y;
    if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;

    // Déplacement relatif à la caméra : « haut » à l'écran éloigne de la caméra
    const fx = -Math.sin(camAzimuth), fz = -Math.cos(camAzimuth); // avant
    const rx = -fz, rz = fx;                                     // droite
    let moveX = rx * mx - fx * my, moveZ = rz * mx - fz * my;
    const len = Math.hypot(moveX, moveZ);
    const canMove = state.started && !state.busy;
    if (len > 0.05 && canMove) {
        moveX /= len; moveZ /= len;
        const speed = PLAYER_SPEED * Math.min(1, Math.hypot(mx, my));
        player.position.x = THREE.MathUtils.clamp(player.position.x + moveX * speed * dt, -24, 16);
        player.position.z = THREE.MathUtils.clamp(player.position.z + moveZ * speed * dt, -23, 14);
        player.rotation.y = Math.atan2(moveX, moveZ);
        walkPhase += dt * 12;
        legL.rotation.x = Math.sin(walkPhase) * 0.6;
        legR.rotation.x = -Math.sin(walkPhase) * 0.6;
        torso.position.y = 1.1 + Math.abs(Math.sin(walkPhase)) * 0.05;
    } else {
        legL.rotation.x *= 0.8; legR.rotation.x *= 0.8;
    }

    // Capture des bornes (géolocalisation) par proximité
    if (state.started && !state.plotRegistered) {
        for (let i = 0; i < bornes.length; i++) {
            const b = bornes[i];
            if (!b.visited && player.position.distanceTo(b.position) < BORNE_RADIUS) {
                b.visited = true;
                b.flag.material.color.set(0x22c55e); // rouge → vert
                state.bornesVisited++;
                floaty(`Borne ${state.bornesVisited}/4 ✓`, 0x22d3ee);
                if (state.step === 1) updateObjective();
                if (state.bornesVisited === 4) registerPlot();
            }
        }
    }

    // Repousse des cabosses
    for (const tree of cacaoTrees)
        for (const pod of tree.pods)
            if (!pod.ripe && clockTime >= pod.regrowAt) { pod.ripe = true; pod.mesh.visible = true; }

    // Drapeaux face caméra
    for (const b of bornes) b.flag.lookAt(camera.position);

    camera.position.copy(player.position).add(computeCamOffset());
    camera.lookAt(player.position.x, 1, player.position.z);

    updateAutoHarvest(dt);
    updateActionPads();
    updateTrucks(dt);
    renderer.render(scene, camera);
}
animate();

/* ---------- Démarrage ---------- */
const startScreen = document.getElementById('startScreen');
document.getElementById('startBtn').addEventListener('click', () => {
    state.started = true;
    startScreen.classList.add('hidden');
    updateHUD(); updateObjective();
});
updateHUD(); updateObjective(); updateDepotPile();

/* ---------- Hooks de test (inoffensifs) ---------- */
window.__dbgTeleport = (x, z) => { player.position.set(x, 0, z); };
window.__dbg = () => ({
    player: [player.position.x.toFixed(1), player.position.z.toFixed(1)],
    camAzimuth: +camAzimuth.toFixed(2), camHeight: +camHeight.toFixed(1),
    backSacks: backSacks.filter(s => s.visible).length,
    coopSacks: state.coopSacks, shipped: state.shippedSacks,
    frontSacks: truckQueue()[0] ? truckQueue()[0].sacks : 0,
    frontAtDock: truckQueue()[0] ? truckQueue()[0].group.position.z <= LOAD_Z + 0.05 : false,
    trucksDbg: trucks.map(t => t.state + '@' + t.group.position.z.toFixed(0)),
    step: state.step, bornes: state.bornesVisited, plot: state.plotRegistered,
    card: state.hasCard, cacaoKg: state.cacaoKg, cardBalance: state.cardBalance,
    cash: state.cash, fieldFunds: FIELDS.map(f => f.fund), fieldsOwned: state.fieldsOwned,
    bundles: cashBundles.filter(b => b.visible).length, trees: cacaoTrees.length,
    score: state.score, busy: state.busy,
});
