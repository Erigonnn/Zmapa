import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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
const provider = new GoogleAuthProvider();

let state = JSON.parse(localStorage.getItem("zmapa_progress")) || { hp: 10, scrap: 0, wood: 0, food: 5, looted: {} };
let map, player, rangeCircle, zMarkers = [];
let existingBases = {}; 
let lastScanPos = null;
const MAX_ZOMBIES = 12;

// --- AUTH LOGIC ---
document.getElementById('login-btn').onclick = () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    if(!email || !pass) return alert("Wpisz dane!");
    signInWithEmailAndPassword(auth, email, pass).catch(err => alert("Błąd: " + err.message));
};

document.getElementById('register-btn').onclick = () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    createUserWithEmailAndPassword(auth, email, pass)
        .then(u => setDoc(doc(db, "users", u.user.uid), state))
        .catch(err => alert("Błąd: " + err.message));
};

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);

document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async (u) => {
    if (u) {
        const s = await getDoc(doc(db, "users", u.uid));
        if (s.exists()) { state = { ...state, ...s.data() }; }
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        listenToBases();
    } else {
        document.getElementById('landing-page').style.display = 'flex';
        document.getElementById('game-container').style.display = 'none';
    }
});

// --- GAME CORE ---
function initGame() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.1388, 16.2731], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    player = L.marker([52.1388, 16.2731], { 
        icon: L.divIcon({ html: '<div class="player-arrow"></div>', className: 'p-wrap' }) 
    }).addTo(map);

    rangeCircle = L.circle([52.1388, 16.2731], {
        radius: 40, color: '#3388ff', fillOpacity: 0.1, weight: 1
    }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        player.setLatLng(ll);
        rangeCircle.setLatLng(ll);
        map.panTo(ll);
        if(zMarkers.length < MAX_ZOMBIES) spawnZombie(ll);
        scanLoot(ll);
    }, null, { enableHighAccuracy: true });

    setInterval(gameTick, 1000);
}

function gameTick() {
    if(!player || !auth.currentUser) return;
    const pPos = player.getLatLng();
    let inSafeZone = false;

    Object.values(existingBases).forEach(b => {
        if (b.owner === auth.currentUser.uid) {
            const dist = map.distance(pPos, [b.lat, b.lng]);
            if (dist < 30) {
                inSafeZone = true;
                if (state.hp < 10) { state.hp = Math.min(10, state.hp + 0.1); updateUI(); }
            }
        }
    });

    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        if (dist < 45) {
            const speed = 0.00025;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? speed : -speed), zPos.lng + (pPos.lng > zPos.lng ? speed : -speed)]);
        }
        if (dist < 12 && !inSafeZone) { 
            state.hp = Math.max(0, state.hp - 0.4); 
            updateUI(true); 
            showMsg("ZOMBI CIĘ GRYZIE!");
        }
    });
}

// --- ACTIONS ---
document.getElementById('btn-base').onclick = async () => {
    if (state.wood >= 10 && state.scrap >= 5) {
        const p = player.getLatLng();
        const q = query(collection(db, "bases"), where("owner", "==", auth.currentUser.uid));
        const oldBases = await getDocs(q);
        for (const d of oldBases.docs) { await deleteDoc(doc(db, "bases", d.id)); }
        await addDoc(collection(db, "bases"), { lat: p.lat, lng: p.lng, owner: auth.currentUser.uid });
        state.wood -= 10; state.scrap -= 5;
        updateUI(true);
        showMsg("BAZA WYBUDOWANA!");
    } else showMsg("POTRZEBA 10🪵 I 5⚙️");
};

function listenToBases() {
    onSnapshot(collection(db, "bases"), (snap) => {
        map.eachLayer(layer => {
            if ((layer instanceof L.Circle && layer !== rangeCircle) || (layer instanceof L.Marker && layer !== player && !zMarkers.includes(layer) && !layer.options.isLoot)) {
                map.removeLayer(layer);
            }
        });
        existingBases = {};
        snap.forEach(docSnap => {
            const b = docSnap.data();
            existingBases[docSnap.id] = b;
            L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
            if (b.owner === auth.currentUser.uid) {
                L.circle([b.lat, b.lng], { radius: 30, color: '#2ecc71', fillOpacity: 0.15, weight: 2 }).addTo(map);
            }
        });
    });
}

function spawnZombie(pos) {
    const loc = [pos[0] + (Math.random() - 0.5) * 0.006, pos[1] + (Math.random() - 0.5) * 0.006];
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
            const m = L.marker([lat, lon], { icon: L.divIcon({ html: '📦', className: 'poi-icon' }), isLoot: true }).addTo(map).on('click', () => {
                if (map.distance(player.getLatLng(), m.getLatLng()) < 40) {
                    map.removeLayer(m);
                    state.looted[id] = true;
                    state.scrap += 2; state.wood += 2;
                    updateUI(true);
                    showMsg("ŁUP ZEBRANY! +2⚙️ +2🪵");
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
            showMsg("ZOMBI POKONANY! +1⚙️");
            return false;
        }
        return true;
    });
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) {
        state.food--; state.hp = Math.min(10, state.hp + 3);
        updateUI(true);
        showMsg("POSIŁEK ZJEDZONY 🍎");
    } else showMsg("BRAK JEDZENIA!");
};

function updateUI(saveCloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = Math.floor(state.scrap);
    document.getElementById('s-wood').innerText = Math.floor(state.wood);
    document.getElementById('s-food').innerText = state.food;
    localStorage.setItem("zmapa_progress", JSON.stringify(state));
    if(saveCloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
    if(state.hp <= 0) {
        alert("ZGINĄŁEŚ! TRACISZ ZAPASY.");
        state = { hp: 10, scrap: 0, wood: 0, food: 2, looted: {} };
        updateUI(true); location.reload();
    }
}

function showMsg(t) {
    const m = document.getElementById("msg");
    m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2000);
}

// Crafting
const craftModal = document.getElementById('craft-modal');
document.getElementById('btn-craft').onclick = () => craftModal.style.display = 'block';
document.getElementById('btn-close-craft').onclick = () => craftModal.style.display = 'none';
document.getElementById('btn-craft-food').onclick = () => {
    if (state.wood >= 3 && state.scrap >= 2) {
        state.wood -= 3; state.scrap -= 2; state.food++;
        updateUI(true);
        showMsg("PROWIANT GOTOWY!");
    } else { showMsg("BRAK MATERIAŁÓW!"); }
};

updateUI();
