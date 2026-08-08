-- 1. EXTENSIONES (Para generar IDs únicos y seguros)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA DE PRODUCTOS (El inventario central)
-- Aquí guardamos el stock en su unidad más pequeña (ej. mililitros, libras, dosis)
CREATE TABLE productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  codigo_barras TEXT UNIQUE,
  categoria TEXT,
  unidad_base TEXT NOT NULL, -- Ej: 'ml', 'gramos', 'dosis', 'unidad'
  stock_base DECIMAL NOT NULL DEFAULT 0,
  precio_costo DECIMAL NOT NULL DEFAULT 0, -- Ojo: luego ocultaremos esto al vendedor
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TABLA DE PRESENTACIONES (Cómo se vende el producto)
-- Aquí es donde ocurre la magia de fraccionar productos
CREATE TABLE presentaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
  nombre_presentacion TEXT NOT NULL, -- Ej: 'Frasco 1 Litro', 'Medio Litro', '1 Dosis'
  factor_conversion DECIMAL NOT NULL, -- Cuánto descuenta del stock base (Ej: 1000 para el litro)
  precio_venta DECIMAL NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. TABLA DE VENTAS (El comprobante general)
CREATE TABLE ventas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- vendedor_id UUID REFERENCES auth.users(id), (Lo conectaremos a usuarios después)
  total DECIMAL NOT NULL,
  estado_factura TEXT DEFAULT 'pendiente', -- Opciones: 'pendiente' o 'facturada_manual'
  numero_factura_fisica TEXT, -- El dueño llena esto cuando factura en la SAT
  fecha_venta TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. TABLA DE DETALLE DE VENTAS (Qué incluye el ticket)
CREATE TABLE detalle_ventas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id UUID REFERENCES ventas(id) ON DELETE CASCADE,
  presentacion_id UUID REFERENCES presentaciones(id),
  cantidad DECIMAL NOT NULL, -- Cuántas presentaciones compró (Ej: 2 medios litros)
  subtotal DECIMAL NOT NULL
);