import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Generar número de contrato único
function generarContrato() {
  const año = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `CONT-${año}-${rand}`;
}

// ─── Listar todos ────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = db('inscritos')
      .join('representantes', 'representantes.id', 'inscritos.representante_id')
      .leftJoin('categorias', 'categorias.id', 'inscritos.categoria_id')
      .select(
        'inscritos.*',
        'representantes.nombre_completo as representante_nombre',
        'representantes.cedula as representante_cedula',
        'representantes.email as representante_email',
        'categorias.nombre as categoria_nombre',
        'categorias.monto_usd'
      )
      .orderBy('inscritos.nombre_completo');

    if (search) {
      query = query.where(function () {
        this.whereILike('inscritos.nombre_completo', `%${search}%`)
          .orWhereILike('inscritos.numero_contrato', `%${search}%`)
          .orWhereILike('representantes.cedula', `%${search}%`)
          .orWhereILike('representantes.nombre_completo', `%${search}%`);
      });
    }
    if (status) query = query.where('inscritos.status', status);

    const data = await query;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Crear inscrito ──────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      representante_id, categoria_id, nombre_completo,
      fecha_nacimiento, seccion_categoria,
      fecha_inscripcion, fecha_vencimiento, observaciones
    } = req.body;

    if (!representante_id || !nombre_completo) {
      return res.status(400).json({ error: 'Representante y nombre son requeridos' });
    }

    let numero_contrato = generarContrato();
    // Asegurarse de que sea único
    while (await db('inscritos').where({ numero_contrato }).first()) {
      numero_contrato = generarContrato();
    }

    const [id] = await db('inscritos').insert({
      representante_id, categoria_id, nombre_completo,
      fecha_nacimiento, seccion_categoria, numero_contrato,
      fecha_inscripcion: fecha_inscripcion || new Date().toISOString().split('T')[0],
      fecha_vencimiento, observaciones,
    });

    const inscrito = await db('inscritos')
      .leftJoin('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.id', id)
      .select('inscritos.*', 'categorias.nombre as categoria_nombre', 'categorias.monto_usd')
      .first();

    res.status(201).json(inscrito);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Actualizar inscrito ─────────────────────────────────────────────────────
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const {
      categoria_id, nombre_completo, fecha_nacimiento,
      seccion_categoria, fecha_vencimiento, observaciones, status
    } = req.body;

    await db('inscritos').where({ id: req.params.id }).update({
      categoria_id, nombre_completo, fecha_nacimiento,
      seccion_categoria, fecha_vencimiento, observaciones, status
    });

    const inscrito = await db('inscritos')
      .leftJoin('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.id', req.params.id)
      .select('inscritos.*', 'categorias.nombre as categoria_nombre', 'categorias.monto_usd')
      .first();

    res.json(inscrito);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cambiar status ──────────────────────────────────────────────────────────
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    await db('inscritos').where({ id: req.params.id }).update({ status });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
