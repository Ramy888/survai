-- Why processing failed, shown on the upload step after the survey returns there.
ALTER TABLE surveys ADD COLUMN processing_error TEXT;
