import { Request, Response } from 'express';
import { getPointsData } from '../services/points.service';

export class PointsController {
  static async getPoints(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const data = await getPointsData(userId);
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch points' });
    }
  }
}
