import { Router } from 'express';
import { upload, getFileUrl } from '../services/upload.js';
import { authMiddleware } from '../middleware/auth.js';
import { repAuthMiddleware } from './portal.js';
import db from '../database.js';

const router = Router();

// POST /api/uploads/:tipo — subir archivo (admin o representante)
router.post('/:tipo', async (req, res, next) => {
  // Acepta token de admin o de representante
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  next();
}, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const { tipo } = req.params;
    const { entity_type, entity_id } = req.body;

    const url = getFileUrl(tipo, req.file.filename);

    // Registrar en BD
    await db('uploads').insert({
      filename: req.file.filename,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size: req.file.size,
      entity_type: entity_type || tipo,
      entity_id: entity_id ? parseInt(entity_id) : null,
    });

    // Actualizar avatar si aplica
    if (entity_type === 'representante' && entity_id) {
      await db('representantes').where({ id: entity_id }).update({ avatar_url: url });
    }
    if (entity_type === 'inscrito' && entity_id) {
      await db('inscritos').where({ id: entity_id }).update({ avatar_url: url });
    }

    res.json({ ok: true, url, filename: req.file.filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
