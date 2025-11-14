import { Connection, PublicKey } from "@solana/web3.js";
import { getArciumProgAddress } from "@arcium-hq/client";

async function decodeMXE() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const arciumProgram = getArciumProgAddress();

  const mxeAddresses = [
    { name: "MXE #1 (le plus récent)", address: "2yHKcbiDYcnojrSnirxbQV7Qa45yJxDBimWkN1DfR5Rg" },
    { name: "MXE #2 (du bug report)", address: "8XnK5aqohnwfHdWE3qXRQrjP9bbpHqVf3ioNTjup8qaA" },
    { name: "MXE #3 (celui en conflit)", address: "DfjfjMjKiWTLqcZoDfHSw8qPRJfe248gpPx1DNwSqL4Y" },
    { name: "Notre MXE actuel", address: "HDsPydwVCWJNWmzgVyETHh5N7KcYPSAUwkRyEkqanHWR" },
  ];

  console.log("=== Décodage des MXE accounts ===\n");

  for (const mxe of mxeAddresses) {
    console.log(`${mxe.name}:`);
    console.log(`  Address: ${mxe.address}`);

    const accountInfo = await connection.getAccountInfo(new PublicKey(mxe.address));

    if (!accountInfo) {
      console.log("  Status: ❌ N'existe pas\n");
      continue;
    }

    console.log("  Status: ✅ Existe");
    console.log("  Data length:", accountInfo.data.length);
    console.log("  Lamports:", accountInfo.lamports);

    // The MXE account structure starts with discriminator (8 bytes)
    // followed by the program_id (32 bytes)
    if (accountInfo.data.length >= 40) {
      const discriminator = accountInfo.data.slice(0, 8);
      const programIdBytes = accountInfo.data.slice(8, 40);
      const programId = new PublicKey(programIdBytes);

      console.log("  Discriminator:", Buffer.from(discriminator).toString('hex'));
      console.log("  Associated Program ID:", programId.toString());

      // Check if this program still exists
      const programInfo = await connection.getAccountInfo(programId);
      if (programInfo) {
        console.log("  Program Status: ✅ Program exists");
        console.log("  Program Owner:", programInfo.owner.toString());
      } else {
        console.log("  Program Status: ❌ Program doesn't exist (peut être réutilisé!)");
      }
    }
    console.log("");
  }

  console.log("\n=== Notre programme actuel ===");
  console.log("Program ID: J6u7JTUKZKZyp4XifbUgU1BsPRHB3bNszzvn8BLWTLfR");
  console.log("MXE attendu: HDsPydwVCWJNWmzgVyETHh5N7KcYPSAUwkRyEkqanHWR");
}

decodeMXE()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
