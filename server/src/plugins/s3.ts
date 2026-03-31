import fp from 'fastify-plugin';
import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import type { FastifyInstance } from 'fastify';

/** Плагин подключения к S3-совместимому хранилищу */
async function s3Plugin(fastify: FastifyInstance): Promise<void> {
  let endpoint: string;
  let accessKeyId: string;
  let secretAccessKey: string;
  let bucket: string;

  if (config.storageProvider === 'cloudflare') {
    endpoint = config.r2Endpoint;
    accessKeyId = config.r2AccessKey;
    secretAccessKey = config.r2SecretKey;
    bucket = config.r2Bucket;
  } else {
    endpoint = config.s3Endpoint;
    accessKeyId = config.s3AccessKey;
    secretAccessKey = config.s3SecretKey;
    bucket = config.s3Bucket;
  }

  const region = config.storageProvider === 'cloudflare' ? 'auto' : config.s3Region;

  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
    maxAttempts: 10,
  });

  fastify.decorate('s3Client', client);
  fastify.decorate('s3Bucket', bucket);

  fastify.log.info(
    `S3 клиент инициализирован (провайдер: ${config.storageProvider})`
  );
}

export default fp(s3Plugin, {
  name: 's3',
});
