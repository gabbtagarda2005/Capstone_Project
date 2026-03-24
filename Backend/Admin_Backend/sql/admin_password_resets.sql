-- Run after ticketing-schema.sql. Stores one-time tokens for admin password reset.

CREATE TABLE IF NOT EXISTS admin_password_resets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_reset_token (token),
  KEY idx_admin_reset_email (email)
);
