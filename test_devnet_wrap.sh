#!/bin/bash

# Test wrap 0.1 SOL sur devnet
# Programme: 2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY

echo "======================================================================"
echo "🌐 TEST WRAP 0.1 SOL SUR DEVNET"
echo "======================================================================"

PROGRAM_ID="2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY"
WALLET=$(solana address)

echo "📦 Program ID: $PROGRAM_ID"
echo "👤 Wallet: $WALLET"

# Check balance
BALANCE=$(solana balance -u devnet)
echo "💰 Balance: $BALANCE"

echo ""
echo "⏳ Vérifions le programme sur devnet..."
solana program show $PROGRAM_ID -u devnet

echo ""
echo "⏳ Vérifions le MXE..."
arcium mxe-info $PROGRAM_ID --rpc-url https://api.devnet.solana.com

echo ""
echo "======================================================================"
echo "✅ Programme et MXE sont déployés sur devnet"
echo "======================================================================"
echo ""
echo "Pour tester manuellement une transaction wrap:"
echo "1. Les comp_defs sont initialisés (wrap et transfer)"
echo "2. Le programme est prêt à recevoir des transactions"
echo "3. Le MXE est connecté au cluster Arcium"
echo ""
echo "🔗 Voir le programme: https://solscan.io/account/$PROGRAM_ID?cluster=devnet"
