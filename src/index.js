import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import representantesRoutes from './routes/representantes.js';
import inscritosRoutes from './routes/inscritos.js';
import categoriasRoutes from './routes/categorias.js';
import spidiRoutes from './routes/spidi.js';
import webhookRoutes from './routes/webhook.js';
import portalRoutes from './routes/portal.js';
import cargosRoutes from './routes/cargos.js';
import pagosRoutes from './routes/pagos.js';
import uploadsRoutes from './routes/uploads.js';
import configRoutes from './routes/config.js';
import dashboardRoutes from './routes/dashboard.js';
import reportesRoutes from './routes/reportes.js';
import { iniciarCronJobs } from './services/cronJobs.js';
import './database.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
}));

app.use(express.json());
app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/representantes', representantesRoutes);
app.use('/api/inscritos', inscritosRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/spidi', spidiRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/cargos', cargosRoutes);
app.use('/api/pagos', pagosRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reportes', reportesRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Iniciar cron jobs
iniciarCronJobs();

app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));
