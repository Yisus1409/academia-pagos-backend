/**
 * Cron Jobs del sistema:
 * 1. Día 1 de cada mes → genera cargos mensuales automáticamente
 * 2. Diariamente a las 8am → aplica multa 5% a cargos vencidos (una sola vez por cargo)
 */
import cron from 'node-cron';
import db from '../database.js';
import { registrarAuditoria } from './auditoria.js';

// ─── Multa automática ─────────────────────────────────────────────────────────
export async function aplicarMultasVencidas() {
  try {
    const hoy = new Date();
    const dia = hoy.getDate();

    // Solo aplica después del día 5 del mes
    if (dia <= 5) {
      console.log('⏰ Cron multas: aún dentro del período de gracia (día 5)');
      return { aplicadas: 0, omitidas: 0 };
    }

    // Buscar cargos vencidos SIN multa aún aplicada
    const cargosVencidos = await db('cargos_mensuales')
      .leftJoin('multas', 'multas.cargo_id', 'cargos_mensuales.id')
      .leftJoin('categorias', 'categorias.id', 'cargos_mensuales.categoria_id')
      .where('cargos_mensuales.status', 'overdue')
      .whereNull('multas.id') // SIN multa previa — evita duplicación
      .select(
        'cargos_mensuales.id',
        'cargos_mensuales.monto_usd',
        'cargos_mensuales.inscrito_id',
        'cargos_mensuales.mes',
        'categorias.recargo_mora_pct'
      );

    let aplicadas = 0;
    for (const cargo of cargosVencidos) {
      const pct = cargo.recargo_mora_pct || 5;
      const monto_multa = parseFloat(((cargo.monto_usd * pct) / 100).toFixed(2));

      // Registrar multa
      await db('multas').insert({
        cargo_id: cargo.id,
        monto_usd: monto_multa,
        porcentaje: pct,
      });

      // Actualizar recargo en el cargo
      await db('cargos_mensuales').where({ id: cargo.id }).update({
        recargo_usd: monto_multa,
        multa_aplicada: true,
      });

      aplicadas++;
    }

    if (aplicadas > 0) {
      console.log(`✅ Cron multas: ${aplicadas} multa(s) aplicada(s)`);
      await registrarAuditoria({
        admin_id: null,
        admin_nombre: 'Sistema Automático',
        accion: 'MULTA_AUTOMATICA',
        entidad: 'cargos_mensuales',
        detalle: `Se aplicaron ${aplicadas} multas por mora automáticamente`,
      });
    }

    return { aplicadas, omitidas: cargosVencidos.length - aplicadas };
  } catch (err) {
    console.error('❌ Error en cron de multas:', err.message);
    return { aplicadas: 0, error: err.message };
  }
}

// ─── Generación automática de cargos mensuales ───────────────────────────────
export async function generarCargosDelMes() {
  try {
    const ahora = new Date();
    const mes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const fechaVencimiento = `${mes}-05`; // vence el día 5

    const inscritos = await db('inscritos')
      .join('categorias', 'categorias.id', 'inscritos.categoria_id')
      .where('inscritos.status', 'active')
      .whereNotNull('inscritos.categoria_id')
      .select('inscritos.id', 'categorias.id as cat_id', 'categorias.monto_usd');

    let creados = 0;
    for (const ins of inscritos) {
      const existe = await db('cargos_mensuales').where({ inscrito_id: ins.id, mes }).first();
      if (existe) continue;
      await db('cargos_mensuales').insert({
        inscrito_id: ins.id, categoria_id: ins.cat_id,
        monto_usd: ins.monto_usd, mes, status: 'pending',
        fecha_vencimiento: fechaVencimiento, concepto: `Mensualidad ${mes}`,
      });
      creados++;
    }

    console.log(`✅ Cron mensual: ${creados} cargos generados para ${mes}`);
    await registrarAuditoria({
      admin_id: null, admin_nombre: 'Sistema Automático',
      accion: 'CARGOS_AUTOMATICOS',
      entidad: 'cargos_mensuales',
      detalle: `Generados ${creados} cargos automáticamente para ${mes}`,
    });

    return { creados, mes };
  } catch (err) {
    console.error('❌ Error en cron mensual:', err.message);
    return { creados: 0, error: err.message };
  }
}

// ─── Iniciar cron jobs ────────────────────────────────────────────────────────
export function iniciarCronJobs() {
  // Día 1 de cada mes a las 00:05 → genera cargos mensuales
  cron.schedule('5 0 1 * *', generarCargosDelMes, { timezone: 'America/Caracas' });

  // Todos los días a las 08:00 → aplica multas a vencidos
  cron.schedule('0 8 * * *', aplicarMultasVencidas, { timezone: 'America/Caracas' });

  console.log('⏰ Cron jobs iniciados: generación mensual + multas automáticas');
}
