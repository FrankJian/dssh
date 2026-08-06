-- The Kubernetes workspace was removed. Databases created before the removal
-- still carry its tables; drop them so no stale cluster metadata is retained.
DROP INDEX IF EXISTS idx_kubernetes_audit_profile_created;
DROP TABLE IF EXISTS kubernetes_audit;
DROP TABLE IF EXISTS kubernetes_imports;
DROP INDEX IF EXISTS idx_kubernetes_profiles_favorite_name;
DROP TABLE IF EXISTS kubernetes_profiles;
