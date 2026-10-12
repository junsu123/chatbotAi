require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const db = new PrismaClient();
const u = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const connection = { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, maxRetriesPerRequest: null };
const queue = new Queue('messages', { connection });
module.exports = { db, queue, connection };
