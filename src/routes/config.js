import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/config — obtener configuración (pública, usada por portal)
router.get('/', async (req, res) => {
  try {
    const config = await db('config_institucion').first();
    res.json(config || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config — actualizar configuración (solo admin)
router.put('/', authMiddleware, async (req, res) => {
  try {
    const { nombre, logo_url, color_primario, color_secundario, email_contacto, telefono_contacto, direccion } = req.body;
    await db('config_institucion').where({ id: 1 }).update({
      nombre, logo_url, color_primario, color_secundario,
      email_contacto, telefono_contacto, direccion,
      updated_at: new Date().toISOString(),
    });
    const config = await db('config_institucion').first();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
