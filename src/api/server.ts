import express from 'express';
import fs from 'fs';
import path from 'path';
import { AppDataSource } from '../persistence/data-source';
import { INPCore } from '../core/inp-core';
import { Service } from '../core/types';
import { ServiceRepository } from '../persistence/repositories/ServiceRepository';
import { ExecutionRepository } from '../persistence/repositories/ExecutionRepository';

const app = express();
app.use(express.json());

let inpCore: INPCore;

// Initialize database and INP core
AppDataSource.initialize()
  .then(() => {
    console.log('✅ Database connected');
    inpCore = new INPCore();
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`🚀 INP Server running on port ${port}`));
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  });

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Web Dashboard & Official Portal
// Database connection status check
app.get('/api/db-status', (req, res) => {
  res.json({
    success: true,
    connected: AppDataSource.isInitialized,
    name: AppDataSource.options.database
  });
});

// Web Dashboard & Official Portal
app.get('/', (req, res) => {
  try {
    let htmlPath = path.join(__dirname, 'portal.html');
    if (!fs.existsSync(htmlPath)) {
      htmlPath = path.join(process.cwd(), 'src', 'api', 'portal.html');
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    res.send(html);
  } catch (err: any) {
    res.status(500).send('Error loading portal: ' + err.message);
  }
});

// Register a new service
app.post('/services/register', async (req, res) => {
  try {
    const service: Service = req.body;
    await inpCore.getRegistry().register(service);
    res.json({ success: true, message: 'Service registered' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Heartbeat to keep service alive
app.post('/services/heartbeat/:serviceId', async (req, res) => {
  try {
    await inpCore.getRegistry().heartbeat(req.params.serviceId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all active services
app.get('/services', async (req, res) => {
  const services = await inpCore.getRegistry().getAllServices();
  res.json({ services });
});

// Process an intent (natural language or DSL)
app.post('/api/intent', async (req, res) => {
  const { text, type, securityContext } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, error: 'Missing text' });
  }
  try {
    const core = new INPCore(undefined, securityContext);
    const result = await core.processIntent(text, type === 'natural');
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const serviceCount = await ServiceRepository.count({ where: { active: true } });
    const totalExecutions = await ExecutionRepository.count();
    const failedExecutions = await ExecutionRepository.count({ where: { status: 'FAILED' } });
    const completedExecutions = await ExecutionRepository.count({ where: { status: 'COMPLETED' } });
    
    const rawStats = await ExecutionRepository
      .createQueryBuilder('execution')
      .select('AVG(EXTRACT(EPOCH FROM (execution.completed_at - execution.started_at)) * 1000)', 'avgDuration')
      .where("execution.status = 'COMPLETED'")
      .getRawOne();
      
    res.json({
      success: true,
      stats: {
        activeServices: serviceCount,
        totalExecutions,
        failedExecutions,
        completedExecutions,
        avgDurationMs: Math.round(parseFloat(rawStats?.avgDuration || '0'))
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get recent executions list
app.get('/api/dashboard/executions', async (req, res) => {
  try {
    const executions = await ExecutionRepository.find({
      order: { startedAt: 'DESC' },
      take: 20
    });
    res.json({ success: true, executions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});