import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { registrarAuditoria } from '../services/auditoria.js';
import { aplicarMultasVencidas, generarCargosDelMes } from '../services/cronJobs.js';

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
      ).orderBy('cargos_mensuales.fecha_vencimiento', 'desc');

    if (mes) query = query.where('cargos_mensuales.mes', mes);
    if (status) query = query.where('cargos_mensuales.status', status);
    if (representante_id) query = query.where('representantes.id', representante_id);

    const data = await query;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cargos/generar — genera cargos masivos
router.post('/generar', authMiddleware, async (req, res) => {
  try {
    const ahora = new Date();
    const mes = req.body.mes || `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const fechaVencimiento = req.body.fecha_vencimiento || `${mes}-05`;
    const statusInicial = req.body.status || 'pending';
    const concepto = req.body.concepto || `Mensualidad ${mes}`;
    const categoria_ids = req.body.categoria_ids || null; // null = todas

    let query = db('inscritos')
      .join('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.status', 'active')
      .whereNotNull('inscritos.categoria_id')
      .select('inscritos.id', 'inscritos.representante_id', 'categorias.id as cat_id', 'categorias.monto_usd');

    if (categoria_ids?.length) query = query.whereIn('inscritos.categoria_id', categoria_ids);

    const inscritos = await query;
    let creados = 0, omitidos = 0;

    for (const ins of inscritos) {
      const monto = req.body.monto_base || ins.monto_usd;
      const existe = await db('cargos_mensuales').where({ inscrito_id: ins.id, mes }).first();
      if (existe) { omitidos++; continue; }
      await db('cargos_mensuales').insert({
        inscrito_id: ins.id, categoria_id: ins.cat_id,
        monto_usd: monto, mes, status: statusInicial,
        fecha_vencimiento: fechaVencimiento, concepto,
      });
      creados++;
    }

    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'GENERAR_CARGOS_MASIVOS', entidad: 'cargos_mensuales',
      detalle: { mes, concepto, creados, omitidos },
    });

    res.json({ ok: true, mes, concepto, creados, omitidos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cargos/cargo-extra — cargo manual único por representante
router.post('/cargo-extra', authMiddleware, async (req, res) => {
  try {
    const { representante_id, inscrito_id, concepto, monto_usd, mes } = req.body;
    if (!representante_id || !concepto || !monto_usd) {
      return res.status(400).json({ error: 'Representante, concepto y monto son requeridos' });
    }

    const ahora = new Date();
    const mesActual = mes || `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;

    const [id] = await db('cargos_extra').insert({
      representante_id, inscrito_id: inscrito_id || null,
      concepto, monto_usd, mes: mesActual,
      created_by: req.admin?.id,
    });

    // También crear en cargos_mensuales si hay inscrito
    if (inscrito_id) {
      await db('cargos_mensuales').insert({
        inscrito_id, concepto, monto_usd, mes: mesActual,
        status: 'pending',
        fecha_vencimiento: `${mesActual}-05`,
      });
    }

    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'CARGO_EXTRA_MANUAL', entidad: 'cargos_extra', entidad_id: id,
      detalle: { representante_id, inscrito_id, concepto, monto_usd },
    });

    res.json({ ok: true, id, mensaje: 'Cargo extra creado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cargos/prueba
router.post('/prueba', authMiddleware, async (req, res) => {
  try {
    const { representante_id, status = 'overdue' } = req.body;
    if (!representante_id) return res.status(400).json({ error: 'representante_id requerido' });

    const inscritos = await db('inscritos')
      .join('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.representante_id', representante_id)
      .where('inscritos.status', 'active')
      .whereNotNull('inscritos.categoria_id')
      .select('inscritos.id', 'categorias.id as cat_id', 'categorias.monto_usd');

    if (!inscritos.length) return res.status(400).json({ error: 'No hay inscritos activos con categoría asignada' });

    const mes = '2025-01'; let creados = [];
    for (const ins of inscritos) {
      const existe = await db('cargos_mensuales').where({ inscrito_id: ins.id, mes }).first();
      if (existe) {
        await db('cargos_mensuales').where({ id: existe.id }).update({ status });
        creados.push(existe.id);
      } else {
        const [id] = await db('cargos_mensuales').insert({
          inscrito_id: ins.id, categoria_id: ins.cat_id,
          monto_usd: ins.monto_usd, mes, status,
          fecha_vencimiento: '2025-01-05', concepto: 'Mensualidad 2025-01',
        });
        creados.push(id);
      }
    }
    res.json({ ok: true, cargos_creados: creados.length, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cargos/aplicar-multas — ejecutar manualmente
router.post('/aplicar-multas', authMiddleware, async (req, res) => {
  try {
    const resultado = await aplicarMultasVencidas();
    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'APLICAR_MULTAS_MANUAL', entidad: 'multas',
      detalle: resultado,
    });
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cargos/:id/status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    await db('cargos_mensuales').where({ id: req.params.id }).update({
      status, ...(status === 'paid' ? { pagado_en: new Date().toISOString() } : {}),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
