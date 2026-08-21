-- migrations/026_perf_indexes.sql
-- Performance pass (see export-backup-perf-implementation-prompt.md).
--
-- Checked every index the prompt asked about against schema.sql + prior
-- migrations before adding anything:
--   product_sizes(product_id, size)        -- already covered: UNIQUE(product_id, size) in 009 creates this index
--   order_items(order_id)                  -- idx_order_items_order_id, schema.sql
--   audit_log(id)                          -- primary key, already indexed
--   sessions(user_id)                      -- idx_sessions_user_id, schema.sql
--   login_attempts(email, created_at)      -- idx_login_attempts_email_time, migration 015
--   raw_material_transactions(status)      -- idx_rmt_status, migration 010
--   product_stock_transactions(status)     -- idx_product_stock_tx_status, migration 012
--   product_core_change_requests(status)   -- idx_pcc_status, migration 010
-- All eight already exist. The one real gap:
--
-- admin/orders.js (and the new /api/admin/export/orders endpoint) filter
-- by status and/or payment_status and always sort by created_at DESC —
-- nothing covered that combination.
CREATE INDEX IF NOT EXISTS idx_orders_status_payment_created
  ON orders(status, payment_status, created_at);
