import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, onSnapshot, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// KONFIGURACJA FIREBASE (Wklej tu swoje dane, jeśli inne)
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

// STAN GRY
let state = { hp: 10, scrap: 0, wood: 0, food: 3, looted: {} };
let map, player, rangeCircle;
let zMarkers = []; 
let lastScanPos = null;
let existingBases = {};

// --- 1. SYSTEM LOGOWANIA ---
document.getElementById('login-btn').onclick = () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    if(!e || !p) return alert("Podaj dane!");
    signInWithEmailAndPassword(auth, e, p).catch(err => alert("Błąd: " + err.message));
};

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async user => {
    if (user) {
        // Pobierz stan gracza z bazy lub stwórz nowy
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            state = { ...state, ...docSnap.data() };
        }
        
        // Przełącz widok
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        
        initGame();
        listenToBases(); // Nasłuchuj baz innych graczy
        updateUI();
    }
});

// --- 2. MAPA I GPS ---
function initGame() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Gracz
    player = L.marker([0, 0], { 
        icon: L.divIcon({ className: 'player-marker', html: '' }) 
    }).addTo(map);

    // Okrąg zasięgu (40m)
    rangeCircle = L.circle([0, 0], { radius: 40, color: '#0aff0a', fillOpacity: 0.05, weight: 1 }).addTo(map);

    // Śledzenie pozycji
    navigator.geolocation.watchPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const newPos = [lat, lng];

        player.setLatLng(newPos);
        rangeCircle.setLatLng(newPos);
        map.panTo(newPos);

        // Mechaniki oparte na ruchu
        if (zMarkers.length < 6) spawnZombie(newPos);
        scanLoot(newPos);
    }, err => console.error(err), { enableHighAccuracy: true });

    // Pętla gry (AI, Regeneracja)
    setInterval(gameLoop, 1000);
}

// --- 3. ZOMBIE AI (WŁÓCZĘGA I ATAK) ---
function spawnZombie(center) {
    // Losowa pozycja wokół gracza
    const lat = center[0] + (Math.random() - 0.5) * 0.008;
    const lng = center[1] + (Math.random() - 0.5) * 0.008;
    
    const z = L.marker([lat, lng], { 
        icon: L.divIcon({ html: '🧟', className: 'zombie-marker' }) 
    }).addTo(map);
    
    z.target = null; // Cel włóczęgi
    zMarkers.push(z);
}

function gameLoop() {
    if (!player || !auth.currentUser) return;
    const pPos = player.getLatLng();
    let isSafe = false;

    // 2a. Sprawdzanie czy jesteśmy w bazie (Regeneracja)
    Object.values(existingBases).forEach(b => {
        const basePos = [b.lat, b.lng];
        if (map.distance(pPos, basePos) < 30 && b.owner === auth.currentUser.uid) {
            isSafe = true;
            if (state.hp < 10) state.hp = Math.min(10, state.hp + 0.2);
        }
    });

    // 2c. Logika Zombie
    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);

        if (dist < 50) {
            // TRYB POŚCIGU (Jeśli blisko)
            const latDir = (pPos.lat - zPos.lat) * 0.05; // Prędkość pościgu
            const lngDir = (pPos.lng - zPos.lng) * 0.05;
            z.setLatLng([zPos.lat + latDir, zPos.lng + lngDir]);

            // Atak (jeśli bardzo blisko i nie w bazie)
            if (dist < 10 && !isSafe) {
                state.hp -= 0.5;
                showMsg("⚠️ ZOMBIE ATAKUJE!");
            }
        } else {
            // TRYB WŁÓCZĘGI (Losowy ruch)
            if (!z.target || map.distance(zPos, z.target) < 5) {
                z.target = [
                    zPos.lat + (Math.random() - 0.5) * 0.002,
                    zPos.lng + (Math.random() - 0.5) * 0.002
                ];
            }
            const latDir = (z.target[0] - zPos.lat) * 0.02;
            const lngDir = (z.target[1] - zPos.lng) * 0.02;
            z.setLatLng([zPos.lat + latDir, zPos.lng + lngDir]);
        }
    });

    updateUI(); // Odśwież pasek życia
}

// --- 2e. LOOT (Overpass API) ---
async function scanLoot(pos) {
    if (lastScanPos && map.distance(pos, lastScanPos) < 50) return; // Skanuj co 50m
    lastScanPos = pos;

    const query = `
        [out:json];
        (
            node["building"](around:150,${pos[0]},${pos[1]});
            node["shop"](around:150,${pos[0]},${pos[1]});
            node["amenity"](around:150,${pos[0]},${pos[1]});
        );
        out;
    `;

    try {
        const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
        const data = await res.json();

        data.elements.forEach(el => {
            if (state.looted[el.id]) return; // Już zebrane

            const m = L.marker([el.lat, el.lon], {
                icon: L.divIcon({ html: '📦', className: 'loot-marker' })
            }).addTo(map);

            m.on('click', () => {
                if (map.distance(player.getLatLng(), m.getLatLng()) < 40) {
                    map.removeLayer(m);
                    state.looted[el.id] = true;
                    state.scrap += Math.floor(Math.random() * 3) + 1;
                    state.wood += Math.floor(Math.random() * 3) + 1;
                    showMsg("Znaleziono zapasy!");
                    updateUI(true);
                } else {
                    showMsg("Podejdź bliżej!");
                }
            });
        });
    } catch (e) {
        console.log("Błąd mapy:", e);
    }
}

// --- 2b. WALKA ---
document.getElementById('btn-attack').onclick = () => {
    const pPos = player.getLatLng();
    let hit = false;
    
    zMarkers = zMarkers.filter(z => {
        if (map.distance(pPos, z.getLatLng()) < 40) {
            map.removeLayer(z);
            state.scrap += 1; // Nagroda za zabicie
            hit = true;
            return false; // Usuń z listy
        }
        return true;
    });

    if (hit) {
        showMsg("Zombie wyeliminowany! +1 Złom");
        updateUI(true);
    } else {
        showMsg("Brak celów w zasięgu!");
    }
};

// --- 2a. BUDOWANIE BAZY (Firebase) ---
document.getElementById('btn-base').onclick = async () => {
    if (state.wood >= 10 && state.scrap >= 5) {
        const pPos = player.getLatLng();
        
        // Usuń starą bazę gracza
        const q = query(collection(db, "bases"), where("owner", "==", auth.currentUser.uid));
        const snaps = await getDocs(q);
        snaps.forEach(doc => deleteDoc(doc.ref));

        // Dodaj nową
        await addDoc(collection(db, "bases"), {
            lat: pPos.lat,
            lng: pPos.lng,
            owner: auth.currentUser.uid
        });

        state.wood -= 10;
        state.scrap -= 5;
        showMsg("Baza została założona!");
        updateUI(true);
    } else {
        showMsg("Koszt: 10 Drewna, 5 Złomu");
    }
};

function listenToBases() {
    onSnapshot(collection(db, "bases"), snapshot => {
        // Wyczyść stare znaczniki baz (oprócz gracza i zombie)
        map.eachLayer(layer => {
            if (layer.options.className === 'base-marker' || (layer instanceof L.Circle && layer !== rangeCircle)) {
                map.removeLayer(layer);
            }
        });

        existingBases = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            existingBases[doc.id] = data;
            
            L.marker([data.lat, data.lng], {
                icon: L.divIcon({ html: '🏠', className: 'base-marker' })
            }).addTo(map);
            
            // Zielony okrąg dla własnej bazy
            if (data.owner === auth.currentUser.uid) {
                L.circle([data.lat, data.lng], { radius: 30, color: '#0aff0a', weight: 2 }).addTo(map);
            }
        });
    });
}

// --- 2d. CRAFTING I UI ---
document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'flex';
document.getElementById('btn-close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';

document.getElementById('btn-craft-food').onclick = () => {
    if (state.wood >= 3 && state.scrap >= 2) {
        state.wood -= 3;
        state.scrap -= 2;
        state.food += 1;
        showMsg("Wyprodukowano jedzenie!");
        updateUI(true);
    } else {
        showMsg("Brak surowców!");
    }
};

document.getElementById('btn-eat').onclick = () => {
    if (state.food > 0) {
        state.food--;
        state.hp = Math.min(10, state.hp + 4);
        updateUI(true);
    } else {
        showMsg("Jesteś głodny! Znajdź jedzenie.");
    }
};

function updateUI(saveToCloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;

    if (state.hp <= 0) {
        alert("ZGINĄŁEŚ! Reset zasobów.");
        state.hp = 10; state.scrap = 0; state.wood = 0; state.food = 2;
        saveToCloud = true;
    }

    if (saveToCloud && auth.currentUser) {
        updateDoc(doc(db, "users", auth.currentUser.uid), state);
    }
}

function showMsg(text) {
    const el = document.getElementById('msg');
    el.innerText = text;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2000);
}
