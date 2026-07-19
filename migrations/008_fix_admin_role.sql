
UPDATE users SET role = 'admin' WHERE is_admin = 1 AND (role IS NULL OR role != 'admin');

UPDATE users SET role = 'customer' WHERE role IS NULL OR role = '';

ALTER TABLE users DROP COLUMN is_admin;

