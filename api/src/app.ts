import express, { type Express } from 'express';
import { healthRouter } from './health.js';

// Separated from index.ts so tests can import the app without binding a
// port.
export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  return app;
}
