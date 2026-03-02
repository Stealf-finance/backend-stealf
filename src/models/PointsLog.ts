import mongoose, { Document, Schema } from 'mongoose';

export type PointsAction =
  | 'private transfer'
  | 'standard deposit'
  | 'private deposit'
  | 'yield withdrawal'
  | 'daily bonus';

export interface IPointsLog extends Document {
  userId: mongoose.Types.ObjectId;
  action: PointsAction;
  points: number;
  totalAfter: number;
  createdAt: Date;
}

const pointsLogSchema = new Schema<IPointsLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: {
      type: String,
      enum: ['private transfer', 'standard deposit', 'private deposit', 'yield withdrawal', 'daily bonus'],
      required: true,
    },
    points: { type: Number, required: true },
    totalAfter: { type: Number, required: true },
  },
  { timestamps: true },
);

export const PointsLog = mongoose.model<IPointsLog>('PointsLog', pointsLogSchema);
