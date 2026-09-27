// script.js - Logique complète pour MICKE WiFi (Gestion MAC + Achat FedaPay + Récupération)

// --- FONCTION UTILITAIRE : Récupération de l'adresse MAC transmise par MikroTik ---
function getMacAddressFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    // MikroTik transmet généralement 'mac' ou 'mac-esc' dans l'URL du portail captif
    return urlParams.get('mac') || urlParams.get('mac-esc') || "SIMULATION_MAC_PC";
}

document.addEventListener('DOMContentLoaded', function() {

    // Capture de la MAC au chargement et affichage dans la console pour le debug
    const clientMac = getMacAddressFromUrl();
    console.log("🔒 Appareil identifié par son adresse MAC :", clientMac);

    // --- 1. GESTION DU BOUTON "RETROUVER MON TICKET" ---
    const btnRetrouver = document.getElementById('btn-retrouver');
    
    if (btnRetrouver) {
        btnRetrouver.addEventListener('click', function() {
            const phone = prompt("Entrez le numéro de téléphone Mobile Money utilisé lors de votre achat :");
            
            if (phone && phone.trim() !== "") {
                const cleanPhone = phone.trim();

                // 🧪 SIMULATION DE TEST LOCAL POUR LE NUMÉRO DEMANDÉ
                if (cleanPhone === "0166009787") {
                    alert(
                        "🎟️ [MODE TEST] Ticket retrouvé avec succès !\n\n" +
                        "📱 Numéro : 0166009787\n" +
                        "🏷️ Forfait : MICKE Express (5h / 1,5 Go)\n" +
                        "👤 Identifiant : MK-84920\n" +
                        "🔑 Mot de passe : 5912\n\n" +
                        "Vous pouvez maintenant copier ces identifiants pour vous connecter !"
                    );
                    return; 
                }

                // Requête vers le serveur backend pour les autres numéros
                fetch('/api/tickets/search?phone=' + encodeURIComponent(cleanPhone))
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            alert(`🎟️ Votre Ticket Actif :\n\n- Identifiant : ${data.username}\n- Mot de passe : ${data.password}\n- Forfait : ${data.forfait}`);
                        } else {
                            alert(data.message || "Aucun ticket actif trouvé pour ce numéro de téléphone.");
                        }
                    })
                    .catch(err => {
                        console.error("Erreur recherche ticket:", err);
                        alert("Erreur de communication avec le serveur lors de la recherche.");
                    });
            }
        });
    }

    // --- 2. GESTION DU FORMULAIRE DE CONNEXION AVEC TICKET (LIAISON MAC) ---
    const formConnexionTicket = document.getElementById('formConnexionTicket');
    
    if (formConnexionTicket) {
        formConnexionTicket.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const ticketCodeInput = document.getElementById('ticketCodeInput');
            const ticketCode = ticketCodeInput ? ticketCodeInput.value.trim() : "";
            
            if (!ticketCode) {
                alert("Veuillez entrer ou scanner un code de ticket valide.");
                return;
            }

            try {
                // Envoi du code ticket associé à l'adresse MAC de l'appareil au backend
                const response = await fetch('/api/login-ticket', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        username: ticketCode, 
                        mac: clientMac 
                    })
                });

                const data = await response.json();
                
                if (data.success) {
                    alert("✅ Connexion réussie ! Bon surf sur MICKE WiFi.");
                    // Redirection vers la page de validation MikroTik ou la cible finale
                    window.location.href = data.redirectUrl || "http://192.168.88.1/login";
                } else {
                    alert(data.message || "Code de ticket invalide ou déjà utilisé par un autre appareil.");
                }
            } catch (err) {
                console.error("Erreur de validation du ticket:", err);
                alert("Erreur de communication avec le serveur.");
            }
        });
    }

    // --- 3. GESTION DU FORMULAIRE D'ACHAT EN LIGNE (MOBILE MONEY / FEDAPAY) ---
    const formAchat = document.getElementById('formAchat');
    
    if (formAchat) {
        formAchat.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const select = document.getElementById('forfaitSelect');
            const selectedOption = select.options[select.selectedIndex];
            const forfaitKey = select.value;
            const packageName = selectedOption.text.split(' - ')[0];
            const price = parseInt(selectedOption.getAttribute('data-price'));
            const phone = document.getElementById('phoneInput').value;
            
            const btnPayer = document.getElementById('btnPayer');
            const loader = document.getElementById('loader');

            // Désactivation du bouton et affichage du loader
            btnPayer.disabled = true;
            btnPayer.classList.add('opacity-50', 'cursor-not-allowed');
            loader.classList.remove('hidden');

            try {
                const response = await fetch('/api/create-payment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        forfaitKey, 
                        packageName, 
                        price, 
                        phone, 
                        mac: clientMac // On peut aussi lier la MAC dès l'initiation du paiement si besoin
                    })
                });

                const data = await response.json();
                
                if (data.paymentUrl) {
                    // Redirection vers la page de paiement sécurisée FedaPay
                    window.location.href = data.paymentUrl;
                } else {
                    alert(data.error || "Une erreur est survenue lors de l'initialisation du paiement.");
                    btnPayer.disabled = false;
                    btnPayer.classList.remove('opacity-50', 'cursor-not-allowed');
                    loader.classList.add('hidden');
                }
            } catch (err) {
                console.error("Erreur serveur:", err);
                alert("Erreur de connexion au serveur.");
                btnPayer.disabled = false;
                btnPayer.classList.remove('opacity-50', 'cursor-not-allowed');
                loader.classList.add('hidden');
            }
        });
    }

});