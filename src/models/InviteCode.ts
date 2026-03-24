import mongoose, { Schema } from "mongoose";

const inviteCodeSchema = new Schema({
  code: {
    type: String,
    required: true,
    unique: true,
  },
});

export const InviteCode = mongoose.model("InviteCode", inviteCodeSchema);
