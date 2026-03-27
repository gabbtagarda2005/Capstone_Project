-- Bus ticketing (MySQL / MariaDB). Run once against your ticketing database.
-- Backend: Backend/Admin_Backend (JWT admin login + REST).

CREATE TABLE IF NOT EXISTS bus_operators (
  operator_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100) NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NULL,
  role ENUM('Admin', 'Operator') NOT NULL DEFAULT 'Operator',
  UNIQUE KEY uq_bus_operators_email (email)
);

CREATE TABLE IF NOT EXISTS locations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  location_name VARCHAR(150) NOT NULL,
  UNIQUE KEY uq_locations_name (location_name)
);

CREATE TABLE IF NOT EXISTS tickets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  passenger_id VARCHAR(32) NOT NULL,
  start_location VARCHAR(150) NOT NULL,
  destination VARCHAR(150) NOT NULL,
  fare DECIMAL(10, 2) NOT NULL DEFAULT 15.00,
  issued_by_operator_id INT UNSIGNED NOT NULL,
  issued_by_name VARCHAR(255) NOT NULL,
  bus_number VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tickets_operator
    FOREIGN KEY (issued_by_operator_id) REFERENCES bus_operators (operator_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  KEY idx_tickets_operator_created (issued_by_operator_id, created_at),
  KEY idx_tickets_created (created_at)
);

CREATE TABLE IF NOT EXISTS login_logs (
  log_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operator_id INT UNSIGNED NOT NULL,
  login_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_logs_operator
    FOREIGN KEY (operator_id) REFERENCES bus_operators (operator_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  KEY idx_login_logs_operator_time (operator_id, login_timestamp)
);
