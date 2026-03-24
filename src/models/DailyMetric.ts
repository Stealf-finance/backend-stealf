import mongoose, { Schema } from "mongoose";

const dailyMetricSchema = new Schema({
  date: {
    type: String, // "2026-03-24"
    required: true,
    unique: true,
  },
  inscriptions: {
    type: Number,
    default: 0,
  },
  logins: {
    type: Number,
    default: 0,
  },
});

export const DailyMetric = mongoose.model("DailyMetric", dailyMetricSchema);
