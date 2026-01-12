import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let state = { hp: 10, scrap: 0, wood: 0, food: 5, looted: {} };
let map, player, zMarkers = [];
let lastScanPos = null;
const MAX_ZOMBIES = 20;

// --- LOGOWANIE ---
document.getElementById('login-btn').onclick = () => {
    signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value)
    .catch(err => alert("Błąd: " + err.message));
};

document.getElementById('register-btn').onclick = () => {
    createUserWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value)
    .then(u => setDoc(doc(db, "users", u.user.uid), state))
    .catch(err => alert("Błąd: " + err.message));
};

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);

document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async (u) => {
    if (u) {
        const s = await getDoc(doc(db, "users", u.uid));
        if (s.exists()) Object.assign(state, s.data());
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        loadBases(); // Ładowanie baz po zalogowaniu
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
            if (heading) document.getElementById('p-arrow').style.transform = `rotate(${-heading}deg)`;
        }, true);
    }
    setInterval(updateZombies, 1000);
}

// --- ZOMBIE (BEZ ZMIAN) ---
function updateZombies() {
    if(!player) return;
    const pPos = player.getLatLng();
    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        if (dist < 50) {
            const speed = 0.0002;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? speed : -speed), zPos.lng + (pPos.lng > zPos.lng ? speed : -speed)]);
        } else {
            const drift = 0.0001;
            z.setLatLng([zPos.lat + (Math.random() - 0.5) * drift, zPos.lng + (Math.random() - 0.5) * drift]);
        }
        if (dist < 10) { state.hp = Math.max(0, state.hp - 0.2); updateUI(true); }
    });
}

function spawnZombie(pos) {
    const loc = [pos[0] + (Math.random() - 0.5) * 0.008, pos[1] + (Math.random() - 0.5) * 0.008];
    const z = L.marker(loc, { icon: L.divIcon({ html: '💀', className: 'z-icon' }) }).addTo(map);
    zMarkers.push(z);
}

// --- LOOT (BEZ ZMIAN) ---
async function scanLoot(pos) {
    if (lastScanPos && map.distance(pos, lastScanPos) < 50) return;
    lastScanPos = pos;
    const q = `[out:json];way["building"](around:100,${pos[0]},${pos[1]});out center 5;`;
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q })
    .then(r => r.json()).then(data => {
        data.elements.forEach(el => {
            if (state.looted[el.id]) return;
            const m = L.marker([el.center.lat, el.center.lon], { icon: L.divIcon({ html: '📦', className: 'poi-icon' }) }).addTo(map).on('click', function() {
                if (map.distance(player.getLatLng(), this.getLatLng()) < 40) {
                    map.removeLayer(this);
                    state.looted[el.id] = true;
                    state.scrap += 2; state.wood += 2;
                    updateUI(true); showMsg("ŁUP ZEBRANY!");
                }
            });
        });
    });
}

// --- AKCJE I UI ---
document.getElementById('btn-attack').onclick = () => {
    const pPos = player.getLatLng();
    zMarkers = zMarkers.filter(z => {
        if(map.distance(pPos, z.getLatLng()) < 35) {
            map.removeLayer(z);
            showMsg("ZABITO ZOMBI!");
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

// NOWE: CRAFTING
document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'block';
document.getElementById('btn-close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';
document.getElementById('btn-craft-food').onclick = () => {
    if (state.wood >= 3 && state.scrap >= 2) {
        state.wood -= 3; state.scrap -= 2; state.food++;
        updateUI(true); showMsg("GOTOWE! 🍎");
    } else showMsg("BRAK MATERIAŁÓW!");
};

// NOWE: BUDOWANIE BAZY
document.getElementById('btn-base').onclick = async () => {
    if (state.wood >= 10 && state.scrap >= 5) {
        const p = player.getLatLng();
        await addDoc(collection(db, "bases"), { lat: p.lat, lng: p.lng, owner: auth.currentUser.uid });
        state.wood -= 10; state.scrap -= 5;
        updateUI(true);
        L.marker([p.lat, p.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
        showMsg("BAZA POSTAWIONA!");
    } else showMsg("POTRZEBA 10🪵 I 5⚙️");
};

async function loadBases() {
    const s = await getDocs(collection(db, "bases"));
    s.forEach(d => {
        L.marker([d.data().lat, d.data().lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
    });
}

function updateUI(save = false) {
    document.getElementById('hp-bar').style.width = (state.hp * 10) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    if(save && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
    if(state.hp <= 0) { alert("KONIEC GRY!"); state.hp = 10; updateUI(true); location.reload(); }
}

function showMsg(t) {
    const m = document.getElementById("msg"); m.innerText = t; m.style.display = "block";
    setTimeout(() => m.style.display = "none", 2000);
}
