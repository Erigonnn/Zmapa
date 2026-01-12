import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, onSnapshot, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let state = JSON.parse(localStorage.getItem("zmapa_progress")) || { hp: 10, scrap: 0, wood: 0, food: 5, looted: {} };
let map, player, rangeCircle, zMarkers = [];
let existingBases = {}; // Zmienione na obiekt, by łatwiej usuwać
let lastScanPos = null;
const MAX_ZOMBIES = 12;

onAuthStateChanged(auth, async (u) => {
    if (u) {
        const s = await getDoc(doc(db, "users", u.uid));
        if (s.exists()) { state = { ...state, ...s.data() }; saveLocal(); }
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        listenToBases();
    }
});

function initGame() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.1388, 16.2731], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    player = L.marker([52.1388, 16.2731], { 
        icon: L.divIcon({ html: '<div id="p-arrow" class="player-arrow"></div>', className: 'p-wrap' }) 
    }).addTo(map);

    // OKRĄG ZASIĘGU GRACZA (40m)
    rangeCircle = L.circle([52.1388, 16.2731], {
        radius: 40,
        color: '#3388ff',
        fillOpacity: 0.1,
        weight: 1
    }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        player.setLatLng(ll);
        rangeCircle.setLatLng(ll);
        map.panTo(ll);
        if(zMarkers.length < MAX_ZOMBIES) spawnZombie(ll);
        scanLoot(ll);
    }, null, { enableHighAccuracy: true });

    setInterval(gameTick, 1500);
}

// GŁÓWNA PĘTLA GRY (ZOMBIE + REGENERACJA)
function gameTick() {
    if(!player) return;
    const pPos = player.getLatLng();
    let inSafeZone = false;

    // Sprawdzanie czy gracz jest w swojej bazie
    Object.values(existingBases).forEach(b => {
        if (b.owner === auth.currentUser.uid) {
            const distToBase = map.distance(pPos, [b.lat, b.lng]);
            if (distToBase < 30) { // Zasięg bazy 30m
                inSafeZone = true;
                if (state.hp < 10) {
                    state.hp = Math.min(10, state.hp + 0.2); // Regeneracja HP
                    updateUI();
                }
            }
        }
    });

    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        
        if (dist < 45) {
            const speed = 0.00022;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? speed : -speed), zPos.lng + (pPos.lng > zPos.lng ? speed : -speed)]);
        }

        // Atakuje tylko jeśli gracz NIE jest w strefie bezpiecznej
        if (dist < 12 && !inSafeZone) { 
            state.hp = Math.max(0, state.hp - 0.7); 
            updateUI(true); 
            showMsg("ZOMBIE ATAKUJE!"); 
        } else if (dist < 12 && inSafeZone) {
            showMsg("STREFA BEZPIECZNA!");
        }
    });
}

// --- BUDOWANIE (LIMIT 1 BAZY) ---
document.getElementById('btn-base').onclick = async () => {
    if (state.wood >= 10 && state.scrap >= 5) {
        const p = player.getLatLng();
        
        // 1. Usuń starą bazę z Firebase
        const q = query(collection(db, "bases"), where("owner", "==", auth.currentUser.uid));
        const oldBases = await getDocs(q);
        oldBases.forEach(async (d) => {
            await deleteDoc(doc(db, "bases", d.id));
        });

        // 2. Dodaj nową bazę
        await addDoc(collection(db, "bases"), { 
            lat: p.lat, 
            lng: p.lng, 
            owner: auth.currentUser.uid 
        });

        state.wood -= 10; state.scrap -= 5;
        updateUI(true);
        showMsg("PRZENIESIONO BAZĘ!");
    } else showMsg("POTRZEBA 10🪵 I 5⚙️");
};

function listenToBases() {
    onSnapshot(collection(db, "bases"), (snap) => {
        // Czyścimy bazy na mapie przy każdej zmianie (uproszczenie dla limitu 1 bazy)
        map.eachLayer(layer => {
            if (layer.options && layer.options.isBaseLayer) map.removeLayer(layer);
        });
        existingBases = {};

        snap.forEach(doc => {
            const b = doc.data();
            existingBases[doc.id] = b;
            
            // Rysowanie bazy
            L.marker([b.lat, b.lng], { 
                icon: L.divIcon({ html: '🏠', className: 'base-icon' }),
                isBaseLayer: true 
            }).addTo(map);

            // Jeśli to baza gracza, narysuj zielony okrąg bezpieczeństwa
            if (b.owner === auth.currentUser.uid) {
                L.circle([b.lat, b.lng], {
                    radius: 30,
                    color: '#2ecc71',
                    fillOpacity: 0.2,
                    weight: 2,
                    isBaseLayer: true
                }).addTo(map);
            }
        });
    });
}

// --- RESZTA FUNKCJI (ZOMBIE SPAWN, LOOT, UI) BEZ ZMIAN ---
function spawnZombie(pos) {
    const loc = [pos[0] + (Math.random() - 0.5) * 0.005, pos[1] + (Math.random() - 0.5) * 0.005];
    const z = L.marker(loc, { icon: L.divIcon({ html: '💀', className: 'z-icon' }) }).addTo(map);
    zMarkers.push(z);
}

async function scanLoot(pos) {
    if (lastScanPos && map.distance(pos, lastScanPos) < 30) return;
    lastScanPos = pos;
    const q = `[out:json];node["shop"](around:100,${pos[0]},${pos[1]});way["building"](around:100,${pos[0]},${pos[1]});out center 10;`;
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q })
    .then(r => r.json()).then(data => {
        data.elements.forEach(el => {
            const id = el.id;
            const lat = el.lat || el.center.lat;
            const lon = el.lon || el.center.lon;
            if (state.looted[id]) return;
            const m = L.marker([lat, lon], { icon: L.divIcon({ html: '📦', className: 'poi-icon' }) }).addTo(map).on('click', () => {
                if (map.distance(player.getLatLng(), m.getLatLng()) < 40) {
                    map.removeLayer(m);
                    state.looted[id] = true;
                    state.scrap += 2; state.wood += 2;
                    updateUI(true);
                }
            });
        });
    });
}

document.getElementById('btn-attack').onclick = () => {
    const pPos = player.getLatLng();
    zMarkers = zMarkers.filter(z => {
        if(map.distance(pPos, z.getLatLng()) < 40) {
            map.removeLayer(z);
            state.scrap += 1; updateUI(true);
            showMsg("POKONANO ZOMBIE!");
            return false;
        }
        return true;
    });
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) {
        state.food--; state.hp = Math.min(10, state.hp + 3);
        updateUI(true);
    }
};

function updateUI(saveCloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    localStorage.setItem("zmapa_progress", JSON.stringify(state));
    if(saveCloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
    if(state.hp <= 0) {
        alert("ZGINĄŁEŚ!");
        state = { hp: 10, scrap: 0, wood: 0, food: 2, looted: {} };
        updateUI(true); location.reload();
    }
}

function showMsg(t) {
    const m = document.getElementById("msg");
    m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2000);
}

const craftModal = document.getElementById('craft-modal');
document.getElementById('btn-craft').onclick = () => craftModal.style.display = 'block';
document.getElementById('btn-close-craft').onclick = () => craftModal.style.display = 'none';
document.getElementById('btn-craft-food').onclick = () => {
    if (state.wood >= 3 && state.scrap >= 2) {
        state.wood -= 3; state.scrap -= 2; state.food++;
        updateUI(true);
    }
};

updateUI();
