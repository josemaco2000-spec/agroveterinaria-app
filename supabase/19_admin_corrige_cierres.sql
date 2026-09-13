-- =================================================================
-- 19. MEJORA: PERMITIR QUE ADMIN CORRIJA UN CIERRE DE CAJA
-- =================================================================
-- cierres_caja tiene RLS activado pero nunca existió una política de
-- UPDATE (ver auditoría del grupo 2 de la Fase 1) — el efecto es que ni
-- siquiera el admin puede corregir un error de digitación en un cierre
-- ya guardado (monto mal tecleado, observación incompleta, etc.).
--
-- Se agrega una política de UPDATE restringida a admin únicamente.
-- No se toca INSERT (debe seguir abierto: cajero y admin insertan su
-- propio cierre) ni se agrega DELETE (borrar un cierre destruye el
-- arqueo/auditoría de caja; si en el futuro se necesita "anular" un
-- cierre, debería modelarse como un estado, no como un DELETE real).
-- =================================================================

CREATE POLICY "Solo admin corrige cierres" ON cierres_caja
  FOR UPDATE TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));
