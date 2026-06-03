import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const data = await db('categorias').orderBy('nombre');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { nombre, descripcion, monto_usd } = req.body;
    if (!nombre || !monto_usd) return res.status(400).json({ error: 'Nombre y monto son requeridos' });
    const [id] = await db('categorias').insert({ nombre, descripcion, monto_usd });
    const cat = await db('categorias').where({ id }).first();
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { nombre, descripcion, monto_usd, activa } = req.body;
    await db('categorias').where({ id: req.params.id }).update({ nombre, descripcion, monto_usd, activa });
    const cat = await db('categorias').where({ id: req.params.id }).first();
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
