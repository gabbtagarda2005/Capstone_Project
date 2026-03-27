-- Run once on existing ticketing DBs that were created before bus_number existed.
ALTER TABLE tickets
  ADD COLUMN bus_number VARCHAR(32) NULL AFTER issued_by_name;
