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

const deathScreen = document.createElement('div');
deathScreen.id = 'death-screen';
deathScreen.innerHTML = '💀 STATUS: KRYTYCZNY (ZGINĄŁEŚ) 💀<br><button onclick="location.reload()" style="font-size:1.2rem; padding:15px 30px; margin-top:20px; background:#00ff41; border:none; border-radius:10px; cursor:pointer; font-family:Orbitron;">RESTART BIOMETRII</button>';
document.body.appendChild(deathScreen);

let state = { hp: 100, scrap: 50, wood: 20, food: 1, weapon: "PIĘŚCI", hasBase: false };
let map, playerMarker;
let zombies = [], loots = [];

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
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });
    playerMarker = L.marker([52.2, 21.0], { icon: playerIcon }).addTo(map);

    // GPS: Tylko do pozycji
    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
        if (loots.length < 5) spawnLoot(p);
    }, null, { enableHighAccuracy: true });

    // KOMPAS: Rozwiązanie lagów strzałki (Device Orientation)
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

function spawnLoot(p) {
    const off = () => (Math.random() - 0.5) * 0.005;
    const lIcon = L.divIcon({ html: '📦', className: 'loot-marker', iconSize: [35, 35] });
    const l = L.marker([p[0]+off(), p[1]+off()], { icon: lIcon }).addTo(map);
    
    l.on('click', () => {
        if(map.distance(playerMarker.getLatLng(), l.getLatLng()) < 50) {
            const rand = Math.random();
            let msgText = "";
            if(rand < 0.5) { state.scrap += 15; msgText = "+15 Złomu ⚙️"; }
            else if (rand < 0.8) { state.wood += 10; msgText = "+10 Drewna 🪵"; }
            else { state.food += 1; msgText = "+1 Jedzenie 🍎"; }
            
            updateUI(true); 
            map.removeLayer(l);
            msg(msgText);
        } else {
            msg("CEL POZA ZASIĘGIEM!");
        }
    });
    loots.push(l);
}

function gameLoop() {
    if (!playerMarker || !map) return;
    const pPos = playerMarker.getLatLng();

    if(zombies.length < 5) {
        const off = () => (Math.random() - 0.5) * 0.007;
        const zIcon = L.divIcon({ html: '🧟', className: 'zombie-marker', iconSize: [55, 55] });
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { icon: zIcon }).addTo(map);
        zombies.push(z);
    }

    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        let newLat, newLng;
        const speed = 0.00007;

        if (dist < 100) {
            newLat = zPos.lat + (pPos.lat > zPos.lat ? speed : -speed);
            newLng = zPos.lng + (pPos.lng > zPos.lng ? speed : -speed);
            if(dist < 15) { 
                state.hp -= 3; 
                updateUI(); 
                if(navigator.vibrate) navigator.vibrate(200);
                if(state.hp <= 0) handleDeath();
            }
        } else {
            newLat = zPos.lat + (Math.random() - 0.5) * 0.00003;
            newLng = zPos.lng + (Math.random() - 0.5) * 0.00003;
        }
        z.setLatLng([newLat, newLng]);
    });
}

function handleDeath() {
    state.hp = 0;
    updateUI(true);
    state = { hp: 100, scrap: 0, wood: 0, food: 0, weapon: "PIĘŚCI", hasBase: false };
    if(auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
    document.getElementById('death-screen').style.display = 'flex';
}

function msg(m) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = m;
    document.body.appendChild(t);
    t.style.display = 'block';
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2000);
}

// WALKA: Usprawniony przycisk ataku
document.getElementById('btn-attack').onclick = (e) => {
    e.preventDefault(); // Zapobiega błędom dotyku
    const pPos = playerMarker.getLatLng();
    let hitCount = 0;
    
    zombies = zombies.filter(z => {
        const dist = map.distance(pPos, z.getLatLng());
        if(dist < 65) { // Zasięg ataku 65m
            map.removeLayer(z);
            state.scrap += 12;
            hitCount++;
            return false;
        }
        return true;
    });

    if(hitCount > 0) {
        updateUI(true);
        msg(`ZNEUTRALIZOWANO: ${hitCount} 💀`);
        if(navigator.vibrate) navigator.vibrate(100);
    } else {
        msg("BRAK CELU W ZASIĘGU");
    }
};

window.toggleModal = (id) => {
    const m = document.getElementById('modal-' + id);
    if(m) m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
};

window.doCraft = async (type, cost) => {
    if (type === 'weapon' && state.scrap >= cost) {
        state.scrap -= cost; state.weapon = "NÓŻ MYŚLIWSKI";
        msg("BROŃ WYKONANA! 🔪");
    } else if (type === 'base' && state.wood >= cost && !state.hasBase) {
        state.wood -= cost; state.hasBase = true;
        const p = playerMarker.getLatLng();
        await setDoc(doc(db, "global_bases", auth.currentUser.uid), { lat: p.lat, lng: p.lng, owner: auth.currentUser.displayName });
        msg("BAZA ZABEZPIECZONA! 🏠");
    } else {
        msg("NIEWYSTARCZAJĄCE ZASOBY!");
    }
    updateUI(true);
    toggleModal('craft');
};

function updateUI(cloud = false) {
    document.getElementById('hp-fill').style.width = Math.max(0, state.hp) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    document.getElementById('s-weapon').innerText = state.weapon;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0 && state.hp < 100) {
        state.food--; state.hp = Math.min(100, state.hp + 25); 
        updateUI(true);
        msg("REGENERACJA +25HP");
    }
};
