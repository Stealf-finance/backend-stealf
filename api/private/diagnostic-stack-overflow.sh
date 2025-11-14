#!/bin/bash

# ============================================================================
# DIAGNOSTIC AVANCÉ : Stack Overflow Bug - Stealf Project
# ============================================================================
# Ce script diagnostique si le bug de stack overflow Arcium 0.3.0 est présent
# et identifie sa source exacte.
# ============================================================================

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     DIAGNOSTIC STACK OVERFLOW - STEALF PROJECT                 ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo ""

# ============================================================================
# 1. VÉRIFICATION ENVIRONNEMENT
# ============================================================================

echo -e "${BLUE}[1/8] Vérification de l'environnement...${NC}"

# Vérifier Rust
if ! command -v rustc &> /dev/null; then
    echo -e "${RED}❌ Rust n'est pas installé${NC}"
    exit 1
fi
RUST_VERSION=$(rustc --version)
echo -e "${GREEN}✅ Rust installé: ${RUST_VERSION}${NC}"

# Vérifier Solana
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI n'est pas installé${NC}"
    exit 1
fi
SOLANA_VERSION=$(solana --version)
echo -e "${GREEN}✅ Solana CLI installé: ${SOLANA_VERSION}${NC}"

# Vérifier Arcium
if ! command -v arcium &> /dev/null; then
    echo -e "${RED}❌ Arcium CLI n'est pas installé${NC}"
    exit 1
fi
ARCIUM_VERSION=$(arcium --version)
echo -e "${GREEN}✅ Arcium CLI installé: ${ARCIUM_VERSION}${NC}"

echo ""

# ============================================================================
# 2. ANALYSE DES DÉPENDANCES
# ============================================================================

echo -e "${BLUE}[2/8] Analyse des dépendances Arcium...${NC}"

if [ -f "programs/private/Cargo.toml" ]; then
    echo -e "${YELLOW}Fichier: programs/private/Cargo.toml${NC}"

    ARCIUM_ANCHOR=$(grep "arcium-anchor" programs/private/Cargo.toml || echo "Non trouvé")
    ARCIUM_CLIENT=$(grep "arcium-client" programs/private/Cargo.toml || echo "Non trouvé")

    echo "$ARCIUM_ANCHOR"
    echo "$ARCIUM_CLIENT"

    if echo "$ARCIUM_CLIENT" | grep -q "0.3.0"; then
        echo -e "${YELLOW}⚠️  arcium-client 0.3.0 détecté (version avec bug connu)${NC}"
        ARCIUM_VERSION_STATUS="0.3.0"
    else
        echo -e "${GREEN}✅ Version arcium-client différente de 0.3.0${NC}"
        ARCIUM_VERSION_STATUS="autre"
    fi
else
    echo -e "${RED}❌ Fichier Cargo.toml non trouvé${NC}"
fi

if [ -f "encrypted-ixs/Cargo.toml" ]; then
    echo -e "${YELLOW}Fichier: encrypted-ixs/Cargo.toml${NC}"
    ARCIS_IMPORTS=$(grep "arcis-imports" encrypted-ixs/Cargo.toml || echo "Non trouvé")
    echo "$ARCIS_IMPORTS"
fi

echo ""

# ============================================================================
# 3. RECHERCHE DE CallbackAccount
# ============================================================================

echo -e "${BLUE}[3/8] Recherche de l'import dangereux 'CallbackAccount'...${NC}"

CALLBACK_ACCOUNT_FOUND=0

if grep -r "use arcium_client::idl::arcium::types::CallbackAccount" programs/ 2>/dev/null; then
    echo -e "${RED}❌ DANGER: Import 'CallbackAccount' trouvé dans le code!${NC}"
    echo -e "${RED}   Ceci peut causer le stack overflow si utilisé dans callback_ix${NC}"
    CALLBACK_ACCOUNT_FOUND=1
else
    echo -e "${GREEN}✅ Aucun import 'CallbackAccount' trouvé${NC}"
fi

# Recherche alternative
if grep -r "CallbackAccount" programs/private/src/ 2>/dev/null | grep -v "^Binary" | grep -v ".md"; then
    echo -e "${YELLOW}⚠️  Mentions de 'CallbackAccount' trouvées (peut être dans commentaires)${NC}"
else
    echo -e "${GREEN}✅ Aucune mention de 'CallbackAccount' dans le code source${NC}"
fi

echo ""

# ============================================================================
# 4. ANALYSE DES APPELS queue_computation
# ============================================================================

echo -e "${BLUE}[4/8] Analyse des appels queue_computation...${NC}"

QUEUE_COMP_FILES=$(find programs/private/src -name "*.rs" -exec grep -l "queue_computation" {} \; 2>/dev/null || echo "")

if [ -z "$QUEUE_COMP_FILES" ]; then
    echo -e "${YELLOW}⚠️  Aucun appel queue_computation trouvé${NC}"
else
    for file in $QUEUE_COMP_FILES; do
        echo -e "${YELLOW}Fichier: $file${NC}"

        # Extraire le contexte autour de queue_computation
        grep -A 10 -B 5 "queue_computation" "$file" | while IFS= read -r line; do
            if echo "$line" | grep -q "CallbackAccount"; then
                echo -e "${RED}   ❌ DANGER: Utilise CallbackAccount dans queue_computation${NC}"
                echo -e "${RED}      $line${NC}"
            elif echo "$line" | grep -q "vec!\[\]"; then
                echo -e "${GREEN}   ✅ SAFE: Utilise vec![] (vide)${NC}"
                echo -e "      $line"
            elif echo "$line" | grep -q "callback_ix(&\[\])"; then
                echo -e "${GREEN}   ✅ SAFE: Utilise callback_ix(&[]) (vide)${NC}"
                echo -e "      $line"
            fi
        done
    done
fi

echo ""

# ============================================================================
# 5. VÉRIFICATION DU CIRCUIT ARCIS
# ============================================================================

echo -e "${BLUE}[5/8] Vérification du circuit Arcis...${NC}"

if [ -f "encrypted-ixs/src/lib.rs" ]; then
    echo -e "${YELLOW}Analyse de encrypted-ixs/src/lib.rs${NC}"

    # Vérifier le type de retour de l'instruction
    RETURN_TYPE=$(grep -A 2 "#\[instruction\]" encrypted-ixs/src/lib.rs | grep "pub fn" | grep -o "-> .*" || echo "Non trouvé")

    echo "Type de retour détecté: $RETURN_TYPE"

    if echo "$RETURN_TYPE" | grep -q "-> ()"; then
        echo -e "${GREEN}✅ Circuit retourne () (void) - Pas de callback nécessaire${NC}"
        echo -e "${GREEN}   Ceci évite complètement le bug CallbackAccount${NC}"
    elif echo "$RETURN_TYPE" | grep -q "Enc<"; then
        echo -e "${YELLOW}⚠️  Circuit retourne des données encryptées${NC}"
        echo -e "${YELLOW}   Un callback est nécessaire - Vérifier qu'il n'utilise pas CallbackAccount${NC}"
    fi
else
    echo -e "${RED}❌ Fichier encrypted-ixs/src/lib.rs non trouvé${NC}"
fi

echo ""

# ============================================================================
# 6. BUILD ET ANALYSE DES WARNINGS
# ============================================================================

echo -e "${BLUE}[6/8] Build du projet et capture des warnings...${NC}"

BUILD_OUTPUT=$(cargo build --release 2>&1 || true)

# Recherche du warning spécifique
if echo "$BUILD_OUTPUT" | grep -q "Stack offset of.*exceeded max offset"; then
    echo -e "${YELLOW}⚠️  WARNING de stack overflow détecté dans le build${NC}"
    echo ""
    echo "$BUILD_OUTPUT" | grep -A 3 "Stack offset"
    echo ""
    echo -e "${BLUE}ANALYSE:${NC}"
    echo -e "Ce warning indique que le SDK arcium-client 0.3.0 contient du code"
    echo -e "qui POURRAIT causer un stack overflow, MAIS:"
    echo -e "- Si votre code n'utilise pas CallbackAccount, c'est SANS DANGER"
    echo -e "- Le warning est émis par le compilateur qui détecte le code problématique"
    echo -e "- Tant que CallbackAccount n'est pas appelé, il n'y a pas d'overflow runtime"
else
    echo -e "${GREEN}✅ Aucun warning de stack overflow détecté${NC}"
fi

echo ""

# ============================================================================
# 7. VÉRIFICATION DU PROGRAMME DÉPLOYÉ (si connecté)
# ============================================================================

echo -e "${BLUE}[7/8] Vérification du programme déployé...${NC}"

PROGRAM_ID=$(grep "declare_id" programs/private/src/lib.rs | grep -o '"[^"]*"' | tr -d '"' || echo "Non trouvé")

if [ "$PROGRAM_ID" != "Non trouvé" ]; then
    echo -e "${YELLOW}Program ID détecté: ${PROGRAM_ID}${NC}"

    # Vérifier si on peut se connecter à devnet
    if solana program show "$PROGRAM_ID" --url devnet &>/dev/null; then
        echo -e "${GREEN}✅ Programme trouvé sur Devnet${NC}"

        PROGRAM_SIZE=$(solana program show "$PROGRAM_ID" --url devnet | grep "ProgramData Length" | awk '{print $3}')
        echo -e "   Taille: ${PROGRAM_SIZE} bytes"

        # Vérifier la date de déploiement
        LAST_DEPLOY=$(solana program show "$PROGRAM_ID" --url devnet | grep "Slot" | awk '{print $2}')
        echo -e "   Dernier déploiement: Slot ${LAST_DEPLOY}"

        # Comparer avec le build local
        LOCAL_SIZE=$(stat -f%z "target/deploy/private.so" 2>/dev/null || stat -c%s "target/deploy/private.so" 2>/dev/null || echo "0")

        if [ "$LOCAL_SIZE" != "0" ]; then
            echo -e "   Build local: ${LOCAL_SIZE} bytes"

            if [ "$PROGRAM_SIZE" = "$LOCAL_SIZE" ]; then
                echo -e "${GREEN}✅ Le programme déployé correspond au build local${NC}"
            else
                echo -e "${YELLOW}⚠️  ATTENTION: Taille différente entre déployé et local${NC}"
                echo -e "${YELLOW}   Le programme déployé pourrait être une ancienne version${NC}"
                echo -e "${YELLOW}   → Recommandation: Redéployer avec 'arcium deploy'${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}⚠️  Programme non trouvé sur Devnet ou non connecté${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Program ID non détecté dans le code${NC}"
fi

echo ""

# ============================================================================
# 8. RAPPORT FINAL
# ============================================================================

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    RAPPORT FINAL                               ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo ""

echo -e "${BLUE}Version Arcium:${NC}"
if [ "$ARCIUM_VERSION_STATUS" = "0.3.0" ]; then
    echo -e "  ${YELLOW}⚠️  arcium-client 0.3.0 (version avec bug connu)${NC}"
else
    echo -e "  ${GREEN}✅ Version différente de 0.3.0${NC}"
fi

echo ""
echo -e "${BLUE}Import CallbackAccount:${NC}"
if [ $CALLBACK_ACCOUNT_FOUND -eq 1 ]; then
    echo -e "  ${RED}❌ DANGER: CallbackAccount importé${NC}"
    echo -e "  ${RED}   → Risque élevé de stack overflow${NC}"
else
    echo -e "  ${GREEN}✅ CallbackAccount non importé${NC}"
fi

echo ""
echo -e "${BLUE}Pattern queue_computation:${NC}"
if grep -r "vec!\[\]" programs/private/src/*.rs 2>/dev/null | grep -q "queue_computation"; then
    echo -e "  ${GREEN}✅ Utilise vec![] (pattern safe)${NC}"
elif grep -r "callback_ix(&\[\])" programs/private/src/*.rs 2>/dev/null | grep -q "queue_computation"; then
    echo -e "  ${GREEN}✅ Utilise callback_ix(&[]) (pattern safe)${NC}"
else
    echo -e "  ${YELLOW}⚠️  Pattern non standard détecté${NC}"
fi

echo ""
echo -e "${BLUE}Circuit Arcis:${NC}"
if grep -q "-> ()" encrypted-ixs/src/lib.rs 2>/dev/null; then
    echo -e "  ${GREEN}✅ Retourne () - Pas de callback nécessaire${NC}"
    echo -e "  ${GREEN}   Design sûr qui évite complètement le bug${NC}"
else
    echo -e "  ${YELLOW}⚠️  Retourne des données - Callback nécessaire${NC}"
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    RECOMMANDATIONS                              ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo ""

if [ $CALLBACK_ACCOUNT_FOUND -eq 1 ]; then
    echo -e "${RED}🚨 ACTION IMMÉDIATE REQUISE:${NC}"
    echo -e "${RED}   1. Supprimer l'import CallbackAccount${NC}"
    echo -e "${RED}   2. Utiliser vec![] ou callback_ix(&[]) dans queue_computation${NC}"
    echo -e "${RED}   3. Rebuild avec: cargo build-sbf${NC}"
    echo -e "${RED}   4. Redéployer avec: arcium deploy${NC}"
else
    echo -e "${GREEN}✅ CODE SAFE - Aucune action immédiate requise${NC}"
    echo ""
    echo -e "${BLUE}Améliorations possibles:${NC}"
    echo -e "  1. Si warning persiste au build: C'est normal, le SDK contient le bug"
    echo -e "     mais il n'est pas déclenché par votre code"
    echo -e "  2. Si erreur runtime: Vérifier que le programme déployé est à jour"
    echo -e "  3. Pour upgrade futur: Attendre arcium-client 0.4.0+ (actuellement non disponible)"
fi

echo ""
echo -e "${BLUE}Commandes utiles:${NC}"
echo -e "  ${YELLOW}# Rebuild complet${NC}"
echo -e "  cd /home/louis/Images/Stealf/apps/api/private"
echo -e "  arcium build"
echo ""
echo -e "  ${YELLOW}# Redeploy sur devnet${NC}"
echo -e "  arcium deploy --cluster-offset 1078779259 \\"
echo -e "    --keypair-path ~/.config/solana/id.json \\"
echo -e "    --rpc-url https://devnet.helius-rpc.com/?api-key=VOTRE_CLE"
echo ""
echo -e "  ${YELLOW}# Tester sur localnet${NC}"
echo -e "  arcium test"
echo ""

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              DIAGNOSTIC TERMINÉ                                ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
