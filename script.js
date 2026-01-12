import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let state = { hp: 10, scrap: 0, wood: 0, food: 3 };
let map, playerMarker, lastSpawnPos = null;
let zMarkers = [], lootMarkers = [];

document.getElementById('google-btn').onclick = () => signInWithRedirect(auth, provider);

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

function initGame() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const arrow = L.divIcon({ 
        className: 'player-arrow-wrapper', 
        html: '<div class="player-arrow-icon" id="user-arrow"></div>', 
        iconSize: [30, 30], iconAnchor: [15, 15] 
    });
    playerMarker = L.marker([0, 0], { icon: arrow }).addTo(map);

    // OBRÓT STRZAŁKI (KOMPAS)
    window.addEventListener('deviceorientationabsolute', (e) => {
        let heading = e.webkitCompassHeading || (360 - e.alpha);
        const el = document.getElementById('user-arrow');
        if (el && heading) el.style.transform = `rotate(${heading}deg)`;
    }, true);

    // GPS I AUTOMATYCZNE GENEROWANIE
    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);

        // Jeśli przeszedłeś 30 metrów od ostatniego punktu, generuj zasoby
        if (!lastSpawnPos || map.distance(p, lastSpawnPos) > 30) {
            lastSpawnPos = p;
            spawnNewWave(p);
        }
    }, null, { enableHighAccuracy: true });

    setInterval(gameLoop, 1000);
}

function spawnNewWave(p) {
    // Generuj 4 paczki i 2 zombie w promieniu gracza
    for(let i=0; i<4; i++) {
        const off = () => (Math.random() - 0.5) * 0.0035;
        const loot = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '📦', className: 'loot-icon' }) }).addTo(map);
        
        loot.on('click', () => {
            if(map.distance(playerMarker.getLatLng(), loot.getLatLng()) < 40) {
                map.removeLayer(loot);
                state.scrap += 5; state.wood += 2;
                showMsg("+5⚙️ +2🪵"); updateUI(true);
            } else showMsg("ZA DALEKO!");
        });

        if(i < 2) { // 2 zombie na każdą falę
            const z = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '🧟', className: 'zombie-icon' }) }).addTo(map);
            zMarkers.push(z);
        }
    }
}

function gameLoop() {
    if(!playerMarker) return;
    const pPos = playerMarker.getLatLng();

    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        
        if(dist < 100) { // ŚLEDZENIE
            const step = 0.00007;
            z.setLatLng([
                zPos.lat + (pPos.lat > zPos.lat ? step : -step),
                zPos.lng + (pPos.lng > zPos.lng ? step : -step)
            ]);
            if(dist < 12) { 
                state.hp -= 0.15; updateUI(); 
                if(Math.random() > 0.8) showMsg("⚠️ ATAK ZOMBIE!");
            }
        } else { // WAŁĘSANIE SIĘ
            const wander = 0.00002;
            z.setLatLng([
                zPos.lat + (Math.random()-0.5) * wander,
                zPos.lng + (Math.random()-0.5) * wander
            ]);
        }
    });
}

document.getElementById('btn-attack').onclick = () => {
    const p = playerMarker.getLatLng();
    zMarkers = zMarkers.filter(z => {
        if(map.distance(p, z.getLatLng()) < 45) {
            map.removeLayer(z); state.scrap += 3;
            showMsg("CEL ZLIKWIDOWANY (+3⚙️)"); updateUI(true);
            return false;
        }
        return true;
    });
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) {
        state.food--; state.hp = Math.min(10, state.hp + 4);
        updateUI(true); showMsg("REGENERACJA...");
    }
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

function showMsg(t) {
    const m = document.getElementById("msg");
    m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2000);
}

document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());
