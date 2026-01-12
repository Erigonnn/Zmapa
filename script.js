import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- STAN GRY ---
let state = JSON.parse(localStorage.getItem("zmapa_progress")) || { hp: 10, scrap: 0, wood: 0, food: 5, looted: {} };
let map, player, zMarkers = [];
let lastScanPos = null;
let existingBases = new Set();
const MAX_ZOMBIES = 15;

// --- LOGOWANIE ---
document.getElementById('login-btn').onclick = () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, e, p).catch(err => alert("Błąd: " + err.message));
};

document.getElementById('register-btn').onclick = () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    createUserWithEmailAndPassword(auth, e, p)
    .then(u => {
        setDoc(doc(db, "users", u.user.uid), state);
        showMsg("KONTO UTWORZONE!");
    })
    .catch(err => alert("Błąd: " + err.message));
};

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => {
    localStorage.removeItem("zmapa_progress");
    location.reload();
});

onAuthStateChanged(auth, async (u) => {
    if (u) {
        const s = await getDoc(doc(db, "users", u.uid));
        if (s.exists()) {
            state = { ...state, ...s.data() };
            saveLocal();
        }
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        listenToBases();
    }
});

// --- START GRY ---
function initGame() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.1388, 16.2731], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    player = L.marker([52.1388, 16.2731], { 
        icon: L.divIcon({ html: '<div id="p-arrow" class="player-arrow"></div>', className: 'p-wrap' }) 
    }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        player.setLatLng(ll);
        map.panTo(ll);
        if(zMarkers.length < MAX_ZOMBIES) spawnZombie(ll);
        scanLoot(ll);
    }, null, { enableHighAccuracy: true });

    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientationabsolute', e => {
            let heading = e.alpha || e.webkitCompassHeading;
            if (heading) {
                const arrow = document.getElementById('p-arrow');
                if(arrow) arrow.style.transform = `rotate(${-heading}deg)`;
            }
        }, true);
    }
    setInterval(updateZombies, 1500);
}

// --- POPRAWIONE ZOMBIE (LOGIKA DYSTANSU) ---
function updateZombies() {
    if(!player) return;
    const pPos = player.getLatLng();
    
    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        
        if (dist < 60) { // Zauważają gracza z 60 metrów
            const speed = 0.00018; 
            z.setLatLng([
                zPos.lat + (pPos.lat > zPos.lat ? speed : -speed), 
                zPos.lng + (pPos.lng > zPos.lng ? speed : -speed)
            ]);
        } else { // Spacerują losowo, gdy gracz jest daleko
            const drift = 0.00005;
            z.setLatLng([
                zPos.lat + (Math.random() - 0.5) * drift, 
                zPos.lng + (Math.random() - 0.5) * drift
            ]);
        }

        if (dist < 12) { // Atak
            state.hp = Math.max(0, state.hp - 0.4); 
            updateUI(true); 
            showMsg("ZOMBIE CIĘ GRYZIE!");
        }
    });
}

function spawnZombie(pos) {
    const loc = [pos[0] + (Math.random() - 0.5) * 0.006, pos[1] + (Math.random() - 0.5) * 0.006];
    const z = L.marker(loc, { icon: L.divIcon({ html: '💀', className: 'z-icon' }) }).addTo(map);
    zMarkers.push(z);
}

document.getElementById('btn-attack').onclick = () => {
    const pPos = player.getLatLng();
    zMarkers = zMarkers.filter(z => {
        if(map.distance(pPos, z.getLatLng()) < 40) {
            map.removeLayer(z);
            state.scrap += 1;
            updateUI(true);
            showMsg("ZABITO ZOMBI! +1⚙️");
            return false;
        }
        return true;
    });
};

// --- LOOT ---
async function scanLoot(pos) {
    if (lastScanPos && map.distance(pos, lastScanPos) < 40) return;
    lastScanPos = pos;
    const q = `[out:json];way["building"](around:80,${pos[0]},${pos[1]});out center 5;`;
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q })
    .then(r => r.json()).then(data => {
        data.elements.forEach(el => {
            if (state.looted[el.id]) return;
            const m = L.marker([el.center.lat, el.center.lon], { icon: L.divIcon({ html: '📦', className: 'poi-icon' }) }).addTo(map).on('click', function() {
                if (map.distance(player.getLatLng(), this.getLatLng()) < 40) {
                    map.removeLayer(this);
                    state.looted[el.id] = true;
                    state.scrap += 2; state.wood += 2;
                    updateUI(true); showMsg("ŁUP ZEBRANY! +2🪵 +2⚙️");
                }
            });
        });
    });
}

// --- BAZY GLOBALNE ---
document.getElementById('btn-base').onclick = async () => {
    if (state.wood >= 10 && state.scrap >= 5) {
        const p = player.getLatLng();
        try {
            await addDoc(collection(db, "bases"), { 
                lat: p.lat, 
                lng: p.lng, 
                owner: auth.currentUser.uid,
                timestamp: Date.now()
            });
            state.wood -= 10; state.scrap -= 5;
            updateUI(true);
            showMsg("BAZA POSTAWIONA!");
        } catch(e) { showMsg("BŁĄD ZAPISU!"); }
    } else showMsg("POTRZEBA 10🪵 I 5⚙️");
};

function listenToBases() {
    onSnapshot(collection(db, "bases"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const docId = change.doc.id;
                const b = change.doc.data();
                if (!existingBases.has(docId)) {
                    L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
                    existingBases.add(docId);
                }
            }
        });
    });
}

// --- UI ---
document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) {
        state.food--; state.hp = Math.min(10, state.hp + 3);
        updateUI(true);
        showMsg("ZJEDZONO POSIŁEK 🍎");
    } else showMsg("BRAK JEDZENIA!");
};

function updateUI(saveToCloud = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    
    saveLocal();

    if(saveToCloud && auth.currentUser) {
        updateDoc(doc(db, "users", auth.currentUser.uid), state).catch(() => {});
    }

    if(state.hp <= 0) { 
        alert("ZGINĄŁEŚ!"); 
        state.hp = 10; 
        updateUI(true); 
        location.reload(); 
    }
}

function saveLocal() {
    localStorage.setItem("zmapa_progress", JSON.stringify(state));
}

function showMsg(t) {
    const m = document.getElementById("msg"); 
    if(m) {
        m.innerText = t; m.style.display = "block";
        setTimeout(() => m.style.display = "none", 2500);
    }
}

updateUI();
