import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '@/config';
import { logger } from '@/shared/utils/logger.util';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.R2_ENDPOINT,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID || '',
    secretAccessKey: config.R2_SECRET_ACCESS_KEY || '',
  },
});

export const r2Service = {
  /**
   * Generate a presigned PutObject URL for direct upload to R2.
   *
   * @param key - Destination path in R2 (e.g. 'uploads/raw/filename.tif')
   * @param contentType - e.g. 'image/tiff'
   * @param expiresInSeconds - default 3600 (1 hour)
   */
  async getPresignedUploadUrl(key: string, contentType: string, expiresInSeconds = 3600) {
    try {
      const command = new PutObjectCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
      return url;
    } catch (err) {
      logger.error({ err, key }, 'Failed to generate R2 presigned upload URL');
      throw err;
    }
  },

  /**
   * Generate a presigned GetObject URL for temporary access to a file.
   */
  async getPresignedDownloadUrl(key: string, expiresInSeconds = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
      return url;
    } catch (err) {
      logger.error({ err, key }, 'Failed to generate R2 presigned download URL');
      throw err;
    }
  },

  /**
   * Returns the public URL if configured, otherwise the R2 s3-compatible URL.
   */
  getPublicUrl(key: string) {
    if (config.R2_PUBLIC_URL) {
      return `${config.R2_PUBLIC_URL.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
    }
    return `${config.R2_ENDPOINT}/${config.R2_BUCKET_NAME}/${key}`;
  },
};
