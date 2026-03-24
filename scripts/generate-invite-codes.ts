import mongoose from "mongoose";
import { randomBytes } from "crypto";
import dotenv from "dotenv";

dotenv.config();

const InviteCode = mongoose.model(
  "InviteCode",
  new mongoose.Schema({ code: { type: String, required: true, unique: true } })
);

async function main() {
  const count = parseInt(process.argv[2] || "10", 10);
  const prefix = process.argv[3] || "STEALF";

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(`${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`);
  }

  const result = await InviteCode.insertMany(
    codes.map((code) => ({ code })),
    { ordered: false }
  );

  console.log(`${result.length} codes inserted:`);
  codes.forEach((c) => console.log(`  ${c}`));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
