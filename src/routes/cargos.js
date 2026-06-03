import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/cargos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { mes, status, representante_id } = req.query;
    let query = db('cargos_mensuales')
      .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
      .join('representantes', 'representantes.id', 'inscritos.representante_id')
      .leftJoin('categorias', 'categorias.id', 'cargos_mensuales.categoria_id')
      .select(
        'cargos_mensuales.*',
        'inscritos.nombre_completo as inscrito_nombre',
        'representantes.nombre_completo as representante_nombre',
        'representantes.cedula as representante_cedula',
        'categorias.nombre as categoria_nombre'
      )
      .orderBy('cargos_mensuales.fecha_vencimiento', 'desc');

    if (mes) query = query.where('cargos_mensuales.mes', mes);
    if (status) query = query.where('cargos_mensuales.status', status);
    if (representante_id) query = query.where('representantes.id', representante_id);

    const data = await query;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cargos/generar — genera cargos del mes para todos los inscritos activos
router.post('/generar', authMiddleware, async (req, res) => {
  try {
    const ahora = new Date();
    const mes = req.body.mes || `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const fechaVencimiento = req.body.fecha_vencimiento || `${mes}-10`;
    const statusInicial = req.body.status || 'pending';

    const inscritos = await db('inscritos')
      .join('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.status', 'active')
      .whereNotNull('inscritos.categoria_id')
      .select('inscritos.id', 'inscritos.representante_id', 'categorias.id as cat_id', 'categorias.monto_usd');

    let creados = 0, omitidos = 0;

    for (const ins of inscritos) {
      const existe = await db('cargos_mensuales').where({ inscrito_id: ins.id, mes }).first();
      if (existe) { omitidos++; continue; }

      await db('cargos_mensuales').insert({
        inscrito_id: ins.id,
        categoria_id: ins.cat_id,
        monto_usd: ins.monto_usd,
        mes,
        status: statusInicial,
        fecha_vencimiento: fechaVencimiento,
      });
      creados++;
    }

    res.json({ ok: true, mes, creados, omitidos, total: inscritos.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cargos/prueba — crea un cargo de prueba directamente para un representante
router.post('/prueba', authMiddleware, async (req, res) => {
  try {
    const { representante_id, status = 'overdue' } = req.body;
    if (!representante_id) return res.status(400).json({ error: 'representante_id requerido' });

    // Buscar inscritos activos del representante
    const inscritos = await db('inscritos')
      .join('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.representante_id', representante_id)
      .where('inscritos.status', 'active')
      .whereNotNull('inscritos.categoria_id')
      .select('inscritos.id', 'categorias.id as cat_id', 'categorias.monto_usd');

    if (!inscritos.length) return res.status(400).json({ error: 'No hay inscritos activos con categoría asignada' });

    const mes = '2025-01';
    const creados = [];

    for (const ins of inscritos) {
      const existe = await db('cargos_mensuales').where({ inscrito_id: ins.id, mes }).first();
      if (existe) {
        // Actualizar status si ya existe
        await db('cargos_mensuales').where({ id: existe.id }).update({ status });
        creados.push(existe.id);
      } else {
        const [id] = await db('cargos_mensuales').insert({
          inscrito_id: ins.id,
          categoria_id: ins.cat_id,
          monto_usd: ins.monto_usd,
          mes,
          status,
          fecha_vencimiento: '2025-01-10',
        });
        creados.push(id);
      }
    }

    res.json({ ok: true, cargos_creados: creados.length, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cargos/:id/status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    await db('cargos_mensuales').where({ id: req.params.id }).update({
      status,
      ...(status === 'paid' ? { pagado_en: new Date().toISOString() } : {}),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
