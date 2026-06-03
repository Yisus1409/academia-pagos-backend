import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../database.js';

const router = Router();

export const repAuthMiddleware = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.rep = jwt.verify(token, process.env.JWT_SECRET + '_rep');
    next();
  } catch {
    res.status(403).json({ error: 'Token inválido' });
  }
};

// POST /api/portal/login
router.post('/login', async (req, res) => {
  try {
    const { cedula, password } = req.body;
    if (!cedula || !password) return res.status(400).json({ error: 'Cédula y contraseña requeridas' });
    const rep = await db('representantes').where({ cedula }).first();
    if (!rep || rep.status !== 'active') return res.status(401).json({ error: 'Acceso no autorizado' });
    const valid = bcrypt.compareSync(password, rep.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign(
      { id: rep.id, cedula: rep.cedula, nombre: rep.nombre_completo },
      process.env.JWT_SECRET + '_rep',
      { expiresIn: '8h' }
    );
    res.json({ token, rep: { id: rep.id, nombre: rep.nombre_completo, cedula: rep.cedula, email: rep.email, avatar_url: rep.avatar_url } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/me
router.get('/me', repAuthMiddleware, async (req, res) => {
  try {
    const rep = await db('representantes').where({ id: req.rep.id }).first();
    delete rep.password_hash;

    const inscritos = await db('inscritos')
      .leftJoin('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.representante_id', rep.id)
      .where('inscritos.status', 'active')
      .select('inscritos.*', 'categorias.nombre as categoria_nombre', 'categorias.monto_usd',
        'categorias.recargo_mora_pct', 'categorias.descuento_pronto_pct', 'categorias.dias_gracia');

    // Cargos pendientes con cálculo de recargos/descuentos
    const hoy = new Date();
    const cargos = await db('cargos_mensuales')
      .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
      .join('representantes', 'representantes.id', 'inscritos.representante_id')
      .leftJoin('categorias', 'categorias.id', 'cargos_mensuales.categoria_id')
      .where('representantes.id', rep.id)
      .whereIn('cargos_mensuales.status', ['pending', 'overdue'])
      .select(
        'cargos_mensuales.*',
        'inscritos.nombre_completo as inscrito_nombre',
        'inscritos.avatar_url as inscrito_avatar',
        'categorias.nombre as categoria_nombre',
        'categorias.recargo_mora_pct',
        'categorias.descuento_pronto_pct',
        'categorias.dias_gracia'
      )
      .orderBy('cargos_mensuales.fecha_vencimiento');

    // Calcular montos finales con recargos/descuentos
    const cargosCalculados = cargos.map(c => {
      const vencimiento = new Date(c.fecha_vencimiento);
      const diasDiff = Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));
      const enMora = diasDiff > (c.dias_gracia || 0);
      const enProntoPago = diasDiff < -5; // más de 5 días antes del vencimiento

      let recargo = 0;
      let descuento = 0;

      if (enMora && c.recargo_mora_pct > 0) {
        recargo = parseFloat(((c.monto_usd * c.recargo_mora_pct) / 100).toFixed(2));
      }
      if (enProntoPago && c.descuento_pronto_pct > 0) {
        descuento = parseFloat(((c.monto_usd * c.descuento_pronto_pct) / 100).toFixed(2));
      }

      const monto_final = parseFloat((c.monto_usd + recargo - descuento).toFixed(2));

      return { ...c, recargo_usd: recargo, descuento_usd: descuento, monto_final, en_mora: enMora, dias_vencido: enMora ? diasDiff : 0 };
    });

    // Pago rechazado reciente para mostrar alerta
    const pagoRechazado = await db('pagos')
      .where({ representante_id: rep.id, status: 'failed' })
      .whereNotNull('motivo_rechazo')
      .orderBy('created_at', 'desc')
      .first();

    // Configuración de institución
    const config = await db('config_institucion').first();

    res.json({ rep, inscritos, cargos: cargosCalculados, pagoRechazado: pagoRechazado || null, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/historial
router.get('/historial', repAuthMiddleware, async (req, res) => {
  try {
    const pagos = await db('pagos')
      .where({ representante_id: req.rep.id })
      .whereIn('status', ['paid', 'reviewing', 'failed'])
      .orderBy('created_at', 'desc')
      .limit(50);
    res.json(pagos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/solvencia — genera datos para PDF de solvencia
router.get('/solvencia', repAuthMiddleware, async (req, res) => {
  try {
    const rep = await db('representantes').where({ id: req.rep.id }).first();
    delete rep.password_hash;

    const cargos = await db('cargos_mensuales')
      .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
      .where('inscritos.representante_id', rep.id)
      .whereIn('cargos_mensuales.status', ['pending', 'overdue'])
      .count('cargos_mensuales.id as total')
      .first();

    if (parseInt(cargos.total) > 0) {
      return res.status(400).json({ error: 'El representante tiene cargos pendientes' });
    }

    const inscritos = await db('inscritos')
      .where({ representante_id: rep.id, status: 'active' })
      .select('nombre_completo', 'seccion_categoria', 'numero_contrato');

    const config = await db('config_institucion').first();
    const fecha = new Date().toLocaleDateString('es-VE', { year: 'numeric', month: 'long', day: 'numeric' });

    res.json({
      tipo: 'solvencia',
      representante: rep,
      inscritos,
      config,
      fecha,
      codigo: `SOLV-${rep.cedula}-${Date.now().toString(36).toUpperCase()}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portal/cambiar-password
router.post('/cambiar-password', repAuthMiddleware, async (req, res) => {
  try {
    const { password_actual, password_nuevo } = req.body;
    const rep = await db('representantes').where({ id: req.rep.id }).first();
    if (!bcrypt.compareSync(password_actual, rep.password_hash)) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }
    await db('representantes').where({ id: rep.id }).update({
      password_hash: bcrypt.hashSync(password_nuevo, 10),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
