import { User } from '../models/User';
import { PointsLog, PointsAction } from '../models/PointsLog';

const POINTS_TABLE: Record<PointsAction, number> = {
  'private transfer': 2,
  'standard deposit': 2,
  'private deposit': 6,
  'yield withdrawal': 1,
  'daily bonus': 1,
};

const DAILY_BONUS_COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20h (évite les fuseaux horaires)

/**
 * Award points to a user for a given action.
 * Returns the number of points awarded (0 if daily_bonus already claimed today).
 */
export async function awardPoints(userId: string, action: PointsAction): Promise<number> {
  const user = await User.findById(userId);
  if (!user) return 0;

  // Daily bonus: once per 20h
  if (action === 'daily bonus') {
    if (user.lastDailyBonusAt) {
      const elapsed = Date.now() - user.lastDailyBonusAt.getTime();
      if (elapsed < DAILY_BONUS_COOLDOWN_MS) return 0;
    }
    user.lastDailyBonusAt = new Date();
  }

  const pts = POINTS_TABLE[action];
  user.points = (user.points || 0) + pts;
  await user.save();

  await PointsLog.create({
    userId: user._id,
    action,
    points: pts,
    totalAfter: user.points,
  });

  return pts;
}

/**
 * Get points balance and recent history for a user.
 */
export async function getPointsData(userId: string) {
  const user = await User.findById(userId).select('points').lean();
  const history = await PointsLog.find({ userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return {
    points: user?.points ?? 0,
    history: history.map((h) => ({
      action: h.action,
      points: h.points,
      totalAfter: h.totalAfter,
      createdAt: h.createdAt,
    })),
  };
}
