import pino from 'pino';

// Logger dibuat sebelum config agar bisa dipakai di config/index.ts jika perlu
// Menggunakan pino-pretty hanya di development untuk readability
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(process.env['NODE_ENV'] !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
      },
    },
  }),
});
