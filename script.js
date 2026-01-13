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

let state = { hp: 100, scrap: 50, wood: 20, food: 1, weapon: "PIĘŚCI", hasBase: false };
let map, playerMarker;
let zombies = [], loots = [];

setPersistence(auth, browserLocalPersistence);

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const docRef = doc(db, "users", user.uid);
        const snap = await getDoc(docRef);
        if (snap.exists()) state = { ...state, ...snap.data() };
        else await setDoc(docRef, state);

        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        if (!map) initGame();
        updateUI();
    }
});

function initGame() {
    map = L.map('map', { zoomControl: false }).setView([52.2, 21.0], 18);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

    playerMarker = L.circleMarker([52.2, 21.0], { color: '#00e5ff', radius: 10, fillOpacity: 0.9 }).addTo(map);

    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
        if (loots.length < 5) spawnLoot(p); // Zmniejszyłem limit dla płynności
    }, null, { enableHighAccuracy: true });

    onSnapshot(collection(db, "global_bases"), (snap) => {
        snap.forEach(d => {
            const b = d.data();
            L.marker([b.lat, b.lng], { icon: L.divIcon({ html: '🏠', className: 'base-icon', iconSize: [40,40] }) }).addTo(map);
        });
    });

    setInterval(gameLoop, 1000);
}

function spawnLoot(p) {
    const off = () => (Math.random() - 0.5) * 0.006;
    // POPRAWKA: className zgodna z CSS
    const lIcon = L.divIcon({ html: '📦', className: 'loot-marker', iconSize: [30, 30] });
    const l = L.marker([p[0]+off(), p[1]+off()], { icon: lIcon }).addTo(map);
    
    l.on('click', () => {
        if(map.distance(playerMarker.getLatLng(), l.getLatLng()) < 40) {
            state.scrap += 15; 
            updateUI(true); 
            map.removeLayer(l);
            msg("Zabrano złom! +15⚙️");
        } else {
            msg("Za daleko!");
        }
    });
    loots.push(l);
}

function gameLoop() {
    if (!playerMarker || !map) return;
    const pPos = playerMarker.getLatLng();

    if(zombies.length < 5) {
        const off = () => (Math.random() - 0.5) * 0.008;
        // POPRAWKA: className zgodna z CSS
        const zIcon = L.divIcon({ html: '🧟', className: 'zombie-marker', iconSize: [35, 35] });
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { icon: zIcon }).addTo(map);
        zombies.push(z);
    }

    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const d = map.distance(zPos, pPos);
        if(d < 100) {
            const s = 0.00007;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? s : -s), zPos.lng + (pPos.lng > zPos.lng ? s : -s)]);
            if(d < 15) { 
                state.hp -= 1; 
                updateUI(); 
                if(state.hp <= 0) msg("ZGINĄŁEŚ!");
            }
        }
    });
}

// Funkcja pomocnicza do komunikatów (toast)
function msg(m) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = m;
    document.body.appendChild(t);
    t.style.display = 'block';
    setTimeout(() => t.remove(), 2000);
}

window.toggleModal = (id) => {
    const m = document.getElementById('modal-' + id);
    if(m) m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
};

window.doCraft = async (type, cost) => {
    if (type === 'weapon' && state.scrap >= cost) {
        state.scrap -= cost; state.weapon = "NÓŻ MYŚLIWSKI";
        msg("Wytworzono: Nóż");
    } else if (type === 'base' && state.wood >= cost && !state.hasBase) {
        state.wood -= cost; state.hasBase = true;
        const p = playerMarker.getLatLng();
        await setDoc(doc(db, "global_bases", auth.currentUser.uid), { lat: p.lat, lng: p.lng, owner: auth.currentUser.displayName });
        msg("Baza postawiona!");
    } else {
        msg("Brak surowców!");
    }
    updateUI(true);
    toggleModal('craft');
};

function updateUI(cloud = false) {
    document.getElementById('hp-fill').style.width = Math.max(0, state.hp) + "%";
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    document.getElementById('s-weapon').innerText = state.weapon;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

document.getElementById('btn-attack').onclick = () => {
    const p = playerMarker.getLatLng();
    let hit = false;
    zombies = zombies.filter(z => {
        if(map.distance(p, z.getLatLng()) < 40) {
            map.removeLayer(z); // USUNIĘCIE Z MAPY
            state.scrap += 10;
            hit = true;
            return false;
        }
        return true;
    });
    if(hit) {
        updateUI(true);
        msg("Zombie zabite! +10⚙️");
    } else {
        msg("Brak celu w zasięgu!");
    }
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0 && state.hp < 100) {
        state.food--; state.hp = Math.min(100, state.hp + 20); 
        updateUI(true);
        msg("Zdrowie +20");
    }
};
