import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/representantes — búsqueda universal (por representante O por inscrito)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, status } = req.query;

    // Si hay búsqueda, también buscar por nombre de inscrito
    let repIds = [];
    if (search) {
      const porInscritos = await db('inscritos')
        .whereILike('nombre_completo', `%${search}%`)
        .select('representante_id');
      repIds = porInscritos.map(i => i.representante_id);
    }

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
        if (repIds.length) this.orWhereIn('representantes.id', repIds);
      });
    }
    if (status) query = query.where('representantes.status', status);

    res.json(await query);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/representantes/:id — ficha completa con inscritos + estado de cuenta
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const rep = await db('representantes').where({ id: req.params.id }).first();
    if (!rep) return res.status(404).json({ error: 'Representante no encontrado' });
    delete rep.password_hash;

    const inscritos = await db('inscritos')
      .leftJoin('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.representante_id', req.params.id)
      .select('inscritos.*', 'categorias.nombre as categoria_nombre', 'categorias.monto_usd');

    // Estado de cuenta consolidado
    const cargosInscritos = await db('cargos_mensuales')
      .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
      .where('inscritos.representante_id', req.params.id)
      .select('cargos_mensuales.*', 'inscritos.nombre_completo as inscrito_nombre');

    const totalDeuda = cargosInscritos
      .filter(c => ['pending','overdue'].includes(c.status))
      .reduce((s, c) => s + c.monto_usd + (c.recargo_usd || 0), 0);

    const totalPagado = cargosInscritos
      .filter(c => c.status === 'paid')
      .reduce((s, c) => s + c.monto_usd, 0);

    // Pagos recientes
    const pagosRecientes = await db('pagos')
      .where({ representante_id: req.params.id })
      .orderBy('created_at', 'desc').limit(5);

    res.json({ ...rep, inscritos, cargos: cargosInscritos, estadoCuenta: { totalDeuda, totalPagado }, pagosRecientes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/representantes
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { cedula, nombre_completo, email, telefono } = req.body;
    if (!cedula || !nombre_completo) return res.status(400).json({ error: 'Cédula y nombre son requeridos' });

    const exists = await db('representantes').where({ cedula }).first();
    if (exists) return res.status(409).json({ error: 'Ya existe un representante con esa cédula' });

    const password_hash = bcrypt.hashSync(cedula, 10);
    const [id] = await db('representantes').insert({ cedula, nombre_completo, email, telefono, password_hash });
    const rep = await db('representantes').where({ id }).first();
    delete rep.password_hash;
    res.status(201).json(rep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/representantes/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { nombre_completo, email, telefono, status } = req.body;
    await db('representantes').where({ id: req.params.id }).update({ nombre_completo, email, telefono, status });
    const rep = await db('representantes').where({ id: req.params.id }).first();
    delete rep.password_hash;
    res.json(rep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/representantes/:id/status
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
