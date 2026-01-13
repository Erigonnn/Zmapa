import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

let state = { hp: 100, scrap: 20, wood: 20, food: 2, weapon: "PIĘŚCI", hasBase: false };
let map, playerMarker, lastPos = null;
let zombies = [], lootMarkers = [], baseMarkers = {};

// --- NAPRAWA LOGOWANIA ---
document.getElementById('google-btn').onclick = () => signInWithRedirect(auth, provider);

// To wyłapuje powrót z Google i loguje Cię na mapę
getRedirectResult(auth).then((result) => {
    if (result) console.log("Zalogowano pomyślnie");
}).catch(e => console.error("Błąd logowania:", e));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const uDoc = await getDoc(doc(db, "users", user.uid));
        if (uDoc.exists()) state = { ...state, ...uDoc.data() };
        else await setDoc(doc(db, "users", user.uid), state);

        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        if (!map) initMap();
    }
});

function initMap() {
    map = L.map('map', { zoomControl: false }).setView([52.2, 21.0], 18);
    // JASNA MAPA (CartoDB Light)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

    const arrowIcon = L.divIcon({ 
        className: 'player-arrow-container', 
        html: '<div id="p-arrow" style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:20px solid #007bff;"></div>',
        iconSize: [20, 20] 
    });
    playerMarker = L.marker([52.2, 21.0], { icon: arrowIcon }).addTo(map);

    // OBRÓT I GPS
    window.addEventListener('deviceorientationabsolute', (e) => {
        let heading = e.webkitCompassHeading || (360 - e.alpha);
        const el = document.getElementById('p-arrow');
        if (el && heading) el.style.transform = `rotate(${heading}deg)`;
    }, true);

    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
        if (!lastPos || map.distance(p, lastPos) > 40) {
            lastPos = p;
            refreshLoot(p);
        }
    }, null, { enableHighAccuracy: true });

    // POBIERANIE BAZ INNYCH GRACZY
    onSnapshot(collection(db, "bases"), (snap) => {
        snap.forEach(d => {
            if (!baseMarkers[d.id]) {
                const b = d.data();
                baseMarkers[d.id] = L.marker([b.lat, b.lng], { 
                    icon: L.divIcon({ html: '🏠', className: 'base-icon' }) 
                }).addTo(map).bindPopup(`Baza gracza: ${b.owner || 'Ocalały'}`);
            }
        });
    });

    setInterval(gameLoop, 1000);
}

function refreshLoot(p) {
    lootMarkers.forEach(m => map.removeLayer(m));
    lootMarkers = [];
    for(let i=0; i<15; i++) { // Max 15 skrzynek
        const off = () => (Math.random() - 0.5) * 0.006;
        const l = L.marker([p[0]+off(), p[1]+off()], { icon: L.divIcon({ html: '📦', className: 'loot' }) }).addTo(map);
        l.on('click', () => {
            if(map.distance(playerMarker.getLatLng(), l.getLatLng()) < 40) {
                state.scrap += 10; updateUI(true); map.removeLayer(l);
                showToast("Zabrano złom! +10⚙️");
            }
        });
        lootMarkers.push(l);
    }
}

function gameLoop() {
    if (!playerMarker) return;
    const pPos = playerMarker.getLatLng();
    
    // Prosta logika Zombie (Szwendanie + Atak)
    if(zombies.length < 4) {
        const off = () => (Math.random() - 0.5) * 0.008;
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { icon: L.divIcon({ html: '🧟' }) }).addTo(map);
        zombies.push(z);
    }

    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const d = map.distance(zPos, pPos);
        if(d < 100) { // Atakuje
            const s = 0.00008;
            z.setLatLng([zPos.lat + (pPos.lat > zPos.lat ? s : -s), zPos.lng + (pPos.lng > zPos.lng ? s : -s)]);
            if(d < 12) { state.hp -= 1; updateUI(); }
        } else { // Szwenda się
            z.setLatLng([zPos.lat + (Math.random()-0.5)*0.0001, zPos.lng + (Math.random()-0.5)*0.0001]);
        }
    });
}

window.doCraft = async (type) => {
    if(type === 'weapon' && state.scrap >= 30) {
        state.scrap -= 30; state.weapon = "NÓŻ MYŚLIWSKI";
        showToast("Wytworzono Nóż!");
    } else if(type === 'base' && state.wood >= 100 && !state.hasBase) {
        state.wood -= 100; state.hasBase = true;
        const p = playerMarker.getLatLng();
        await setDoc(doc(db, "bases", auth.currentUser.uid), { lat: p.lat, lng: p.lng, owner: auth.currentUser.displayName });
        showToast("Baza postawiona!");
    }
    updateUI(true);
};

function updateUI(cloud = false) {
    document.getElementById('hp-bar-inner').style.width = state.hp + "%";
    document.getElementById('hp-text').innerText = Math.floor(state.hp);
    document.getElementById('s-scrap').innerText = state.scrap;
    document.getElementById('s-wood').innerText = state.wood;
    document.getElementById('s-food').innerText = state.food;
    document.getElementById('active-item').innerText = state.weapon;
    if(cloud && auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
}

document.getElementById('btn-attack').onclick = () => {
    const p = playerMarker.getLatLng();
    zombies = zombies.filter(z => {
        if(map.distance(p, z.getLatLng()) < 40) {
            map.removeLayer(z); state.scrap += 5; updateUI(true);
            showToast("Zabito zombie! +5⚙️"); return false;
        }
        return true;
    });
};

document.getElementById('btn-craft').onclick = () => document.getElementById('craft-modal').style.display = 'flex';
document.getElementById('close-craft').onclick = () => document.getElementById('craft-modal').style.display = 'none';
function showToast(m) { const t = document.getElementById('toast'); t.innerText = m; t.style.display='block'; setTimeout(()=>t.style.display='none', 2000); }
