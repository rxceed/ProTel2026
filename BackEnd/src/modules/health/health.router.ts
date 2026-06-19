import { Router, Request, Response } from 'express';
import { pool } from '@/db/client';

export const healthRouter = Router();

/**
 * GET /health
 * Cek status server dan koneksi database
 * Dipakai Railway health check + monitoring
 */
healthRouter.get('/', async (_req: Request, res: Response) => {
  const start = Date.now();

  try {
    await pool.query('SELECT 1');
    const latency = Date.now() - start;

    res.status(200).json({
      status: 'ok',
      service: 'smart-awd-server1',
      version: process.env['npm_package_version'] ?? '1.0.0',
      environment: process.env['NODE_ENV'] ?? 'development',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      database: {
        status: 'connected',
        latency_ms: latency,
      },
    });
  } catch (err) {
    const latency = Date.now() - start;
    res.status(503).json({
      status: 'error',
      service: 'smart-awd-server1',
      timestamp: new Date().toISOString(),
      database: {
        status: 'disconnected',
        latency_ms: latency,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    });
  }
});
