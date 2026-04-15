import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error("MONGODB_URI not set in .env");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const collection = mongoose.connection.collection("invitecodes");
    const docs = await collection.find({ email: { $exists: true } }).toArray();

    console.log(`Found ${docs.length} invite codes with email`);

    const outputPath = path.join(__dirname, "beta-codes.csv");
    const lines = ["email,code"];
    for (const doc of docs) {
        const email = (doc.email as string).trim().toLowerCase();
        const code = (doc.code as string).trim();
        if (email && code) {
            lines.push(`${email},${code}`);
        }
    }

    fs.writeFileSync(outputPath, lines.join("\n") + "\n");
    console.log(`Exported ${lines.length - 1} entries to ${outputPath}`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
});
