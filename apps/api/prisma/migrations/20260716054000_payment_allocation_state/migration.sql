CREATE OR REPLACE FUNCTION reject_posted_document_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    IF (to_jsonb(NEW) - 'paid_minor' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'paid_minor' - 'updated_at') THEN
      RAISE EXCEPTION 'Posted documents are immutable; use a return or reversal' USING ERRCODE = '55000';
    END IF;
    IF NEW.paid_minor < 0 OR NEW.paid_minor > NEW.total_minor THEN
      RAISE EXCEPTION 'Allocated amount must remain between zero and the posted document total' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
