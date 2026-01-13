import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = { 
    apiKey: "AIzaSyBE3kWnpnQnlH1y8F5GF5Md_6vkfrxYVmc", 
    authDomain: "zmapa-b5d04.firebaseapp.com", 
    projectId: "zmapa-b5d04", 
    storageBucket: "zmapa-b5d04.firebasestorage.app", 
    messagingSenderId: "1017009188108", 
    appId: "1:1017009188108:web:c25d6822a4383d46906d29" 
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let state = { hp: 100, scrap: 50, wood: 20, food: 1, weapon: "PIĘŚCI", hasBase: false };
let map, playerMarker;
let zombies = [], loots = [];
let firstFix = true;

// Tablica przechowująca czasy zebrania paczek (każda ma własny licznik 10 min)
let lootCooldowns = JSON.parse(localStorage.getItem('lootCooldowns')) || [];

setPersistence(auth, browserLocalPersistence);

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const docRef = doc(db, "users", user.uid);
        const snap = await getDoc(docRef);
        if (snap.exists()) state = { ...state, ...snap.data() };
        else await setDoc(docRef, state);

        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        if (!map) initGame();
        updateUI();
    }
});

function initGame() {
    map = L.map('map', { zoomControl: false, tap: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

    const playerIcon = L.divIcon({
        html: '<div id="p-arrow">➤</div>',
        className: 'player-icon',
        iconSize: [60, 60],
        iconAnchor: [30, 30] 
    });
    playerMarker = L.marker([52.2, 21.0], { icon: playerIcon, zIndexOffset: 1000 }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        
        if (firstFix) {
            map.setView(p, 18);
            firstFix = false;
        }
        
        cleanupFarObjects(p);
    }, (err) => console.error(err), { enableHighAccuracy: true });

    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientationabsolute', (event) => {
            let heading = event.alpha;
            if (event.webkitCompassHeading) heading = event.webkitCompassHeading;
            if (heading !== null) {
                const arrow = document.getElementById('p-arrow');
                if (arrow) arrow.style.transform = `rotate(${-heading}deg)`;
            }
        }, true);
    }

    onSnapshot(collection(db, "global_bases"), (snap) => {
        snap.forEach(d => {
            const b = d.data();
            L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon', iconSize: [40,40] }) }).addTo(map);
        });
    });

    setInterval(gameLoop, 1000);
}

// System lootu: każda zebrana paczka odradza się osobno po 10 min
function manageLootSystem(p) {
    const now = Date.now();
    const cooldown = 10 * 60 * 1000; // 10 minut

    // Usuwamy z listy te czasy, które już minęły
    lootCooldowns = lootCooldowns.filter(time => (now - time) < cooldown);
    localStorage.setItem('lootCooldowns', JSON.stringify(lootCooldowns));

    // Łącznie na mapie + w kolejce ma być zawsze 10 paczek
    const currentOnMap = loots.length;
    const waitingForRespawn = lootCooldowns.length;
    const maxPaczki = 10;

    if (currentOnMap + waitingForRespawn < maxPaczki) {
        spawnLoot(p);
    }
}

function spawnLoot(p) {
    const off = () => (Math.random() - 0.5) * 0.008; 
    const lPos = [p[0] + off(), p[1] + off()];
    
    const lIcon = L.divIcon({ 
        html: '📦', 
        className: 'loot-marker', 
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    
    const l = L.marker(lPos, { icon: lIcon }).addTo(map);
    
    l.on('click', () => {
        const d = map.distance(playerMarker.getLatLng(), l.getLatLng());
        if(d < 50) {
            const rand = Math.random();
            if(rand < 0.5) state.scrap += 15;
            else if (rand < 0.8) state.wood += 10;
            else state.food += 1;
            
            // Dodajemy czas zebrania tej konkretnej paczki do listy
            lootCooldowns.push(Date.now());
            localStorage.setItem('lootCooldowns', JSON.stringify(lootCooldowns));
            
            updateUI(true); 
            map.removeLayer(l);
            loots = loots.filter(item => item !== l);
            msg("ZEBRANO PACZKĘ!");
        } else {
            msg("ZA DALEKO!");
        }
    });
    loots.push(l);
}

function cleanupFarObjects(p) {
    const maxDist = 1000;
    loots = loots.filter(l => {
        if (map.distance(p, l.getLatLng()) > maxDist) {
            map.removeLayer(l);
            return false;
        }
        return true;
    });
    zombies = zombies.filter(z => {
        if (map.distance(p, z.getLatLng()) > maxDist) {
            map.removeLayer(z);
            return false;
        }
        return true;
    });
}

function gameLoop() {
    if (!playerMarker || !map || state.hp <= 0) return;
    const pPos = playerMarker.getLatLng();

    // Wywołujemy zarządzanie lootem co sekundę
    manageLootSystem(pPos);

    // Spawn Zombie
    if(zombies.length < 8) {
        const off = () => (Math.random() - 0.5) * 0.02;
        const zIcon = L.divIcon({ 
            html: '🧟', 
            className: 'zombie-marker', 
            iconSize: [55, 55],
            iconAnchor: [27, 27] 
        });
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { icon: zIcon }).addTo(map);
        zombies.push(z);
    }

    // Logika Zombie
    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);

        if (dist < 150) {
            // TRYB POŚCIGU - gdy gracz blisko
            const speed = 0.00035; 
            const latMove = (pPos.lat - zPos.lat) * 0.1;
            const lngMove = (pPos.lng - zPos.lng) * 0.1;
            
            z.setLatLng([
                zPos.lat + (latMove * speed * 10),
                zPos.lng + (lngMove * speed * 10)
            ]);

            if(dist < 18) { 
                state.hp -= 5; 
                updateUI(); 
                if(navigator.vibrate) navigator.vibrate(100);
                if(state.hp <= 0) handleDeath();
            }
        } else {
            // TRYB WAŁĘSANIA - gdy gracz daleko (bardzo powolny ruch losowy)
            const wander = 0.00003;
            z.setLatLng([
                zPos.lat + (Math.random() - 0.5) * wander,
                zPos.lng + (Math.random() - 0.5) * wander
            ]);
        }
    });
}

function handleDeath() {
    state.hp = 0;
    updateUI(true);
    const ds = document.getElementById('death-screen');
    ds.innerHTML = `
        <div style="text-align:center;">
            <h1 style="font-size:3rem; color:#ff0000; text-shadow: 0 0 20px #f00;">ROZSZARPANY</h1>
            <button onclick="location.reload()" style="padding:20px 40px; background:#00ff41; border:none; font-family:Orbitron; font-weight:bold; cursor:pointer;">STWÓRZ NOWEGO OCALAŁEGO</button>
        </div>`;
    ds.style.display = 'flex';
    state = { hp: 100, scrap: 0, wood: 0, food: 0, weapon: "PIĘŚCI", hasBase: false };
    if(auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

function updateUI(cloud = false) {
    const hpFill = document.getElementById('hp-fill');
    if(hpFill) hpFill.style.width = Math.max(0, state.hp) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    document.getElementById('s-weapon').innerText = state.weapon;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

function msg(m) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = m;
    document.body.appendChild(t);
    t.style.display = 'block';
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2500);
}

document.getElementById('btn-attack').onclick = (e) => {
    e.preventDefault(); 
    const pPos = playerMarker.getLatLng();
    let killed = 0;
    zombies = zombies.filter(z => {
        if(map.distance(pPos, z.getLatLng()) < 70) {
            map.removeLayer(z);
            killed++;
            return false;
        }
        return true;
    });
    if(killed > 0) {
        state.scrap += (10 * killed);
        updateUI(true);
        msg(`ZABITO: ${killed} 🧟`);
    }
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0 && state.hp < 100) {
        state.food--; state.hp = Math.min(100, state.hp + 25); 
        updateUI(true);
    }
};

window.toggleModal = (id) => {
    const m = document.getElementById('modal-' + id);
    if(m) m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
};
