import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, collection, addDoc, onSnapshot, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let map, playerMarker, rangeCircle;
let zMarkers = [];
let existingBases = {};

// --- LOGOWANIE (POPRAWIONE NA REDIRECT) ---
document.getElementById('google-btn').onclick = () => signInWithRedirect(auth, provider);

getRedirectResult(auth).then((result) => {
    if (result) console.log("Zalogowano pomyślnie z Google");
}).catch(err => alert("Błąd Google: " + err.code));

document.getElementById('login-btn').onclick = () => {
    const e = document.getElementById('email').value, p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, e, p).catch(err => alert(err.message));
};
document.getElementById('logout-btn').onclick = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async user => {
    if (user) {
        const s = await getDoc(doc(db, "users", user.uid));
        if (s.exists()) state = { ...state, ...s.data() };
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        initGame();
        listenToBases();
        updateUI();
    }
});

// --- MECHANIKA MAPY ---
function initGame() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    playerMarker = L.marker([0, 0], { 
        icon: L.divIcon({ className: 'player-arrow', html: '', iconSize: [20, 20], iconAnchor: [10, 10] }) 
    }).addTo(map);

    rangeCircle = L.circle([0, 0], { radius: 45, color: '#00f2ff', fillOpacity: 0.1 }).addTo(map);

    // OBRÓT STRZAŁKI
    window.addEventListener('deviceorientationabsolute', (e) => {
        let heading = e.webkitCompassHeading || (360 - e.alpha);
        if (heading) {
            const el = playerMarker.getElement();
            if (el) el.style.transform = `rotate(${heading}deg)`;
        }
    }, true);

    // GPS + AUTO-LOOT
    navigator.geolocation.watchPosition(pos => {
        const newPos = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(newPos);
        rangeCircle.setLatLng(newPos);
        map.panTo(newPos);
        
        // Co 50 metrów generuj zombie
        if (zMarkers.length < 4) spawnZombie(newPos);
    }, null, { enableHighAccuracy: true });

    setInterval(gameLoop, 1000);
}

// --- GWARANTOWANY LOOT ---
function spawnLootArea(pos) {
    for(let i=0; i<6; i++) {
        const latOff = (Math.random() - 0.5) * 0.002;
        const lngOff = (Math.random() - 0.5) * 0.002;
        const id = `loot_${Date.now()}_${i}`;
        
        const m = L.marker([pos[0] + latOff, pos[1] + lngOff], {
            icon: L.divIcon({ html: '📦', className: 'loot-icon' })
        }).addTo(map);

        m.on('click', () => {
            if (map.distance(playerMarker.getLatLng(), m.getLatLng()) < 45) {
                map.removeLayer(m);
                state.scrap += 2; state.wood += 2;
                showMsg("ZEBRANO ZASYBY (+2⚙️ +2🪵)");
                updateUI(true);
            } else showMsg("POZA ZASIĘGIEM!");
        });
    }
}

document.getElementById('btn-scan').onclick = () => {
    const p = playerMarker.getLatLng();
    spawnLootArea([p.lat, p.lng]);
    showMsg("SKANOWANIE ZAKOŃCZONE...");
};

// --- WALKA I ZOMBIE ---
function spawnZombie(center) {
    const lat = center[0] + (Math.random()-0.5)*0.01;
    const lng = center[1] + (Math.random()-0.5)*0.01;
    const z = L.marker([lat, lng], { icon: L.divIcon({ html: '🧟', className: 'zombie-icon' }) }).addTo(map);
    zMarkers.push(z);
}

function gameLoop() {
    if(!playerMarker) return;
    const pPos = playerMarker.getLatLng();
    zMarkers.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        if(dist < 50) {
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? 0.0001 : -0.0001), zPos.lng + (pPos.lng > zPos.lng ? 0.0001 : -0.0001)]);
            if(dist < 10) { state.hp -= 0.2; updateUI(); }
        }
    });
}

document.getElementById('btn-attack').onclick = () => {
    const pPos = playerMarker.getLatLng();
    zMarkers = zMarkers.filter(z => {
        if(map.distance(pPos, z.getLatLng()) < 45) {
            map.removeLayer(z); state.scrap += 3;
            showMsg("ZOMBIE ZNEUTRALIZOWANY (+3⚙️)");
            updateUI(true); return false;
        }
        return true;
    });
};

// --- BAZA I CRAFT ---
document.getElementById('btn-base').onclick = async () => {
    if(state.wood >= 10 && state.scrap >= 5) {
        const p = playerMarker.getLatLng();
        await addDoc(collection(db, "bases"), { lat: p.lat, lng: p.lng, owner: auth.currentUser.uid });
        state.wood -= 10; state.scrap -= 5;
        showMsg("BAZA POSTAWIONA");
        updateUI(true);
    } else showMsg("ZA MAŁO MATERIAŁÓW");
};

function listenToBases() {
    onSnapshot(collection(db, "bases"), snap => {
        map.eachLayer(l => { if(l.options && l.options.className === 'base-icon') map.removeLayer(l); });
        snap.forEach(d => {
            const b = d.data();
            L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon' }) }).addTo(map);
        });
    });
}

document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'flex';
document.getElementById('btn-close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';
document.getElementById('btn-craft-food').onclick = () => {
    if(state.wood >= 3 && state.scrap >= 2) {
        state.wood -= 3; state.scrap -= 2; state.food++;
        updateUI(true); showMsg("WYPRODUKOWANO RACJĘ");
    }
};
document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0) { state.food--; state.hp = Math.min(10, state.hp + 5); updateUI(true); }
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
    setTimeout(() => m.style.display = "none", 2500);
}
