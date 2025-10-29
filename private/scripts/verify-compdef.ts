import { Connection, PublicKey } from "@solana/web3.js";
import { getCompDefAccAddress, getCompDefAccOffset } from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");
const RPC_ENDPOINT = "https://api.devnet.solana.com";

async function main() {
  console.log(" VÉRIFICATION DES COMPUTATION DEFINITIONS\n");

  const connection = new Connection(RPC_ENDPOINT, "confirmed");

  const circuits = ["shield", "unshield_v2", "anonymous_transfer"];

  for (const circuitName of circuits) {
    console.log(``);
    console.log(` Circuit: ${circuitName}`);
    console.log(``);

    const offset = Buffer.from(getCompDefAccOffset(circuitName)).readUInt32LE(0);
    const compDefAddress = getCompDefAccAddress(PROGRAM_ID, offset);

    console.log(`Offset: ${offset}`);
    console.log(`CompDef Address: ${compDefAddress.toString()}\n`);

    const accountInfo = await connection.getAccountInfo(compDefAddress);

    if (!accountInfo) {
      console.log(" ERREUR: CompDef account n'existe PAS!\n");
      continue;
    }

    if (accountInfo.owner.toString() !== ARCIUM_PROGRAM_ID.toString()) {
      console.log(" ERREUR: CompDef account a le mauvais owner!");
      console.log(`   Expected: ${ARCIUM_PROGRAM_ID.toString()}`);
      console.log(`   Got: ${accountInfo.owner.toString()}\n`);
      continue;
    }

    if (accountInfo.data.length === 0) {
      console.log(" ERREUR: CompDef account est vide!\n");
      continue;
    }

    console.log(" CompDef correctement initialisé!");
    console.log(`   - Owner: ${accountInfo.owner.toString()}`);
    console.log(`   - Data length: ${accountInfo.data.length} bytes`);

    // Extraire l'URL du circuit (si OffChain)
    // Format: discriminator(8) + ... + circuit_source variant
    const data = accountInfo.data;

    // Essayer de trouver "https://" dans les données
    const dataStr = data.toString();
    const httpsIndex = dataStr.indexOf("https://");

    if (httpsIndex !== -1) {
      // Extraire l'URL (jusqu'au prochain null byte ou fin de string)
      let url = "";
      for (let i = httpsIndex; i < data.length; i++) {
        if (data[i] === 0) break;
        url += String.fromCharCode(data[i]);
      }
      console.log(`   - Circuit URL: ${url}`);
    }

  }

  console.log("\n");
}

main().catch(console.error);
