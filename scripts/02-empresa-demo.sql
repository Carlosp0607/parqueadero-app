

-- Empresa demo. NIT distinto al de "Parqueadero Central" a propósito.
INSERT INTO empresas (nombre, nit, direccion, telefono, email, plan)
VALUES ('Parqueadero Demo', '901000000-1', 'Demostración', '0000000000',
        'demo@example.com', 'premium');

SET @emp = LAST_INSERT_ID();

INSERT INTO configuracion_empresa
  (id_empresa, capacidad_total_carros, capacidad_total_motos, capacidad_total_bicicletas)
VALUES (@emp, 100, 50, 30);

INSERT INTO tipos_vehiculos (id_empresa, nombre, codigo, activo) VALUES
  (@emp, 'Carro',     'carro', TRUE),
  (@emp, 'Moto',      'moto',  TRUE),
  (@emp, 'Bicicleta', 'bici',  TRUE);

INSERT INTO capacidades_tipo (id_empresa, id_tipo, capacidad_total)
SELECT @emp, id_tipo,
       CASE codigo WHEN 'carro' THEN 100 WHEN 'moto' THEN 50 ELSE 30 END
FROM tipos_vehiculos WHERE id_empresa = @emp;

INSERT INTO tarifas
  (id_empresa, id_tipo, valor_hora, valor_minuto, valor_dia_completo, activa)
SELECT @emp, id_tipo,
       CASE codigo WHEN 'carro' THEN 6000 WHEN 'moto' THEN 3000 ELSE 1500 END,
       CASE codigo WHEN 'carro' THEN  120 WHEN 'moto' THEN   60 ELSE   30 END,
       CASE codigo WHEN 'carro' THEN 30000 WHEN 'moto' THEN 15000 ELSE 8000 END,
       TRUE
FROM tipos_vehiculos WHERE id_empresa = @emp;

-- Usuario invitado. Reemplaza HASH_AQUI (ver comando abajo).
INSERT INTO usuarios (id_empresa, nombre, usuario_login, `contraseña`, rol)
VALUES (@emp, 'Invitado', 'invitado', '$2a$10$khMa2e7THvKTVLPRU1A8vO5Hwj0aM5pSc7LFRf0ihbgSUtyumrh9i', 'invitado');

SELECT @emp AS id_empresa_demo;
