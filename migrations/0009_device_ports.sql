-- The device's ports from its datasheet: interfaces, the transceivers they take and the fibre connector type.
ALTER TABLE device_specs ADD COLUMN interfaces TEXT;
ALTER TABLE device_specs ADD COLUMN transceivers TEXT;
ALTER TABLE device_specs ADD COLUMN connectors TEXT;
