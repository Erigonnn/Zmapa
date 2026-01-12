import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let state = { hp: 10, scrap: 0, wood: 0, food: 3, looted: {} };
let map, playerMarker, userHeading = 0;
let zMarkers = [];
let lootMarkers = [];

// --- LOGOWANIE REDIRECT ---
document.getElementById('google-btn').onclick = () => signInWithRedirect(auth, provider);

getRedirectResult(auth).catch(err => console.error("Błąd autoryzacji:", err.message));

onAuthStateChanged(auth, async user => {
    if (user) {
        const s = await getDoc(doc(db, "users", user.uid));
        if (s.exists()) state = { ...state, ...s.data() };
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        updateUI();
    }
});

document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

// --- INICJACJA GRY ---
function initGame() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Znacznik gracza (strzałka)
    const arrowIcon = L.divIcon({ className: 'player-arrow-wrapper', html: '<div class="player-arrow-icon"></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
    playerMarker = L.marker([52.2, 21.0], { icon: arrowIcon }).addTo(map);

    // OBSŁUGA KOMPASU
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientationabsolute', (e) => {
            userHeading = e.webkitCompassHeading || (360 - e.alpha);
            const arrowEl = document.querySelector('.player-arrow-icon');
            if (arrowEl) arrowEl.style.transform = `rotate(${userHeading}deg)`;
        }, true);
    }

    // GPS
    navigator.geolocation.watchPosition(pos => {
        const newPos = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(newPos);
        map.panTo(newPos);
        if (zMarkers.length < 3) spawnZombie(newPos);
    }, null, { enableHighAccuracy: true });

    setInterval(gameLoop, 1000);
}

// --- WĘDRUJĄCE ZOMBIE (AI) ---
function spawnZombie(center) {
    const lat = center[0] + (Math.random()-0.5)*0.005;
    const lng = center[1] + (Math.random()-0.5)*0.005;
    const z = L.marker([lat, lng], { icon: L.divIcon({ html: '🧟', className: 'zombie-icon' }) }).addTo(map);
    zMarkers.push(z);
}

function gameLoop() {
    if(!playerMarker) return;
    const pPos = playerMarker.getLatLng();
    
    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        
        if(dist < 150) { // Jeśli zombie jest blisko, zaczyna iść w stronę gracza
            const speed = 0.00008; 
            const newLat = zPos.lat + (pPos.lat > zPos.lat ? speed : -speed);
            const newLng = zPos.lng + (pPos.lng > zPos.lng ? speed : -speed);
            z.setLatLng([newLat, newLng]);

            if(dist < 15) { // Atak zombie
                state.hp -= 0.15;
                updateUI();
                if(Math.random() > 0.9) showMsg("⚠️ OTRZYMUJESZ OBRAŻENIA!");
            }
        }
    });
}

// --- GENERATOR PACZEK (PRZYCISK) ---
document.getElementById('btn-scan').onclick = () => {
    if(lootMarkers.length > 15) {
        showMsg("PRZECIĄŻENIE SKANERA. ZBIERZ OBECNE PACZKI.");
        return;
    }
    const p = playerMarker.getLatLng();
    for(let i=0; i<4; i++) {
        const latOff = (Math.random() - 0.5) * 0.003;
        const lngOff = (Math.random() - 0.5) * 0.003;
        const loot = L.marker([p.lat + latOff, p.lng + lngOff], {
            icon: L.divIcon({ html: '📦', className: 'loot-icon' })
        }).addTo(map);

        loot.on('click', () => {
            if (map.distance(playerMarker.getLatLng(), loot.getLatLng()) < 40) {
                map.removeLayer(loot);
                lootMarkers = lootMarkers.filter(m => m !== loot);
                state.scrap += 3; state.wood += 3;
                showMsg("+3⚙️ +3🪵");
                updateUI(true);
            } else {
                showMsg("ZA DALEKO!");
            }
        });
        lootMarkers.push(loot);
    }
    showMsg("WYKRYTO NOWE ZASYBY...");
};

// --- AKCJE ---
document.getElementById('btn-attack').onclick = () => {
    const pPos = playerMarker.getLatLng();
    zMarkers = zMarkers.filter(z => {
        if(map.distance(pPos, z.getLatLng()) < 45) {
            map.removeLayer(z);
            state.scrap += 2;
            showMsg("CEL ZNEUTRALIZOWANY (+2⚙️)");
            updateUI(true);
            return false;
        }
        return true;
    });
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) {
        state.food--;
        state.hp = Math.min(10, state.hp + 4);
        updateUI(true);
        showMsg("REGENERACJA...");
    } else showMsg("BRAK ŻYWNOŚCI");
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    
    if(state.hp <= 0) {
        alert("ZGINĄŁEŚ. SYSTEM RESTARTUJE...");
        state = { hp: 10, scrap: 0, wood: 0, food: 3, looted: {} };
        cloud = true;
    }
    
    if(cloud && auth.currentUser) {
        updateDoc(doc(db, "users", auth.currentUser.uid), state);
    }
}

function showMsg(t) {
    const m = document.getElementById("msg");
    m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2500);
}
