import { Request, Response } from 'express';
import { StatsService } from '../services/stats.service';

export class StatsController {
  static async getStats(_req: Request, res: Response) {
    try {
      const stats = await StatsService.getAppStats();
      return res.json(stats);
    } catch {
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }
}
