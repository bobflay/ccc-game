/* ============================================
   Chargement des modèles 3D téléchargés (GLB)
   - Personnages animés (fermier + ouvriers) : Farmer (Quaternius)
   - Camion : CesiumMilkTruck ; sacs : Bag ; fèves : Bean
   Sources : dépôts three.js (r160) et Khronos glTF-Sample-Assets.
   Amélioration progressive : si un modèle échoue, le jeu garde ses
   formes procédurales (aucune régression, fonctionne hors-ligne).
   ============================================ */
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from './lib/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

// Un seul personnage (fermier Quaternius, gréé + animé) pour le héros et les
// ouvriers, décliné à différentes tailles. Un vrai fermier, pas un soldat.
const CHAR_URL = 'assets/models/Farmer.glb';
const CHAR = {
    farmer:  { height: 1.95 },
    harvest: { height: 1.75 },
    loader:  { height: 1.75 },
};
// Camion (pickup à plateau ouvert) : longueur native déjà sur l'axe Z, cabine
// en +Z → aucun yaw. Le groupe (rotation π) fait rouler la cabine vers le nord.
const TRUCK_CFG = { length: 4.7, yaw: 0 };

export const Models = { ready: false, char: {}, truck: null, prop: {} };

// Extrait d'un GLB une géométrie unique normalisée (centrée, dimension max = 1)
// + son matériau : sert de gabarit partagé pour des centaines d'instances
// (cabosses, sacs) sans coût mémoire supplémentaire.
function extractProp(scene) {
    scene.updateMatrixWorld(true);
    let best = null;
    scene.traverse((o) => {
        if (o.isMesh && (!best ||
            o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o;
    });
    const geometry = best.geometry.clone();
    geometry.applyMatrix4(best.matrixWorld);
    geometry.computeBoundingBox();
    const c = new THREE.Vector3(); geometry.boundingBox.getCenter(c);
    const sz = new THREE.Vector3(); geometry.boundingBox.getSize(sz);
    const maxd = Math.max(sz.x, sz.y, sz.z) || 1;
    geometry.translate(-c.x, -c.y, -c.z);       // centré à l'origine
    geometry.scale(1 / maxd, 1 / maxd, 1 / maxd); // dimension max = 1
    return { geometry, material: best.material };
}

function pickClip(clips, ...names) {
    for (const n of names) {
        const c = clips.find((cl) => cl.name.toLowerCase().includes(n));
        if (c) return c;
    }
    return clips[0];
}

let charTpl = null;   // gabarit partagé du personnage (scène + animations + mesures)

export async function loadAllModels() {
    const gltf = await load(CHAR_URL);
    gltf.scene.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    gltf.scene.updateMatrixWorld(true);   // indispensable avant de mesurer un rig
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3(); box.getSize(size);
    charTpl = { scene: gltf.scene, animations: gltf.animations, height: size.y, minY: box.min.y };

    const truckGltf = await load('assets/models/Truck.glb');
    truckGltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    Models.truck = truckGltf.scene;

    // Accessoires légers (géométrie partagée) : sacs et fèves de cacao
    const [bagGltf, beanGltf] = await Promise.all([
        load('assets/models/Bag.glb'), load('assets/models/Bean.glb'),
    ]);
    Models.prop = {
        bag: extractProp(bagGltf.scene),
        bean: extractProp(beanGltf.scene),
    };

    Models.ready = true;
}

// Instancie un personnage animé. Retourne un groupe « holder » que le code
// du jeu positionne/oriente librement, plus un mixer piloté par setMoving().
export function makeCharacter(kind) {
    const scale = CHAR[kind].height / charTpl.height;
    const root = cloneSkinned(charTpl.scene);
    root.scale.setScalar(scale);
    root.position.y = -charTpl.minY * scale;   // pieds au sol

    const holder = new THREE.Group();
    holder.add(root);

    const mixer = new THREE.AnimationMixer(root);
    const idle = mixer.clipAction(pickClip(charTpl.animations, 'idle', 'stand'));
    const walk = mixer.clipAction(pickClip(charTpl.animations, 'walk'));
    idle.play(); walk.play();
    idle.setEffectiveWeight(1); walk.setEffectiveWeight(0);

    let moving = null;
    return {
        holder, mixer,
        setMoving(m) {
            if (m === moving) return;
            moving = m;
            walk.setEffectiveWeight(m ? 1 : 0);
            idle.setEffectiveWeight(m ? 0 : 1);
        },
        update(dt) { mixer.update(dt); },
    };
}

// Instancie le modèle de camion, mis à l'échelle et orienté pour le groupe.
export function makeTruckModel() {
    const m = Models.truck.clone();
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const size = new THREE.Vector3(); box.getSize(size);
    m.scale.setScalar(TRUCK_CFG.length / Math.max(size.x, size.z));
    m.rotation.y = TRUCK_CFG.yaw;
    m.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(m);
    const c = new THREE.Vector3(); box2.getCenter(c);
    m.position.set(-c.x, -box2.min.y, -c.z);   // centré sur l'axe de la route, roues au sol
    return m;
}
