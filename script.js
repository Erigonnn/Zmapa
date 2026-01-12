import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let state = { hp: 10, scrap: 10, wood: 10, food: 3 };
let map, playerMarker, lastSpawnPos = null;
let zMarkers = [];

// --- LOGOWANIE ---

// 1. Obsługa kliknięcia przycisku
document.getElementById('google-btn').onclick = () => {
    signInWithRedirect(auth, provider);
};

// 2. Przechwycenie wyniku po powrocie z Google
getRedirectResult(auth).then((result) => {
    if (result?.user) {
        console.log("Zalogowano pomyślnie przez Redirect");
    }
}).catch((error) => {
    console.error("Błąd Redirect:", error.message);
});

// 3. Monitorowanie stanu sesji (Główna logika wejścia do gry)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("Użytkownik aktywny:", user.uid);
        
        const userRef = doc(db, "users", user.uid);
        const s = await getDoc(userRef);
        
        if (s.exists()) {
            state = { ...state, ...s.data() };
        } else {
            // Jeśli użytkownik loguje się pierwszy raz, stwórz mu profil w bazie
            await setDoc(userRef, state);
            console.log("Utworzono nowy profil gracza");
        }

        // UKRYJ LOGOWANIE, POKAŻ GRĘ
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        
        // Inicjalizacja mapy jeśli jeszcze nie istnieje
        if (!map) {
            initGame();
            updateUI();
        }
    } else {
        // Jeśli nie ma użytkownika, upewnij się że widzi ekran logowania
        document.getElementById('landing-page').style.display = 'flex';
        document.getElementById('game-container').style.display = 'none';
    }
});

// --- MECHANIKA GRY ---

function initGame() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const arrow = L.divIcon({ 
        className: 'player-arrow-wrapper', 
        html: '<div class="player-arrow-icon" id="user-arrow"></div>', 
        iconSize: [30, 30], iconAnchor: [15, 15] 
    });
    playerMarker = L.marker([52.2, 21.0], { icon: arrow }).addTo(map);

    // Kompas
    window.addEventListener('deviceorientationabsolute', (e) => {
        let heading = e.webkitCompassHeading || (360 - e.alpha);
        const el = document.getElementById('user-arrow');
        if (el && heading) el.style.transform = `rotate(${heading}deg)`;
    }, true);

    // GPS
    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);

        if (!lastSpawnPos || map.distance(p, lastSpawnPos) > 35) {
            lastSpawnPos = p;
            spawnNewWave(p);
        }
    }, null, { enableHighAccuracy: true });

    setInterval(gameLoop, 1000);
}

function spawnNewWave(p) {
    for(let i=0; i<4; i++) {
        const off = () => (Math.random() - 0.5) * 0.0035;
        const loot = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '📦', className: 'loot-icon' }) }).addTo(map);
        
        loot.on('click', () => {
            if(map.distance(playerMarker.getLatLng(), loot.getLatLng()) < 45) {
                map.removeLayer(loot);
                state.scrap += 5; state.wood += 2;
                showMsg("+5⚙️ +2🪵"); updateUI(true);
            }
        });

        if(i < 2) {
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
        if(dist < 100) {
            const step = 0.00007;
            z.setLatLng([
                zPos.lat + (pPos.lat > zPos.lat ? step : -step),
                zPos.lng + (pPos.lng > zPos.lng ? step : -step)
            ]);
            if(dist < 12) { state.hp -= 0.15; updateUI(); }
        }
    });
}

// Interfejs
document.getElementById('btn-open-craft').onclick = () => document.getElementById('craft-panel').style.display = 'block';
document.getElementById('btn-close-craft').onclick = () => document.getElementById('craft-panel').style.display = 'none';

window.craft = function(type) {
    if (type === 'food' && state.scrap >= 5 && state.wood >= 5) {
        state.scrap -= 5; state.wood -= 5; state.food++;
        showMsg("🍎 Wytworzono jedzenie");
    } else if (type === 'base' && state.scrap >= 50 && state.wood >= 50) {
        state.scrap -= 50; state.wood -= 50;
        L.marker(playerMarker.getLatLng(), { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
        showMsg("🏠 Postawiono bazę");
    } else {
        showMsg("Brak surowców!");
    }
    updateUI(true);
};

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
        updateUI(true);
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
