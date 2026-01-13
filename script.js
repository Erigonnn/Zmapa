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

let state = { hp: 100, scrap: 50, wood: 50, food: 2, weapon: "PIĘŚCI", hasBase: false };
let map, playerMarker;
let zombies = [], loots = [];

// --- KLUCZOWA POPRAWKA LOGOWANIA ---

// 1. Ustawienie trwałej sesji
setPersistence(auth, browserLocalPersistence);

// 2. Obsługa kliknięcia (Popup zamiast Redirect)
document.getElementById('google-btn').onclick = async () => {
    try {
        const result = await signInWithPopup(auth, provider);
        if (result.user) {
            console.log("Zalogowano:", result.user.displayName);
            enterGame(result.user);
        }
    } catch (err) {
        console.error("Błąd logowania:", err.code);
        alert("Błąd logowania. Upewnij się, że Twoja domena jest dodana w Firebase Console!");
    }
};

// 3. Monitor stanu sesji (wywoływane automatycznie przy odświeżeniu)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        enterGame(user);
    } else {
        // Jeśli nie ma usera, upewnij się, że widzi ekran startowy
        document.getElementById('landing-page').style.display = 'flex';
        document.getElementById('game-container').style.display = 'none';
    }
});

// Funkcja przenosząca do gry
async function enterGame(user) {
    const docRef = doc(db, "users", user.uid);
    const snap = await getDoc(docRef);
    
    if (snap.exists()) {
        state = { ...state, ...snap.data() };
    } else {
        await setDoc(docRef, state);
    }

    // Przełącz widok
    document.getElementById('landing-page').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Inicjalizuj mapę TYLKO RAZ
    if (!map) {
        startSurvival();
        updateUI();
    }
}

// --- MECHANIKA GRY (BEZ ZMIAN W LOGICE, TYLKO STABILNOŚĆ) ---

function startSurvival() {
    // Inicjalizacja z opóźnieniem, żeby Leaflet nie rzucił błędem o braku kontenera
    setTimeout(() => {
        map = L.map('map', { zoomControl: false }).setView([52.2, 21.0], 18);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

        playerMarker = L.marker([52.2, 21.0], {
            icon: L.divIcon({ className: 'player-icon', id: 'arrow', iconSize: [20, 20] })
        }).addTo(map);

        // GPS
        navigator.geolocation.watchPosition(pos => {
            const p = [pos.coords.latitude, pos.coords.longitude];
            playerMarker.setLatLng(p);
            map.panTo(p);
            if (loots.length < 15) spawnLoot(p);
        }, (err) => console.log("GPS Error:", err), { enableHighAccuracy: true });

        // Kompas
        window.addEventListener('deviceorientationabsolute', (e) => {
            let heading = e.webkitCompassHeading || (360 - e.alpha);
            const el = document.getElementById('arrow');
            if(el && heading) el.style.transform = `rotate(${heading}deg)`;
        }, true);

        // Bazy innych graczy
        onSnapshot(collection(db, "bases"), (snap) => {
            snap.forEach(d => {
                const b = d.data();
                L.marker([b.lat, b.lng], { 
                    icon: L.divIcon({ html: '🏠', className: 'base-label', iconSize: [30, 30] }) 
                }).addTo(map);
            });
        });

        setInterval(gameLoop, 1000);
    }, 100);
}

function spawnLoot(p) {
    const off = () => (Math.random() - 0.5) * 0.005;
    const l = L.marker([p[0]+off(), p[1]+off()], { 
        icon: L.divIcon({ html: '📦', className: 'loot-icon', iconSize: [30, 30] }) 
    }).addTo(map);
    
    l.on('click', () => {
        if(map.distance(playerMarker.getLatLng(), l.getLatLng()) < 40) {
            state.scrap += 15; 
            updateUI(true); 
            map.removeLayer(l);
            msg("Znalazłeś złom! +15⚙️");
        }
    });
    loots.push(l);
}

function gameLoop() {
    if (!playerMarker) return;
    const pPos = playerMarker.getLatLng();

    // Spawn Zombie
    if(zombies.length < 6) {
        const off = () => (Math.random() - 0.5) * 0.007;
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { 
            icon: L.divIcon({ html: '🧟', className: 'zombie-icon', iconSize: [30, 30] }) 
        }).addTo(map);
        zombies.push(z);
    }

    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        if(dist < 90) { 
            const s = 0.00008;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? s : -s), zPos.lng + (pPos.lng > zPos.lng ? s : -s)]);
            if(dist < 12) { state.hp -= 1.5; updateUI(); }
        } else {
            z.setLatLng([zPos.lat + (Math.random()-0.5)*0.0001, zPos.lng + (Math.random()-0.5)*0.0001]);
        }
    });
}

// Globalne funkcje Craftingu (dostępne z HTML)
window.handleCraft = async (type) => {
    if (type === 'weapon' && state.scrap >= 30) {
        state.scrap -= 30; state.weapon = "NÓŻ MYŚLIWSKI";
        msg("Wytworzono broń!");
    } else if (type === 'base' && state.wood >= 100 && !state.hasBase) {
        state.wood -= 100; state.hasBase = true;
        const p = playerMarker.getLatLng();
        await setDoc(doc(db, "bases", auth.currentUser.uid), { 
            lat: p.lat, 
            lng: p.lng, 
            owner: auth.currentUser.displayName 
        });
        msg("Baza postawiona!");
    } else {
        msg("Brak surowców!");
    }
    updateUI(true);
    document.getElementById('craft-modal').style.display = 'none';
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar').style.width = Math.max(0, state.hp) + "%";
    document.getElementById('hp-text').innerText = Math.max(0, Math.floor(state.hp));
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    document.getElementById('active-weapon').innerText = state.weapon;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

document.getElementById('btn-attack').onclick = () => {
    const p = playerMarker.getLatLng();
    zombies = zombies.filter(z => {
        if(map.distance(p, z.getLatLng()) < 40) {
            map.removeLayer(z); 
            state.scrap += 8; 
            updateUI(true);
            msg("Zabito zombie! +8⚙️"); 
            return false;
        }
        return true;
    });
};

document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'flex';
document.getElementById('close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';
document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) {
        state.food--; state.hp = Math.min(100, state.hp + 20);
        updateUI(true); msg("Zjedzono rację żywnościową");
    }
};

function msg(m) { 
    const t = document.getElementById('toast'); 
    t.innerText = m; 
    t.style.display='block'; 
    setTimeout(()=>t.style.display='none', 2000); 
}
