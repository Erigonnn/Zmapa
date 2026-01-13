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

// Dodałem ekran śmierci do HTML dynamicznie, żebyś nie musiał edytować index.html
const deathScreen = document.createElement('div');
deathScreen.id = 'death-screen';
deathScreen.innerHTML = '💀 ZGINĄŁEŚ 💀<br><button onclick="location.reload()" style="font-size:1rem; padding:10px; margin-top:20px; color:black;">ODRODZENIE</button>';
document.body.appendChild(deathScreen);

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

    // ZMIANA: Strzałka zamiast kółka
    const playerIcon = L.divIcon({
        html: '<div id="p-arrow" style="transform: rotate(0deg);">➤</div>',
        className: 'player-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20] // Wyśrodkowanie obrotu
    });
    playerMarker = L.marker([52.2, 21.0], { icon: playerIcon }).addTo(map);

    // GPS + KOMPAS (HEADING)
    navigator.geolocation.watchPosition(pos => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        playerMarker.setLatLng(p);
        map.panTo(p);
        
        // Obracanie strzałki
        if(pos.coords.heading !== null) {
            const arrow = document.getElementById('p-arrow');
            if(arrow) arrow.style.transform = `rotate(${pos.coords.heading}deg)`;
        }

        if (loots.length < 5) spawnLoot(p);
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
    const lIcon = L.divIcon({ html: '📦', className: 'loot-marker', iconSize: [35, 35] });
    const l = L.marker([p[0]+off(), p[1]+off()], { icon: lIcon }).addTo(map);
    
    // ZMIANA: Losowy loot i informacje
    l.on('click', () => {
        if(map.distance(playerMarker.getLatLng(), l.getLatLng()) < 50) {
            const rand = Math.random();
            let msgText = "";
            
            if(rand < 0.5) {
                state.scrap += 15; msgText = "+15 Złomu ⚙️";
            } else if (rand < 0.8) {
                state.wood += 10; msgText = "+10 Drewna 🪵";
            } else {
                state.food += 1; msgText = "+1 Jedzenie 🍎";
            }
            
            updateUI(true); 
            map.removeLayer(l);
            msg("Zabrano: " + msgText);
        } else {
            msg("Podejdź bliżej! (Jesteś za daleko)");
        }
    });
    loots.push(l);
}

function gameLoop() {
    if (!playerMarker || !map) return;
    const pPos = playerMarker.getLatLng();

    if(zombies.length < 5) {
        const off = () => (Math.random() - 0.5) * 0.008;
        // ZMIANA: IconSize [50,50] żeby były duże
        const zIcon = L.divIcon({ html: '🧟', className: 'zombie-marker', iconSize: [50, 50] });
        const z = L.marker([pPos.lat+off(), pPos.lng+off()], { icon: zIcon }).addTo(map);
        zombies.push(z);
    }

    zombies.forEach(z => {
        const zPos = z.getLatLng();
        const dist = map.distance(zPos, pPos);
        
        // ZMIANA: Logika ruchu (Pościg vs Szwendanie)
        let newLat, newLng;
        const speed = 0.00006;

        if (dist < 120) {
            // Pościg (idzie prosto na gracza)
            newLat = zPos.lat + (pPos.lat > zPos.lat ? speed : -speed);
            newLng = zPos.lng + (pPos.lng > zPos.lng ? speed : -speed);
        } else {
            // Szwendanie (losowy ruch)
            newLat = zPos.lat + (Math.random() - 0.5) * speed;
            newLng = zPos.lng + (Math.random() - 0.5) * speed;
        }

        z.setLatLng([newLat, newLng]);

        // Atak
        if(dist < 15) { 
            state.hp -= 2; // Zwiększone obrażenia
            updateUI(); 
            navigator.vibrate(200); // Wibracja telefonu przy ataku!
            if(state.hp <= 0) handleDeath();
        }
    });
}

// ZMIANA: Funkcja Śmierci
function handleDeath() {
    state.hp = 0;
    updateUI(true);
    // Reset postaci
    state = { hp: 100, scrap: 0, wood: 0, food: 0, weapon: "PIĘŚCI", hasBase: false };
    // Zapisz reset do bazy
    if(auth.currentUser) updateDoc(doc(db, "users", auth.currentUser.uid), state);
    
    document.getElementById('death-screen').style.display = 'flex';
}

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

// ZMIANA: Ulepszona walka
document.getElementById('btn-attack').onclick = () => {
    const p = playerMarker.getLatLng();
    let hit = false;
    
    // Filtrujemy tablicę zombie
    zombies = zombies.filter(z => {
        const dist = map.distance(p, z.getLatLng());
        
        // Zwiększony zasięg do 60 metrów (łatwiej trafić)
        if(dist < 60) {
            map.removeLayer(z); // Usuń z mapy wizualnie
            state.scrap += 10;
            hit = true;
            return false; // Usuń z tablicy logicznej
        }
        return true; // Zostaw w tablicy
    });

    if(hit) {
        updateUI(true);
        msg("ELIMINACJA! +10⚙️");
        navigator.vibrate(100); // Wibracja przy trafieniu
    } else {
        msg("Brak celu w zasięgu (60m)!");
    }
};

document.getElementById('btn-eat').onclick = () => {
    if(state.food > 0 && state.hp < 100) {
        state.food--; state.hp = Math.min(100, state.hp + 20); 
        updateUI(true);
        msg("Zdrowie +20");
    } else if (state.food === 0) {
        msg("Brak jedzenia!");
    }
};
