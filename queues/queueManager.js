import { Queue } from 'bullmq';
import { redisConnection } from './redis.js';

export const queues = {

  react: new Queue('react-evaluation', {
    connection: redisConnection
  }),

  backend: new Queue('backend-evaluation', {
    connection: redisConnection
  }),

  visual: new Queue('visual-evaluation', {
    connection: redisConnection
  }),

  javascript: new Queue('javascript-evaluation', {
    connection: redisConnection
  }),

  python: new Queue('python-evaluation', {
    connection: redisConnection
  }),

  fullstack: new Queue('fullstack-evaluation', {
    connection: redisConnection
  })
};