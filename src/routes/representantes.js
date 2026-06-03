import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// ─── Listar todos ────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = db('representantes')
      .select('representantes.*', db.raw('COUNT(inscritos.id) as total_inscritos'))
      .leftJoin('inscritos', 'inscritos.representante_id', 'representantes.id')
      .groupBy('representantes.id')
      .orderBy('representantes.nombre_completo');

    if (search) {
      query = query.where(function () {
        this.whereILike('representantes.nombre_completo', `%${search}%`)
          .orWhereILike('representantes.cedula', `%${search}%`)
          .orWhereILike('representantes.email', `%${search}%`);
      });
    }
    if (status) query = query.where('representantes.status', status);

    const data = await query;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Obtener uno con sus inscritos ───────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const rep = await db('representantes').where({ id: req.params.id }).first();
    if (!rep) return res.status(404).json({ error: 'Representante no encontrado' });

    const inscritos = await db('inscritos')
      .leftJoin('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.representante_id', req.params.id)
      .select('inscritos.*', 'categorias.nombre as categoria_nombre', 'categorias.monto_usd');

    delete rep.password_hash;
    res.json({ ...rep, inscritos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Crear representante (admin) ─────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { cedula, nombre_completo, email, telefono } = req.body;
    if (!cedula || !nombre_completo) {
      return res.status(400).json({ error: 'Cédula y nombre son requeridos' });
    }

    const exists = await db('representantes').where({ cedula }).first();
    if (exists) return res.status(409).json({ error: 'Ya existe un representante con esa cédula' });

    // La contraseña por defecto es la cédula
    const password_hash = bcrypt.hashSync(cedula, 10);

    const [id] = await db('representantes').insert({
      cedula, nombre_completo, email, telefono, password_hash,
    });

    const rep = await db('representantes').where({ id }).first();
    delete rep.password_hash;
    res.status(201).json(rep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Actualizar representante ────────────────────────────────────────────────
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { nombre_completo, email, telefono, status } = req.body;
    await db('representantes').where({ id: req.params.id }).update({
      nombre_completo, email, telefono, status,
    });
    const rep = await db('representantes').where({ id: req.params.id }).first();
    delete rep.password_hash;
    res.json(rep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cambiar status ──────────────────────────────────────────────────────────
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    await db('representantes').where({ id: req.params.id }).update({ status });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
