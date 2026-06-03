import knex from 'knex';
import { fileURLToPath } from 'url';
import path from 'path';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../database.sqlite');

const db = knex({
  client: 'sqlite3',
  connection: { filename: dbPath },
  useNullAsDefault: true,
});

async function initDB() {
  // admins
  if (!(await db.schema.hasTable('admins'))) {
    await db.schema.createTable('admins', (t) => {
      t.increments('id');
      t.string('name').notNullable();
      t.string('email').unique().notNullable();
      t.string('password').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // config_institucion
  if (!(await db.schema.hasTable('config_institucion'))) {
    await db.schema.createTable('config_institucion', (t) => {
      t.increments('id');
      t.string('nombre').defaultTo('Mi Academia');
      t.string('logo_url');
      t.string('color_primario').defaultTo('#0055E6');
      t.string('color_secundario').defaultTo('#0078F0');
      t.string('email_contacto');
      t.string('telefono_contacto');
      t.string('direccion');
      t.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  // representantes
  if (!(await db.schema.hasTable('representantes'))) {
    await db.schema.createTable('representantes', (t) => {
      t.increments('id');
      t.string('cedula').unique().notNullable();
      t.string('nombre_completo').notNullable();
      t.string('email');
      t.string('telefono');
      t.string('password_hash').notNullable();
      t.string('avatar_url');
      t.enu('status', ['active', 'inactive']).defaultTo('active');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  } else {
    const hasAvatar = await db.schema.hasColumn('representantes', 'avatar_url');
    if (!hasAvatar) await db.schema.alterTable('representantes', t => t.string('avatar_url'));
  }

  // categorias
  if (!(await db.schema.hasTable('categorias'))) {
    await db.schema.createTable('categorias', (t) => {
      t.increments('id');
      t.string('nombre').notNullable();
      t.string('descripcion');
      t.float('monto_usd').notNullable();
      t.float('recargo_mora_pct').defaultTo(5);
      t.float('descuento_pronto_pct').defaultTo(0);
      t.integer('dias_gracia').defaultTo(5);
      t.boolean('activa').defaultTo(true);
    });
  } else {
    for (const [col, type, def] of [
      ['recargo_mora_pct','float',5],
      ['descuento_pronto_pct','float',0],
      ['dias_gracia','integer',5]
    ]) {
      const has = await db.schema.hasColumn('categorias', col);
      if (!has) await db.schema.alterTable('categorias', t => {
        type === 'integer' ? t.integer(col).defaultTo(def) : t.float(col).defaultTo(def);
      });
    }
  }

  // inscritos
  if (!(await db.schema.hasTable('inscritos'))) {
    await db.schema.createTable('inscritos', (t) => {
      t.increments('id');
      t.integer('representante_id').references('id').inTable('representantes');
      t.integer('categoria_id').references('id').inTable('categorias');
      t.string('nombre_completo').notNullable();
      t.date('fecha_nacimiento');
      t.string('seccion_categoria');
      t.string('numero_contrato').unique();
      t.date('fecha_inscripcion');
      t.date('fecha_vencimiento');
      t.text('observaciones');
      t.string('avatar_url');
      t.enu('status', ['active', 'inactive']).defaultTo('active');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  } else {
    const hasAvatar = await db.schema.hasColumn('inscritos', 'avatar_url');
    if (!hasAvatar) await db.schema.alterTable('inscritos', t => t.string('avatar_url'));
  }

  // cargos_mensuales
  if (!(await db.schema.hasTable('cargos_mensuales'))) {
    await db.schema.createTable('cargos_mensuales', (t) => {
      t.increments('id');
      t.integer('inscrito_id').references('id').inTable('inscritos');
      t.integer('categoria_id').references('id').inTable('categorias');
      t.float('monto_usd').notNullable();
      t.float('recargo_usd').defaultTo(0);
      t.float('descuento_usd').defaultTo(0);
      t.string('concepto').defaultTo('Mensualidad');
      t.string('mes').notNullable();
      t.boolean('multa_aplicada').defaultTo(false);
      t.enu('status', ['pending', 'paid', 'overdue']).defaultTo('pending');
      t.date('fecha_vencimiento').notNullable();
      t.timestamp('pagado_en');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  } else {
    for (const [col, type] of [
      ['recargo_usd','float'],['descuento_usd','float'],
      ['concepto','string'],['multa_aplicada','boolean']
    ]) {
      const has = await db.schema.hasColumn('cargos_mensuales', col);
      if (!has) await db.schema.alterTable('cargos_mensuales', t => {
        if (type === 'float') t.float(col).defaultTo(0);
        else if (type === 'boolean') t.boolean(col).defaultTo(false);
        else t.string(col).defaultTo('Mensualidad');
      });
    }
  }

  // pagos
  if (!(await db.schema.hasTable('pagos'))) {
    await db.schema.createTable('pagos', (t) => {
      t.increments('id');
      t.integer('representante_id').references('id').inTable('representantes');
      t.string('spidi_session_id');
      t.integer('spidi_tx_id');
      t.float('monto_usd').notNullable();
      t.float('monto_ves');
      t.float('tasa_bcv');
      t.string('metodo_pago');
      t.string('banco');
      t.string('referencia_banco');
      t.enu('tipo', ['spidi', 'manual', 'admin']).defaultTo('spidi');
      t.string('referencia_manual');
      t.string('banco_origen');
      t.date('fecha_pago_manual');
      t.string('comprobante_url');
      t.text('motivo_rechazo');
      t.enu('status', ['pending', 'reviewing', 'paid', 'failed']).defaultTo('pending');
      t.string('descripcion');
      t.timestamp('pagado_en');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  } else {
    const cols = [
      ['tipo','string'],['referencia_manual','string'],
      ['banco_origen','string'],['fecha_pago_manual','string'],
      ['comprobante_url','string'],['motivo_rechazo','text'],
    ];
    for (const [col, type] of cols) {
      const has = await db.schema.hasColumn('pagos', col);
      if (!has) await db.schema.alterTable('pagos', t => {
        type === 'text' ? t.text(col) : t.string(col);
      });
    }
  }

  // pago_cargos
  if (!(await db.schema.hasTable('pago_cargos'))) {
    await db.schema.createTable('pago_cargos', (t) => {
      t.integer('pago_id').references('id').inTable('pagos');
      t.integer('cargo_id').references('id').inTable('cargos_mensuales');
      t.primary(['pago_id', 'cargo_id']);
    });
  }

  // multas — evita duplicación del recargo
  if (!(await db.schema.hasTable('multas'))) {
    await db.schema.createTable('multas', (t) => {
      t.increments('id');
      t.integer('cargo_id').unique().references('id').inTable('cargos_mensuales');
      t.float('monto_usd').notNullable();
      t.float('porcentaje').defaultTo(5);
      t.timestamp('aplicada_en').defaultTo(db.fn.now());
    });
  }

  // cargos_extra — cargos manuales únicos por admin
  if (!(await db.schema.hasTable('cargos_extra'))) {
    await db.schema.createTable('cargos_extra', (t) => {
      t.increments('id');
      t.integer('inscrito_id').references('id').inTable('inscritos');
      t.integer('representante_id').references('id').inTable('representantes');
      t.integer('created_by').references('id').inTable('admins');
      t.string('concepto').notNullable();
      t.float('monto_usd').notNullable();
      t.string('mes').notNullable();
      t.enu('status', ['pending', 'paid']).defaultTo('pending');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // audit_logs — registro de acciones admin
  if (!(await db.schema.hasTable('audit_logs'))) {
    await db.schema.createTable('audit_logs', (t) => {
      t.increments('id');
      t.integer('admin_id').references('id').inTable('admins');
      t.string('admin_nombre');
      t.string('accion').notNullable();
      t.string('entidad');
      t.integer('entidad_id');
      t.text('detalle');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // uploads
  if (!(await db.schema.hasTable('uploads'))) {
    await db.schema.createTable('uploads', (t) => {
      t.increments('id');
      t.string('filename').notNullable();
      t.string('original_name');
      t.string('mime_type');
      t.integer('size');
      t.string('entity_type');
      t.integer('entity_id');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // Seeds
  const existingAdmin = await db('admins').where({ email: 'admin@academia.com' }).first();
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db('admins').insert({ name: 'Administrador', email: 'admin@academia.com', password: hash });
    console.log('✅ Admin por defecto creado');
  }

  const configCount = await db('config_institucion').count('id as c').first();
  if (configCount.c === 0) {
    await db('config_institucion').insert({ nombre: 'Mi Academia', color_primario: '#0055E6', color_secundario: '#0078F0' });
  }

  const catCount = await db('categorias').count('id as c').first();
  if (catCount.c === 0) {
    await db('categorias').insert([
      { nombre: 'Categoría A', descripcion: 'Nivel básico', monto_usd: 20, recargo_mora_pct: 5, dias_gracia: 5 },
      { nombre: 'Categoría B', descripcion: 'Nivel intermedio', monto_usd: 30, recargo_mora_pct: 5, dias_gracia: 5 },
      { nombre: 'Categoría C', descripcion: 'Nivel avanzado', monto_usd: 40, recargo_mora_pct: 5, dias_gracia: 5 },
    ]);
    console.log('✅ Categorías de ejemplo creadas');
  }

  console.log('✅ Base de datos lista');
}

initDB().catch(console.error);
export default db;
