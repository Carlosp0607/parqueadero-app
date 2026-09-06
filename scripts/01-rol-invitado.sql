-- Migración: habilita el rol invitado.
-- Correr UNA sola vez sobre una BD existente. No sustituye a schema.sql.


ALTER TABLE usuarios DROP CONSTRAINT chk_rol;

ALTER TABLE usuarios
  MODIFY COLUMN rol ENUM('admin','operador','invitado') NOT NULL;

ALTER TABLE usuarios
  ADD CONSTRAINT chk_rol CHECK (rol IN ('admin','operador','invitado'));
