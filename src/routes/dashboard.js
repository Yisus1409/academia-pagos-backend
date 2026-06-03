import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/dashboard/kpis — métricas financieras en tiempo real
router.get('/kpis', authMiddleware, async (req, res) => {
  try {
    const ahora = new Date();
    const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const mesAnterior = ahora.getMonth() === 0
      ? `${ahora.getFullYear() - 1}-12`
      : `${ahora.getFullYear()}-${String(ahora.getMonth()).padStart(2, '0')}`;

    // Total recaudado mes actual (pagos aprobados)
    const recaudadoMesActual = await db('pagos')
      .where('status', 'paid')
      .whereRaw("strftime('%Y-%m', pagado_en) = ?", [mesActual])
      .sum('monto_usd as total').first();

    // Total recaudado mes anterior
    const recaudadoMesAnterior = await db('pagos')
      .where('status', 'paid')
      .whereRaw("strftime('%Y-%m', pagado_en) = ?", [mesAnterior])
      .sum('monto_usd as total').first();

    // Monto total en la calle (cargos pendientes + overdue)
    const enLaCalle = await db('cargos_mensuales')
      .whereIn('status', ['pending', 'overdue'])
      .sum('monto_usd as total').first();

    // Total de cargos del mes actual (para calcular morosidad)
    const totalCargosMes = await db('cargos_mensuales')
      .where('mes', mesActual)
      .sum('monto_usd as total').first();

    const totalPagadoMes = await db('cargos_mensuales')
      .where('mes', mesActual).where('status', 'paid')
      .sum('monto_usd as total').first();

    const totalPendienteMes = await db('cargos_mensuales')
      .where('mes', mesActual).whereIn('status', ['pending', 'overdue'])
      .sum('monto_usd as total').first();

    const totalMes = parseFloat(totalCargosMes?.total || 0);
    const pagadoMes = parseFloat(totalPagadoMes?.total || 0);
    const pendienteMes = parseFloat(totalPendienteMes?.total || 0);
    const pctMorosidad = totalMes > 0 ? ((pendienteMes / totalMes) * 100).toFixed(1) : 0;

    // Conteos
    const totalRepresentantes = await db('representantes').where('status', 'active').count('id as c').first();
    const totalInscritos = await db('inscritos').where('status', 'active').count('id as c').first();
    const pagosPorVerificar = await db('pagos').where('status', 'reviewing').count('id as c').first();

    // Pagos por verificar (alerta)
    const pagosReviewing = await db('pagos')
      .where('status', 'reviewing')
      .join('representantes', 'representantes.id', 'pagos.representante_id')
      .select('pagos.id', 'pagos.monto_usd', 'pagos.created_at', 'representantes.nombre_completo')
      .orderBy('pagos.created_at', 'asc')
      .limit(5);

    res.json({
      mesActual,
      mesAnterior,
      recaudadoMesActual: parseFloat(recaudadoMesActual?.total || 0),
      recaudadoMesAnterior: parseFloat(recaudadoMesAnterior?.total || 0),
      enLaCalle: parseFloat(enLaCalle?.total || 0),
      pctMorosidad: parseFloat(pctMorosidad),
      totalRepresentantes: parseInt(totalRepresentantes?.c || 0),
      totalInscritos: parseInt(totalInscritos?.c || 0),
      pagosPorVerificar: parseInt(pagosPorVerificar?.c || 0),
      pagosReviewing,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/grafico — datos para gráfico mensual (últimos 6 meses)
router.get('/grafico', authMiddleware, async (req, res) => {
  try {
    const meses = [];
    const ahora = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const data = await Promise.all(meses.map(async (mes) => {
      const recaudado = await db('pagos')
        .where('status', 'paid')
        .whereRaw("strftime('%Y-%m', pagado_en) = ?", [mes])
        .sum('monto_usd as total').first();

      const pendiente = await db('cargos_mensuales')
        .where('mes', mes).whereIn('status', ['pending', 'overdue'])
        .sum('monto_usd as total').first();

      return {
        mes,
        label: new Date(mes + '-01').toLocaleDateString('es-VE', { month: 'short', year: '2-digit' }),
        recaudado: parseFloat(recaudado?.total || 0),
        pendiente: parseFloat(pendiente?.total || 0),
      };
    }));

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
