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

// Inicjalizacja stanu
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
        iconSize: [60, 60],
        iconAnchor: [30, 30] 
    });
    playerMarker = L.marker([52.2, 21.0], { icon: playerIcon }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
        if (loots.length < 5) spawnLoot(p);
    }, null, { enableHighAccuracy: true });

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
    if (!playerMarker || !map || state.hp <= 0) return;
    const pPos = playerMarker.getLatLng();

    if(zombies.length < 6) {
        const off = () => (Math.random() - 0.5) * 0.012;
        const zIcon = L.divIcon({ html: '🧟', className: 'zombie-marker', iconSize: [55, 55] });
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { icon: zIcon }).addTo(map);
        zombies.push(z);
    }

    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        let newLat = zPos.lat;
        let newLng = zPos.lng;
        const speed = 0.00018; 

        if (dist < 150) {
            newLat += (pPos.lat > zPos.lat ? speed : -speed) * 0.7;
            newLng += (pPos.lng > zPos.lng ? speed : -speed) * 0.7;
            if(dist < 15) { 
                state.hp -= 4; // Zombie są groźniejsze
                updateUI(); 
                if(navigator.vibrate) navigator.vibrate(100);
                if(state.hp <= 0) handleDeath();
            }
        } else {
            newLat += (Math.random() - 0.5) * 0.00008;
            newLng += (Math.random() - 0.5) * 0.00008;
        }
        z.setLatLng([newLat, newLng]);
    });
}

// NOWA FUNKCJA ŚMIERCI
function handleDeath() {
    state.hp = 0;
    updateUI(true);
    
    const ds = document.getElementById('death-screen');
    ds.innerHTML = `
        <div style="text-align:center; padding: 20px;">
            <h1 style="font-size:3rem; color:#ff0000; margin-bottom:10px; text-shadow: 0 0 20px #f00;">ZOSTAŁEŚ ROZSZARPANY</h1>
            <p style="font-size:1.2rem; color:#ccc; margin-bottom: 30px;">TWOJA BIOMETRIA WYGASŁA...</p>
            <button onclick="location.reload()" style="
                padding:20px 40px; 
                background:#00ff41; 
                color:#000; 
                border:none; 
                border-radius:10px; 
                font-family:Orbitron; 
                font-weight:bold; 
                cursor:pointer;
                box-shadow: 0 0 20px #00ff41;">
                STWÓRZ NOWEGO OCALAŁEGO
            </button>
        </div>
    `;
    ds.style.display = 'flex';
    
    // Resetuj stan dla bazy danych po śmierci
    state = { hp: 100, scrap: 0, wood: 0, food: 0, weapon: "PIĘŚCI", hasBase: false };
    if(auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

function msg(m) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = m;
    document.body.appendChild(t);
    t.style.display = 'block';
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2000);
}

// ATAK
document.getElementById('btn-attack').onclick = (e) => {
    e.preventDefault(); 
    if(state.hp <= 0) return;
    const pPos = playerMarker.getLatLng();
    let killedCount = 0;
    
    zombies = zombies.filter(z => {
        const dist = map.distance(pPos, z.getLatLng());
        if(dist < 60) { 
            map.removeLayer(z);
            state.scrap += 12;
            killedCount++;
            return false;
        }
        return true;
    });

    if(killedCount > 0) {
        updateUI(true);
        msg(`WYELIMINOWANO: ${killedCount} 🧟`);
        if(navigator.vibrate) navigator.vibrate([50, 30, 50]);
    } else {
        msg("BRAK CELU W ZASIĘGU!");
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
        msg("BRAK ZASOBÓW!");
    }
    updateUI(true);
    toggleModal('craft');
};

function updateUI(cloud = false) {
    const hpFill = document.getElementById('hp-fill');
    if(hpFill) hpFill.style.width = Math.max(0, state.hp) + "%";
    
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
