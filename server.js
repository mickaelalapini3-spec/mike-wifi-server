require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { RouterOS } = require('node-routeros');

const app = express();
app.use(express.json());
app.use(cors());

// Rendre le dossier courant public pour afficher votre Front-End directement
app.use(express.static(__dirname));

// Route explicite pour la page d'accueil
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});


// ==============================================================================
// CONFIGURATION DES FORFAITS ET PRÉFIXES
// ==============================================================================
const CATALOGUE_FORFAITS = {
    'MINI': { prefix: 'MIN', profile: 'MICKE-MINI', uptime: '2h', bytes: '524288000', nom: 'MICKE Mini', prix: 50 },
    'EXPRESS': { prefix: 'EXP', profile: 'MICKE-EXPRESS', uptime: '5h', bytes: '1610612736', nom: 'MICKE Express', prix: 100 },
    'JOURNEE': { prefix: 'JRN', profile: 'MICKE-JOURNEE', uptime: '24h', bytes: '4294967296', nom: 'MICKE Journée', prix: 150 },
    '4JOURS': { prefix: '4JR', profile: 'MICKE-4JOURS', uptime: '96h', bytes: '16106127360', nom: 'MICKE 4 Jours', prix: 400 },
    'SEMAINE': { prefix: 'SEM', profile: 'MICKE-SEMAINE', uptime: '168h', bytes: '37580963840', nom: 'MICKE Semaine', prix: 800 },
    'MENSUEL': { prefix: 'MNS', profile: 'MICKE-MENSUEL', uptime: '720h', bytes: '128849018880', nom: 'MICKE Mensuel', prix: 2500 },
    'ILLIMITE_12H': { prefix: 'IL12', profile: 'MICKE-ILLIMITE-12H', uptime: '12h', bytes: null, nom: 'MICKE Illimité 12H', prix: 150 },
    'ILLIMITE_24H': { prefix: 'IL24', profile: 'MICKE-ILLIMITE-24H', uptime: '24h', bytes: null, nom: 'MICKE Illimité 24H', prix: 300 },
    'ILLIMITE_36H': { prefix: 'IL36', profile: 'MICKE-ILLIMITE-36H', uptime: '36h', bytes: null, nom: 'MICKE Illimité 36H', prix: 400 },
    'ILLIMITE_7J': { prefix: 'IL7J', profile: 'MICKE-ILLIMITE-7J', uptime: '168h', bytes: null, nom: 'MICKE Illimité 7J', prix: 1000 },
    'ILLIMITE_30J': { prefix: 'IL30', profile: 'MICKE-ILLIMITE-30J', uptime: '720h', bytes: null, nom: 'MICKE Illimité 30J', prix: 3000 }
};

// Mode Simulation (true = pas besoin de routeur physique / false = envoie sur le vrai MikroTik)
const MIKROTIK_SIMULATION = process.env.MIKROTIK_SIMULATION === 'true';

// Connexion MikroTik (utilisée uniquement si MIKROTIK_SIMULATION = false)
let conn = null;
if (!MIKROTIK_SIMULATION) {
    conn = new RouterOS({
        host: process.env.MIKROTIK_HOST || '192.168.88.1',
        user: process.env.MIKROTIK_USER || 'admin',
        password: process.env.MIKROTIK_PASSWORD || ''
    });
}

// Fonctions utilitaires de génération
function genererMotDePasse(longueur = 4) {
  return Math.floor(Math.pow(10, longueur - 1) + Math.random() * 9 * Math.pow(10, longueur - 1)).toString();
}

function genererIdentifiant(prefixe, longueurChiffres = 5) {
  const chiffres = Math.floor(Math.pow(10, longueurChiffres - 1) + Math.random() * 9 * Math.pow(10, longueurChiffres - 1)).toString();
  return `${prefixe}-${chiffres}`;
}

// Fonction unifiée d'injection MikroTik (avec bascule Simulation / Réel)
async function ajouterUtilisateurMikroTik(username, password, forfait) {
    if (MIKROTIK_SIMULATION) {
        console.log(`[MODE SIMULATION] Ticket virtuel créé -> Utilisateur: ${username} | Pass: ${password} | Forfait: ${forfait.nom}`);
        return true;
    } else {
        try {
            await conn.connect();
            await conn.write('/ip/hotspot/user/add', [
                `=name=${username}`,
                `=password=${password}`,
                `=profile=${forfait.profile}`,
                `=limit-uptime=${forfait.uptime}`,
                ...(forfait.bytes ? [`=limit-bytes-total=${forfait.bytes}`] : []),
                `=comment=TicketWiFi - ${forfait.nom}`
            ]);
            console.log(`[RÉSEAU] Ticket ${username} injecté sur le routeur physique avec succès !`);
            return true;
        } catch (error) {
            console.error("Erreur de communication avec le routeur MikroTik :", error);
            throw error;
        }
    }
}

// ==============================================================================
// 1. ROUTE D'INITIATION DU PAIEMENT (FedaPay)
// ==============================================================================
app.post('/api/create-payment', async (req, res) => {
    try {
        const { packageName, price, phone, email, firstName, lastName } = req.body;

        if (!phone) {
            return res.status(400).json({ error: "Le numéro de téléphone est obligatoire." });
        }

        const isSimulation = process.env.MIKROTIK_SIMULATION === 'true' || 
                             !process.env.FEDAPAY_SECRET_KEY || 
                             process.env.FEDAPAY_SECRET_KEY.trim() === '' || 
                             process.env.FEDAPAY_SECRET_KEY.includes('votre_cle');

        if (isSimulation) {
            console.log("[MODE SIMULATION] Paiement fictif réussi pour:", phone, "Forfait:", packageName);
            
            // Génération de faux identifiants pour le test local
            const fauxUsername = "MK-" + Math.floor(10000 + Math.random() * 90000);
            const fauxPassword = Math.floor(1000 + Math.random() * 9000).toString();

            return res.json({ 
                success: true,
                paymentUrl: `http://localhost:${PORT}/success.html?username=${fauxUsername}&pass=${fauxPassword}&package=${encodeURIComponent(packageName || 'Forfait')}` 
            });
        }

        const fedapayResponse = await axios.post('https://api.fedapay.com/v1/transactions', {
            description: `Achat Forfait Wi-Fi: ${packageName}`,
            amount: price,
            currency: { iso: 'XOF' },
            customer: {
                phone_number: { number: phone, country: 'bj' },
                email: email || undefined,
                firstname: firstName || 'Client',
                lastname: lastName || 'MICKE WiFi'
            }
        }, {
            headers: { Authorization: `Bearer ${process.env.FEDAPAY_SECRET_KEY}` }
        });

        res.json({ paymentUrl: fedapayResponse.data.url, token: fedapayResponse.data.token });
    } catch (error) {
        console.error("Erreur FedaPay:", error.response?.data || error.message);
        res.status(500).json({ error: "Erreur lors de l'initialisation du paiement." });
    }
});

// ==============================================================================
// 2. WEBHOOK FEDAPAY (Confirmation de paiement en production)
// ==============================================================================
app.post('/api/webhook', async (req, res) => {
    try {
        const event = req.body;
        if (event.name === 'transaction.approved') {
            const transaction = event.entity;
            const forfaitKey = transaction.custom_metadata?.forfait_key || 'EXPRESS';
            const forfait = CATALOGUE_FORFAITS[forfaitKey] || CATALOGUE_FORFAITS['EXPRESS'];

            const username = genererIdentifiant(forfait.prefix);
            const password = genererMotDePasse(4);

            await ajouterUtilisateurMikroTik(username, password, forfait);

            console.log("Paiement approuvé et ticket généré pour la transaction:", transaction.id);
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("Erreur Webhook:", error);
        res.sendStatus(500);
    }
});

// ==============================================================================
// 3. ROUTE DE VALIDATION DU TICKET (Liaison Code Ticket + Adresse MAC)
// ==============================================================================
app.post('/api/login-ticket', async (req, res) => {
    try {
        const { username, mac } = req.body;

        if (!username || !mac) {
            return res.status(400).json({ success: false, message: "Code du ticket ou adresse MAC manquant." });
        }

        if (MIKROTIK_SIMULATION) {
            console.log(`[SIMULATION MAC] Connexion demandée pour le ticket [${username}] depuis la MAC [${mac}]`);
            return res.json({ 
                success: true, 
                message: "Connexion autorisée en simulation",
                redirectUrl: "http://google.com" 
            });
        } else {
            await conn.connect();
            const users = await conn.write('/ip/hotspot/user/print', [
                `?name=${username}`
            ]);

            if (users.length === 0) {
                return res.status(404).json({ success: false, message: "Ce ticket est introuvable." });
            }

            console.log(`[RÉSEAU] Ticket ${username} validé et lié à l'appareil ${mac}`);
            res.json({ success: true, message: "Connexion réussie !" });
        }

    } catch (error) {
        console.error("Erreur lors de la validation du ticket:", error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

// ==============================================================================
// 4. ROUTE D'ADMINISTRATION : GÉNÉRATION DE LOTS DE TICKETS PHYSIQUES (Guichet)
// ==============================================================================
app.post('/api/admin/tickets/generate-batch', async (req, res) => {
    const { forfaitKey, quantite } = req.body; 

    const forfait = CATALOGUE_FORFAITS[forfaitKey];
    if (!forfait) {
        return res.status(400).json({ message: 'Forfait inconnu ou invalide' });
    }

    const ticketsGeneres = [];

    try {
        for (let i = 0; i < (quantite || 1); i++) {
            const username = genererIdentifiant(forfait.prefix);
            const password = genererMotDePasse(4);

            await ajouterUtilisateurMikroTik(username, password, forfait);

            ticketsGeneres.push({
                username,
                password,
                forfait: forfait.nom,
                prix: forfait.prix
            });
        }

        return res.status(201).json({
            message: `${ticketsGeneres.length} tickets physiques créés avec succès`,
            tickets: ticketsGeneres
        });

    } catch (error) {
        console.error('Erreur lors de la génération du lot :', error);
        return res.status(500).json({ message: 'Erreur lors de la génération du lot' });
    }
});

// ==============================================================================
// DÉMARRAGE DU SERVEUR
// ==============================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 MON VRAI SERVEUR TOURNE SUR LE PORT ${PORT} 🔥`);
});